// Simple Upstash Redis REST helpers
const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(path, body) {
  const res = await fetch(`${URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KV ${path} ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { result: text }; }
}

export const kvIncrBy = (key, amount)          => kv('/incrby', { key, amount });
export const kvSet    = (key, value, opts={})   => kv('/set', { key, value, ...opts });
export const kvGet    = (key)                   => kv('/get', { key });
export const kvZAdd   = (key, members)          => kv('/zadd', { key, members });
export const kvZRange = (key, start, stop, withScores=false) =>
  kv('/zrange', { key, start, stop, withScores });
