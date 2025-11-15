// /api/_kv.js
// Upstash Redis REST helpers (Edge-safe)
// Uses REST "path" API: https://docs.upstash.com/redis/rest

function getEnv() {
  const url = process.env.KV_REST_API_URL;     // e.g. https://<db>.upstash.io
  const token = process.env.KV_REST_API_TOKEN; // e.g. AT8tAAI...
  if (!url || !token) {
    throw new Error("KV env missing: set KV_REST_API_URL and KV_REST_API_TOKEN in Vercel → Settings → Environment Variables (no quotes).");
  }
  return { url, token };
}

async function callPath(parts) {
  const { url, token } = getEnv();
  const path = parts.map((p) => encodeURIComponent(String(p))).join("/");
  const res = await fetch(`${url}/${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KV ${path} ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { result: text }; }
}

// ---------- Basic commands ----------
export function kvGet(key) {
  return callPath(["get", key]);
}

export function kvSet(key, value, opts = {}) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  const args = ["set", key, v];
  if (opts.ex) args.push("EX", String(opts.ex)); // seconds
  return callPath(args);
}

export function kvIncrBy(key, amount) {
  return callPath(["incrby", key, String(amount)]);
}

// ---------- Sorted set helpers ----------
/**
 * members: [{ score: number, member: string }]
 */
export function kvZAdd(key, members) {
  const args = ["zadd", key];
  for (const m of members) {
    args.push(String(m.score), m.member);
  }
  return callPath(args);
}

/**
 * withScores=false -> Upstash returns an array of members
 * withScores=true  -> returns [member, score, member, score, ...]
 */
export function kvZRange(key, start, stop, withScores = false) {
  const args = ["zrange", key, String(start), String(stop)];
  if (withScores) args.push("WITHSCORES");
  return callPath(args);
}

export function kvZRemRangeByRank(key, start, stop) {
  return callPath(["zremrangebyrank", key, String(start), String(stop)]);
}
