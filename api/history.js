export const config = { runtime: 'edge' };

function parseLimit(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 50;
  return Math.min(200, Math.max(1, Math.floor(num)));
}

export default async function handler(req, injected = {}) {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const wallet = (url.searchParams.get('wallet') || '').toLowerCase();
    if (!wallet || !wallet.startsWith('0x')) {
      return new Response(
        JSON.stringify({ error: 'wallet query param required' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    const limit = parseLimit(url.searchParams.get('limit'));

  const kvZRange = injected.kvZRange || (await import('./_kv.js')).kvZRange;

    const key = `lb:hist:${wallet}`;
    const res = await kvZRange(key, -limit, -1, true).catch(() => null);
    const raw = Array.isArray(res?.result) ? res.result : Array.isArray(res) ? res : [];

    const entries = [];
    for (let i = raw.length - 2; i >= 0; i -= 2) {
      const member = raw[i];
      const decoded = safeParse(member);
      if (decoded) entries.push(decoded);
    }

    return new Response(
      JSON.stringify({ wallet, entries }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    console.error('history handler error', err);
    return new Response(
      JSON.stringify({ error: 'history error' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
