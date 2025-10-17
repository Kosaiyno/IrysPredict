// Upstash Redis REST helpers (EDGE-safe)
// Uses REST "path" API: https://docs.upstash.com/redis/rest-api

const URL = process.env.KV_REST_API_URL;   // e.g. https://grateful-mayfly-16173.upstash.io
const TOKEN = process.env.KV_REST_API_TOKEN;

function must(v, name) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
const BASE = must(URL, 'KV_REST_API_URL');
const AUTH = must(TOKEN, 'KV_REST_API_TOKEN');

async function redisGET(path) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${AUTH}` },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KV ${path} ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { result: text }; }
}

// Standard commands via REST path format
export const kvSet = (key, value, opts={}) => {
  // opts.ex -> seconds to expire
  const ex = opts.ex ? `/EX/${opts.ex}` : '';
  // value must be string
  return redisGET(`set/${encodeURIComponent(key)}/${encodeURIComponent(
    typeof value === 'string' ? value : JSON.stringify(value)
  )}${ex}`);
};

export const kvGet = (key) =>
  redisGET(`get/${encodeURIComponent(key)}`);

export const kvIncrBy = (key, amount) =>
  redisGET(`incrby/${encodeURIComponent(key)}/${encodeURIComponent(String(amount))}`);

// Sorted set helpers
// members: [{ score: number, member: string }]
export const kvZAdd = (key, members) => {
  const parts = [];
  for (const m of members) {
    parts.push(encodeURIComponent(String(m.score)));
    parts.push(encodeURIComponent(m.member));
  }
  return redisGET(`zadd/${encodeURIComponent(key)}/${parts.join('/')}`);
};

// withScores=true returns array [member, score, member, score, ...]
export const kvZRange = (key, start, stop, withScores=false) =>
  redisGET(`zrange/${encodeURIComponent(key)}/${start}/${stop}${withScores ? '/WITHSCORES' : ''}`);
