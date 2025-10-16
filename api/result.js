// Records a **single bet result** into global KV and updates the sorted set.
export const config = { runtime: 'edge' };
import { kvIncrBy, kvSet, kvZAdd } from './_kv';

const WINDOW_SEC = 7 * 24 * 60 * 60; // 7 days (rolling)

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json().catch(()=>null);
  if (!body)   return new Response('Bad JSON', { status: 400 });

  const { wallet, roundId, asset, win, pointsDelta = 0, streak = 0, best = 0, ts = Date.now(), irysId } = body;
  if (!wallet || typeof roundId !== 'number') return new Response('Missing wallet/roundId', { status: 400 });

  const w = wallet.toLowerCase();
  const base = `lb:${w}`;

  // extend recency marker so the user stays in the rolling window
  await kvSet(`${base}:last`, { ts }, { ex: WINDOW_SEC }).catch(()=>{});

  const pointsKey = `${base}:points`;
  const winsKey   = `${base}:wins`;
  const lossesKey = `${base}:losses`;
  const roundsKey = `${base}:rounds`;

  const p = await kvIncrBy(pointsKey, pointsDelta).catch(()=>({ result: 0 }));
  await kvIncrBy(winsKey,   win ? 1 : 0).catch(()=>{});
  await kvIncrBy(lossesKey, win ? 0 : 1).catch(()=>{});
  await kvIncrBy(roundsKey, 1).catch(()=>{});

  await kvSet(`${base}:streak`, String(streak), { ex: WINDOW_SEC }).catch(()=>{});
  await kvSet(`${base}:best`,   String(best),   { ex: WINDOW_SEC }).catch(()=>{});
  await kvSet(`${base}:lastRec`, { roundId, asset, win, pointsDelta, ts, irysId }, { ex: WINDOW_SEC }).catch(()=>{});

  // maintain global sorted set by points
  const newPoints = Number(p?.result ?? 0);
  await kvZAdd('lb:z:points', [{ score: newPoints, member: w }]).catch(()=>{});

  return new Response(JSON.stringify({ ok: true, newPoints }), { headers: { 'content-type': 'application/json' } });
}
