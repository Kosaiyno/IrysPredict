// Debug endpoint to inspect leaderboard sorted set and per-wallet lastTs presence.
// Protected by the same BACKFILL_TOKEN header to avoid public exposure.
export const config = { runtime: 'edge' };

async function safeJson(r){ try { return await r.json(); } catch { return null; } }

export default async function handler(req){
  const token = req.headers.get('x-admin-token');
  if (!process.env.BACKFILL_TOKEN || token !== process.env.BACKFILL_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  try {
    const mod = await import('./_kv.js');
    const kvRange = mod.kvZRange;
    const kvGet = mod.kvGet;

    const z = await kvRange('lb:z:points', 0, -1, true).catch(()=>null);
    const arr = Array.isArray(z?.result) ? z.result : Array.isArray(z) ? z : [];
    const members = [];
    for (let i = 0; i < arr.length; i += 2) {
      const m = String(arr[i] || '').toLowerCase();
      const s = Number(arr[i+1] || 0);
      if (m) members.push({ wallet: m, score: s });
    }

    // sample up to 200 members to check lastTs presence
    const sample = members.slice(0, 200);
    const checks = [];
    const now = Date.now();
    const cutoffs = {
      '1': now - 1 * 24 * 60 * 60 * 1000,
      '7': now - 7 * 24 * 60 * 60 * 1000,
      '30': now - 30 * 24 * 60 * 60 * 1000,
    };

    for (const m of sample) {
      const k = `lb:${m.wallet}:lastTs`;
      const r = await kvGet(k).catch(()=>null);
      const v = r?.result;
      const num = Number(v);
      checks.push({
        wallet: m.wallet,
        score: m.score,
        lastTs: v ?? null,
        lastTsNum: Number.isFinite(num) ? num : null,
        included: {
          '1': Number.isFinite(num) ? (num >= cutoffs['1']) : false,
          '7': Number.isFinite(num) ? (num >= cutoffs['7']) : false,
          '30': Number.isFinite(num) ? (num >= cutoffs['30']) : false,
        }
      });
    }

    const missing = checks.filter(c => !c.lastTs).length;
    return new Response(JSON.stringify({ ok: true, now, cutoffs, membersCount: members.length, sampleCount: checks.length, missingInSample: missing, sample: checks }), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error('debug_kv error', String(err));
    return new Response(JSON.stringify({ error: 'debug failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
