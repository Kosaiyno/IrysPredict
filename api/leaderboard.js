// Leaderboard with rolling timeframe support.
// Accepts query param `days` (integer). If omitted or <=0, returns all-time.
export const config = { runtime: 'edge' };

async function readNum(key, kvGetFunc) {
  const r = await kvGetFunc(key).catch(()=>null);
  const v = r?.result;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function readLastTs(key, kvGetFunc) {
  const r = await kvGetFunc(key).catch(()=>null);
  const v = r?.result;
  // lastTs is stored as string of a number (ms)
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// exportable core function for testing with injected kv funcs
export async function getLeaderboard({ limit = 100, days = 7, now = Date.now(), kv } = {}) {
  // lazily import real KV helpers when not provided (tests pass kv)
  if (!kv) {
    const mod = await import('./_kv.js');
    kv = { kvGet: mod.kvGet, kvZRange: mod.kvZRange };
  }
  const { kvGet: _kvGet, kvZRange: _kvRange } = kv;
  // If days === 0 -> all-time (use global sorted set and cumulative stats)
  if (!days || Number(days) === 0) {
    const fetchMax = Math.min(1000, Math.max(limit * 5, limit + 50));
    const z = await _kvRangeSafe(_kvRange, 'lb:z:points', -fetchMax, -1, true);
    const arr = Array.isArray(z) ? z : [];
    const pairs = [];
    for (let i = arr.length - 2; i >= 0; i -= 2) {
      pairs.push({ wallet: arr[i], points: Number(arr[i+1] || 0) });
    }
    const rows = [];
    for (const p of pairs) {
      if (rows.length >= limit) break;
      const base = `lb:${p.wallet}`;
      const wins   = await readNum(`${base}:wins`, _kvGet);
      const losses = await readNum(`${base}:losses`, _kvGet);
      const streak = await readNum(`${base}:streak`, _kvGet);
      const best   = await readNum(`${base}:best`, _kvGet);
      rows.push({ addr: p.wallet, points: p.points, wins, losses, streak, best });
    }
    return rows;
  }

  // If days === 7 -> use Friday-aligned weekly scoped zset and per-week stats
  if (Number(days) === 7) {
    const getWeekId = (tsMs) => {
      const d = new Date(Number(tsMs));
      const day = d.getUTCDay();
      const daysSinceFriday = (day - 5 + 7) % 7;
      const friday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      friday.setUTCDate(friday.getUTCDate() - daysSinceFriday);
      const y = friday.getUTCFullYear();
      const m = String(friday.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(friday.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };

    const weekId = getWeekId(now);
    const zkey = `lb:week:${weekId}:z:points`;
    const z = await _kvRangeSafe(_kvRange, zkey, -limit, -1, true);
    const arr = Array.isArray(z) ? z : [];
    const pairs = [];
    for (let i = arr.length - 2; i >= 0; i -= 2) {
      pairs.push({ wallet: arr[i], points: Number(arr[i+1] || 0) });
    }
    const rows = [];
    for (const p of pairs) {
      if (rows.length >= limit) break;
      const base = `lb:week:${weekId}:${p.wallet}`;
      const wins   = await readNum(`${base}:wins`, _kvGet);
      const losses = await readNum(`${base}:losses`, _kvGet);
      const streak = await readNum(`${base}:streak`, _kvGet);
      const best   = await readNum(`${base}:best`, _kvGet);
      rows.push({ addr: p.wallet, points: p.points, wins, losses, streak, best });
    }
    return rows;
  }

  // Fallback: legacy rolling window based on lastTs
  const cutoff = now - Math.floor(days * 24 * 60 * 60 * 1000);
  const fetchMax = Math.min(1000, Math.max(limit * 5, limit + 50));
  const zAll = await _kvRangeSafe(_kvRange, 'lb:z:points', -fetchMax, -1, true);
  const arrAll = Array.isArray(zAll) ? zAll : [];
  const pairsAll = [];
  for (let i = arrAll.length - 2; i >= 0; i -= 2) pairsAll.push({ wallet: arrAll[i], points: Number(arrAll[i+1] || 0) });
  const rowsAll = [];
  for (const p of pairsAll) {
    if (rowsAll.length >= limit) break;
    const base = `lb:${p.wallet}`;
    const lastTs = await readLastTs(`${base}:lastTs`, _kvGet);
    if (!lastTs || lastTs < cutoff) continue;
    const wins   = await readNum(`${base}:wins`, _kvGet);
    const losses = await readNum(`${base}:losses`, _kvGet);
    const streak = await readNum(`${base}:streak`, _kvGet);
    const best   = await readNum(`${base}:best`, _kvGet);
    rowsAll.push({ addr: p.wallet, points: p.points, wins, losses, streak, best });
  }
  return rowsAll;
}

// small wrapper because Upstash call returns { result: [...] }
async function _kvRangeSafe(fn, ...args) {
  try {
    const r = await fn(...args).catch(()=>null);
    if (!r) return [];
    if (Array.isArray(r.result)) return r.result;
    return Array.isArray(r) ? r : [];
  } catch (e) { return []; }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get('limit') || 100));
  const days = Number(url.searchParams.get('days') || 7);
  try {
    // let getLeaderboard lazy-import the KV helpers in runtime
    const rows = await getLeaderboard({ limit, days, now: Date.now() });
    return new Response(JSON.stringify({ rows }), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    // Surface a generic error (stack will be in Vercel logs). Do not leak secrets.
    console.error('leaderboard handler error', String(err));
    return new Response(JSON.stringify({ error: 'leaderboard error' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
