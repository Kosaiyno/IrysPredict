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
  const cutoff = days > 0 ? now - Math.floor(days * 24 * 60 * 60 * 1000) : 0;

  // fetch more than `limit` because we'll filter out members outside the window
  const fetchMax = Math.min(1000, Math.max(limit * 5, limit + 50));
  const z = await _kvRangeSafe(_kvRange, 'lb:z:points', -fetchMax, -1, true);
  const arr = Array.isArray(z) ? z : [];

  // z looks like ["member1","score1","member2","score2",...]
  const pairs = [];
  for (let i = arr.length - 2; i >= 0; i -= 2) {
    pairs.push({ wallet: arr[i], points: Number(arr[i+1] || 0) });
  }

  const rows = [];
  for (const p of pairs) {
    if (rows.length >= limit) break;
    const base = `lb:${p.wallet}`;

    // If a rolling window is requested, check the last activity timestamp
    if (days > 0) {
      const lastTs = await readLastTs(`${base}:lastTs`, _kvGet);
      if (!lastTs || lastTs < cutoff) continue; // skip users with no recent activity
    }

    const wins   = await readNum(`${base}:wins`, _kvGet);
    const losses = await readNum(`${base}:losses`, _kvGet);
    const streak = await readNum(`${base}:streak`, _kvGet);
    const best   = await readNum(`${base}:best`, _kvGet);
    rows.push({ addr: p.wallet, points: p.points, wins, losses, streak, best });
  }

  return rows;
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
  const rows = await getLeaderboard({ limit, days, now: Date.now(), kv: { kvGet, kvZRange } });
  return new Response(JSON.stringify({ rows }), { headers: { 'content-type': 'application/json' } });
}
