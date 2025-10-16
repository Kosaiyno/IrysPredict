export const config = { runtime: 'edge' };

const ROUND_MS = 5 * 60 * 1000;
const BET_LOCK_MS = 60 * 1000;

export default async function handler() {
  const now = Date.now();
  const roundId = Math.floor(now / ROUND_MS);
  const roundEnd = (roundId + 1) * ROUND_MS;
  const msRemaining = roundEnd - now;
  const msElapsed = ROUND_MS - msRemaining;
  return new Response(
    JSON.stringify({
      now, roundId, roundMs: ROUND_MS,
      roundEnd, msRemaining, msElapsed,
      betLockMs: BET_LOCK_MS, bettingOpen: msElapsed < BET_LOCK_MS
    }),
    { headers: { 'content-type': 'application/json' } }
  );
}
