// Returns the global leaderboard from KV (same for everyone).
export const config = { runtime: 'edge' };
import { kvGet, kvZRange } from './_kv';

async function readNum(key) {
  const r = await kvGet(key).catch(()=>null);
  const v = r?.result;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get('limit') || 100));

  // Highest points first (ZRANGE with negative indexes to get the top)
  const z = await kvZRange('lb:z:points', -limit, -1, true).catch(()=>({ result: [] }));
  const arr = Array.isArray(z.result) ? z.result : [];

  // z.result looks like ["member1","score1","member2","score2",...]
  const pairs = [];
  for (let i = arr.length - 2; i >= 0; i -= 2) {
    pairs.push({ wallet: arr[i], points: Number(arr[i+1] || 0) });
  }

  // hydrate wins/losses/streak/best
  const rows = [];
  for (const p of pairs) {
    const base = `lb:${p.wallet}`;
    const wins   = await readNum(`${base}:wins`);
    const losses = await readNum(`${base}:losses`);
    const streak = await readNum(`${base}:streak`);
    const best   = await readNum(`${base}:best`);
    rows.push({ addr: p.wallet, points: p.points, wins, losses, streak, best });
  }

  return new Response(JSON.stringify({ rows }), { headers: { 'content-type': 'application/json' } });
}
