// Backfill missing lb:<wallet>:lastTs values for existing leaderboard members.
// POST JSON accepted shapes:
// { "defaultDaysAgo": 30 }               -> sets lastTs = now - defaultDaysAgo*24h for members missing lastTs
// { "updates": [{"wallet":"0xabc...","lastTs":169...}, ...] } -> explicit per-wallet timestamps
// Requires header: x-admin-token matching process.env.BACKFILL_TOKEN to run.
export const config = { runtime: 'edge' };

async function safeJson(r) {
  try { return await r.json(); } catch { return null; }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const token = req.headers.get('x-admin-token');
  if (!process.env.BACKFILL_TOKEN || token !== process.env.BACKFILL_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const body = await safeJson(req).catch(()=>null);
  if (!body) return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: { 'content-type': 'application/json' } });

  try {
    const mod = await import('./_kv.js');
    const kvGet = mod.kvGet;
    const kvSet = mod.kvSet;
    const kvRange = mod.kvZRange;

    // get all members from sorted set
    const z = await kvRange('lb:z:points', 0, -1, true).catch(()=>null);
    const arr = Array.isArray(z?.result) ? z.result : Array.isArray(z) ? z : [];
    const members = [];
    for (let i = 0; i < arr.length; i += 2) { // arr: [member,score,member,score,...]
      members.push(String(arr[i] || '').toLowerCase());
    }

    const now = Date.now();
    const updates = [];

    if (Array.isArray(body.updates) && body.updates.length > 0) {
      // explicit updates
      for (const u of body.updates) {
        if (!u?.wallet) continue;
        const w = String(u.wallet).toLowerCase();
        const ts = Number(u.lastTs) || null;
        if (!ts) continue;
        await kvSet(`lb:${w}:lastTs`, String(ts)).catch(()=>{});
        updates.push({ wallet: w, lastTs: ts });
      }
    } else if (typeof body.defaultDaysAgo === 'number') {
      const msAgo = Math.max(0, Math.floor(body.defaultDaysAgo)) * 24 * 60 * 60 * 1000;
      const ts = now - msAgo;
      // set for members missing lastTs
      for (const m of members) {
        if (!m) continue;
        const key = `lb:${m}:lastTs`;
        const existing = await kvGet(key).catch(()=>null);
        const v = existing?.result;
        if (!v) {
          await kvSet(key, String(ts)).catch(()=>{});
          updates.push({ wallet: m, lastTs: ts });
        }
      }
    } else {
      return new Response(JSON.stringify({ error: 'nothing to do; provide updates or defaultDaysAgo' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, applied: updates.length, updates }), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error('backfill error', String(err));
    return new Response(JSON.stringify({ error: 'backfill failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
