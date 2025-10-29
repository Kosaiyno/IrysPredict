import { processResult } from '../api/result.js';
import { getLeaderboard } from '../api/leaderboard.js';

// In-memory mock KV implementation that mirrors the minimal Upstash responses used by the app
function createMockKV() {
  const store = new Map();
  const zsets = new Map();

  return {
    async kvGet(key) {
      const v = store.get(key);
      return { result: v === undefined ? null : v };
    },
    async kvSet(key, value, opts) {
      // store raw value (no JSON encoding) to mirror earlier code expectations
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
      for (const m of members) {
        map.set(m.member, Number(m.score));
      }
      return { result: 'OK' };
    },
    async kvZRange(key, start, stop, withScores = false) {
      const map = zsets.get(key) || new Map();
      const arr = [...map.entries()].map(([member, score])=>({ member, score }));
      // sort ascending by score (Upstash zrange is ascending)
      arr.sort((a,b)=> a.score - b.score);
      // handle negative indexes
      const getIndex = (i) => i < 0 ? arr.length + i : i;
      const s = Math.max(0, getIndex(start));
      const e = Math.min(arr.length - 1, getIndex(stop));
      if (s > e) return { result: [] };
      const slice = arr.slice(s, e+1);
      if (withScores) {
        const out = [];
        for (const it of slice) { out.push(it.member, String(it.score)); }
        return { result: out };
      }
      return { result: slice.map(x=>x.member) };
    }
  };
}

(async function test() {
  const mock = createMockKV();
  // Inject mock into wrappers expected by processResult and getLeaderboard
  const kvFuncsForProcess = { kvSet: mock.kvSet, kvIncrBy: mock.kvIncrBy, kvZAdd: mock.kvZAdd };
  const kvFuncsForLeaderboard = { kvGet: mock.kvGet, kvZRange: mock.kvZRange };

  const now = Date.now();
  // wallet A: active 2 days ago, 50 points
  await processResult({ wallet: '0xA', roundId: 1, asset: 'BTC', win: true, pointsDelta: 50, streak: 1, best:1, ts: now - 2*24*60*60*1000 }, kvFuncsForProcess);
  // wallet B: active 10 days ago, 30 points
  await processResult({ wallet: '0xB', roundId: 2, asset: 'ETH', win: true, pointsDelta: 30, streak: 1, best:1, ts: now - 10*24*60*60*1000 }, kvFuncsForProcess);
  // wallet C: active 1 day ago, 40 points
  await processResult({ wallet: '0xC', roundId: 3, asset: 'BTC', win: true, pointsDelta: 40, streak: 1, best:1, ts: now - 1*24*60*60*1000 }, kvFuncsForProcess);

  console.log('--- All-time leaderboard ---');
  const all = await getLeaderboard({ limit: 10, days: 0, now, kv: kvFuncsForLeaderboard });
  console.log(all);

  console.log('--- 7-day leaderboard (should include A and C, not B) ---');
  const seven = await getLeaderboard({ limit: 10, days: 7, now, kv: kvFuncsForLeaderboard });
  console.log(seven);

  console.log('--- 1-day leaderboard (should include C only) ---');
  const one = await getLeaderboard({ limit: 10, days: 1, now, kv: kvFuncsForLeaderboard });
  console.log(one);

})();
