// Records a **single bet result** into global KV and updates the sorted set.
export const config = { runtime: 'edge' };


const WINDOW_SEC = 7 * 24 * 60 * 60; // 7 days (rolling)

// Exported helper for tests: inject kv functions to avoid calling real Upstash.
export async function processResult(body, kv) {
  // if no kv provided, dynamically import the real one (runtime use)
  if (!kv) {
    const mod = await import('./_kv.js');
    kv = { kvSet: mod.kvSet, kvIncrBy: mod.kvIncrBy, kvZAdd: mod.kvZAdd };
  }
  const { kvSet: _kvSet, kvIncrBy: _kvIncrBy, kvZAdd: _kvZAdd } = kv;
  const { wallet, roundId, asset, win, pointsDelta = 0, streak = 0, best = 0, ts = Date.now(), irysId } = body;
  if (!wallet || typeof roundId !== 'number') throw new Error('Missing wallet/roundId');

  const w = wallet.toLowerCase();
  const base = `lb:${w}`;

  // extend recency marker so the user stays in the rolling window
  await _kvSet(`${base}:last`, { ts }, { ex: WINDOW_SEC }).catch(()=>{});
  // persistent timestamp so the leaderboard can compute arbitrary rolling windows
  await _kvSet(`${base}:lastTs`, String(ts)).catch(()=>{});

  const pointsKey = `${base}:points`;
  const winsKey   = `${base}:wins`;
  const lossesKey = `${base}:losses`;
  const roundsKey = `${base}:rounds`;

  const p = await _kvIncrBy(pointsKey, pointsDelta).catch(()=>({ result: 0 }));
  await _kvIncrBy(winsKey,   win ? 1 : 0).catch(()=>{});
  await _kvIncrBy(lossesKey, win ? 0 : 1).catch(()=>{});
  await _kvIncrBy(roundsKey, 1).catch(()=>{});

  await _kvSet(`${base}:streak`, String(streak), { ex: WINDOW_SEC }).catch(()=>{});
  await _kvSet(`${base}:best`,   String(best),   { ex: WINDOW_SEC }).catch(()=>{});
  await _kvSet(`${base}:lastRec`, { roundId, asset, win, pointsDelta, ts, irysId }, { ex: WINDOW_SEC }).catch(()=>{});

  // maintain global sorted set by points
  const newPoints = Number(p?.result ?? 0);
  await _kvZAdd('lb:z:points', [{ score: newPoints, member: w }]).catch(()=>{});

  return { ok: true, newPoints };
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json().catch(()=>null);
  if (!body)   return new Response('Bad JSON', { status: 400 });
  try {
    const r = await processResult(body);
    return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(String(e?.message || 'error'), { status: 400 });
  }
}

