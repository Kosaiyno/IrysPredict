// Snapshot top N wallets for the current Friday-aligned week and persist winners.
// Protected by header 'x-snapshot-token' matching process.env.SNAPSHOT_TOKEN.
export const config = { runtime: 'edge' };

function getWeekIdFromTs(tsMs) {
  const d = new Date(Number(tsMs));
  const day = d.getUTCDay();
  const daysSinceFriday = (day - 5 + 7) % 7;
  const friday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  friday.setUTCDate(friday.getUTCDate() - daysSinceFriday);
  const y = friday.getUTCFullYear();
  const m = String(friday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(friday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const token = req.headers.get('x-snapshot-token');
  if (!process.env.SNAPSHOT_TOKEN || token !== process.env.SNAPSHOT_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  try {
    const mod = await import('./_kv.js');
    const kvGet = mod.kvGet;
    const kvSet = mod.kvSet;
    const kvZRange = mod.kvZRange;
    const kvZAdd = mod.kvZAdd;

    const now = Date.now();
    const weekId = getWeekIdFromTs(now);
    const zkey = `lb:week:${weekId}:z:points`;

    // fetch top N (3)
    const raw = await kvZRange(zkey, -3, -1, true).catch(()=>null);
    const arr = Array.isArray(raw?.result) ? raw.result : Array.isArray(raw) ? raw : [];
    const pairs = [];
    for (let i = arr.length - 2; i >= 0; i -= 2) pairs.push({ wallet: arr[i], points: Number(arr[i+1] || 0) });

    const winners = [];
    for (const p of pairs) {
      const base = `lb:week:${weekId}:${p.wallet}`;
      const wins = Number((await kvGet(`${base}:wins`).catch(()=>null))?.result || 0);
      const losses = Number((await kvGet(`${base}:losses`).catch(()=>null))?.result || 0);
      const streak = Number((await kvGet(`${base}:streak`).catch(()=>null))?.result || 0);
      const best = Number((await kvGet(`${base}:best`).catch(()=>null))?.result || 0);
      winners.push({ wallet: p.wallet, points: p.points, wins, losses, streak, best });
    }

    const snapshotKey = `lb:snapshot:${weekId}`;
    const payload = { weekId, ts: now, winners };
    await kvSet(snapshotKey, payload).catch(()=>{});
    // also add to snapshot index zset for listing by time
    await kvZAdd('lb:snapshots:z', [{ score: now, member: weekId }]).catch(()=>{});

    return new Response(JSON.stringify({ ok: true, weekId, winners: winners.length }), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error('snapshot_week error', String(err));
    return new Response(JSON.stringify({ error: 'snapshot failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
