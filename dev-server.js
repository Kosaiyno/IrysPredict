// Simple local API shim for development.
// Run with: node dev-server.js
// It provides /api/leaderboard and /api/result using an in-memory KV so the frontend can fetch data.

import express from 'express';
import bodyParser from 'body-parser';

// create a minimal in-memory KV matching our test harness
function createMockKV() {
  const store = new Map();
  const zsets = new Map();

  return {
    async kvGet(key) {
      const v = store.get(key);
      return { result: v === undefined ? null : v };
    },
    async kvSet(key, value, opts) {
      store.set(key, typeof value === 'string' ? value : value);
      return { result: 'OK' };
    },
    async kvIncrBy(key, amount) {
      const cur = Number(store.get(key) || 0);
      const n = cur + Number(amount);
      store.set(key, String(n));
      return { result: String(n) };
    },
    async kvZAdd(key, members) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      const map = zsets.get(key);
      for (const m of members) map.set(m.member, Number(m.score));
      return { result: 'OK' };
    },
    async kvZRemRangeByRank(key, start, stop) {
      const map = zsets.get(key) || new Map();
      const arr = [...map.entries()].map(([member, score]) => ({ member, score }));
      arr.sort((a,b) => a.score - b.score);
      const getIndex = (i) => i < 0 ? arr.length + i : i;
      const s = Math.max(0, getIndex(start));
      const e = Math.min(arr.length - 1, getIndex(stop));
      if (s > e) return { result: 0 };
      for (let i = s; i <= e; i++) {
        const item = arr[i];
        map.delete(item.member);
      }
      return { result: e - s + 1 };
    },
    async kvZRange(key, start, stop, withScores = false) {
      const map = zsets.get(key) || new Map();
      const arr = [...map.entries()].map(([member, score]) => ({ member, score }));
      arr.sort((a,b) => a.score - b.score);
      const getIndex = (i) => i < 0 ? arr.length + i : i;
      const s = Math.max(0, getIndex(start));
      const e = Math.min(arr.length - 1, getIndex(stop));
      if (s > e) return { result: [] };
      const slice = arr.slice(s, e+1);
      if (withScores) {
        const out = [];
        for (const it of slice) out.push(it.member, String(it.score));
        return { result: out };
      }
      return { result: slice.map(x => x.member) };
    }
  };
}

(async function start() {
  const app = express();
  app.use(bodyParser.json());

  const port = 8787;
  const kv = createMockKV();

  // lazily import handlers
  const { getLeaderboard } = await import('./api/leaderboard.js');
  const { processResult } = await import('./api/result.js');
  const historyHandler = (await import('./api/history.js')).default;

  app.get('/api/leaderboard', async (req, res) => {
    try {
      const limit = Math.min(200, Number(req.query.limit || 100));
      const days = req.query.days === undefined ? 7 : Number(req.query.days);
      const rows = await getLeaderboard({ limit, days, now: Date.now(), kv: { kvGet: kv.kvGet, kvZRange: kv.kvZRange } });
      res.json({ rows });
    } catch (e) {
      console.error('GET /api/leaderboard error', e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/result', async (req, res) => {
    try {
      const body = req.body;
      const r = await processResult(body, { kvSet: kv.kvSet, kvIncrBy: kv.kvIncrBy, kvZAdd: kv.kvZAdd, kvZRemRangeByRank: kv.kvZRemRangeByRank });
      res.json(r);
    } catch (e) {
      console.error('POST /api/result error', e);
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/history', async (req, res) => {
    try {
      const url = new URL(req.originalUrl || req.url, `http://localhost:${port}`);
      const request = new Request(url, { method: 'GET' });
      const response = await historyHandler(request, { kvZRange: kv.kvZRange });
      res.status(response.status);
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const text = await response.text();
      res.send(text);
    } catch (e) {
      console.error('GET /api/history error', e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.listen(port, () => console.log(`Local API shim listening on http://localhost:${port}`));
})();
