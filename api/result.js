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

  // --- Weekly (Friday-aligned) scoped stats ---
  try {
    const getWeekId = (tsMs) => {
      const d = new Date(Number(tsMs));
      // use UTC day (0 = Sunday, 5 = Friday)
      const day = d.getUTCDay();
      const daysSinceFriday = (day - 5 + 7) % 7;
      const friday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      friday.setUTCDate(friday.getUTCDate() - daysSinceFriday);
      // week id as YYYY-MM-DD
      const y = friday.getUTCFullYear();
      const m = String(friday.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(friday.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };

    const weekId = getWeekId(ts);
    const wPointsKey = `lb:week:${weekId}:${w}:points`;
    const wWinsKey   = `lb:week:${weekId}:${w}:wins`;
    const wLossesKey = `lb:week:${weekId}:${w}:losses`;
    const wStreakKey = `lb:week:${weekId}:${w}:streak`;
    const wBestKey   = `lb:week:${weekId}:${w}:best`;
    const wZKey      = `lb:week:${weekId}:z:points`;

    // increment weekly counters
    const wp = await _kvIncrBy(wPointsKey, pointsDelta).catch(()=>({ result: 0 }));
    await _kvIncrBy(wWinsKey,   win ? 1 : 0).catch(()=>{});
    await _kvIncrBy(wLossesKey, win ? 0 : 1).catch(()=>{});

    // write weekly streak/best as strings (keep parity with existing keys)
    await _kvSet(wStreakKey, String(streak), { ex: 7 * 24 * 60 * 60 }).catch(()=>{});
    await _kvSet(wBestKey,   String(best),   { ex: 7 * 24 * 60 * 60 }).catch(()=>{});

    const newWeekPoints = Number(wp?.result ?? 0);
    await _kvZAdd(wZKey, [{ score: newWeekPoints, member: w }]).catch(()=>{});
  } catch(e) {
    // swallow weekly errors to avoid breaking the main flow
  }

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

