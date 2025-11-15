import { ethers } from "ethers";

export const config = { runtime: "edge" };

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

async function loadKv() {
  const mod = await import("./_kv.js");
  return {
    kvZRange: mod.kvZRange,
    kvGet: mod.kvGet,
  };
}

function computeBetKey(roundId, player, asset, side) {
  const assetBytes = ethers.toUtf8Bytes(asset || "");
  const sideBytes = ethers.toUtf8Bytes(side || "");
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "bytes32", "bytes32"],
      [roundId, player, ethers.keccak256(assetBytes), ethers.keccak256(sideBytes)]
    )
  );
}

function buildRewardHash(contractAddress, chainId, betKey, player, payoutWei) {
  return ethers.solidityPackedKeccak256(
    ["string", "address", "uint256", "bytes32", "address", "uint256"],
    [
      "IRYS_PREDICTION_REWARD",
      contractAddress,
      chainId,
      betKey,
      player,
      payoutWei,
    ]
  );
}

function parseBody(body) {
  const { roundId, asset, side, wallet, payoutIrys } = body || {};
  if (typeof wallet !== "string" || !wallet.startsWith("0x")) {
    throw new Error("wallet must be a checksum address");
  }
  if (typeof asset !== "string" || !asset) {
    throw new Error("asset is required");
  }
  if (typeof side !== "string" || !side) {
    throw new Error("side is required");
  }
  let round;
  try {
    round = BigInt(roundId);
  } catch {
    throw new Error("roundId must be a valid integer");
  }
  const player = ethers.getAddress(wallet);
  const payout = typeof payoutIrys === "string" ? payoutIrys : String(payoutIrys || "");
  let payoutWei;
  try {
    payoutWei = ethers.parseEther(payout);
  } catch {
    throw new Error("Invalid payout amount");
  }
  if (payoutWei <= 0n) {
    throw new Error("Payout must be greater than zero");
  }
  return { round, player, asset, side, payoutIrys: payout, payoutWei };
}

async function ensureWinRecorded({ kvZRange }, wallet) {
  const key = `lb:hist:${wallet.toLowerCase()}`;
  const res = await kvZRange(key, -50, -1, true).catch(() => null);
  const raw = Array.isArray(res?.result) ? res.result : Array.isArray(res) ? res : [];
  const entries = [];
  for (let i = raw.length - 2; i >= 0; i -= 2) {
    try {
      entries.push(JSON.parse(raw[i]));
    } catch {
      continue;
    }
  }
  return entries;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, { status: 405 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) throw new Error("Bad JSON body");

    const { round, player, asset, side, payoutIrys, payoutWei } = parseBody(body);

    const kv = await loadKv();
    const historyEntries = await ensureWinRecorded(kv, player);
    const matching = historyEntries.find((entry) => {
      return (
        Number(entry?.roundId) === Number(round) &&
        (entry?.asset || "").toUpperCase() === asset.toUpperCase() &&
        (entry?.side || "").toUpperCase() === side.toUpperCase() &&
        !!entry?.win
      );
    });

    if (!matching) {
      return jsonResponse({ error: "Winner not found" }, { status: 404 });
    }

    const allowedDelta = Math.abs(Number(matching.delta ?? 0));
    const payoutIrysNum = Number(payoutIrys);
    if (Number.isFinite(allowedDelta) && allowedDelta > 0 && payoutIrysNum > allowedDelta) {
      return jsonResponse({ error: "Payout exceeds recorded win" }, { status: 400 });
    }

    const privateKey = requiredEnv("REWARD_POOL_OWNER_KEY");
    const contractAddress = ethers.getAddress(requiredEnv("REWARD_POOL_ADDRESS"));
    const chainId = Number(process.env.REWARD_POOL_CHAIN_ID || 1270);

    const betKey = computeBetKey(round, player, asset, side);
    const payloadHash = buildRewardHash(contractAddress, chainId, betKey, player, payoutWei);

    const wallet = new ethers.Wallet(privateKey);
    const signature = await wallet.signMessage(ethers.getBytes(payloadHash));

    return jsonResponse({
      betKey,
      round: round.toString(),
      asset,
      side,
      player,
      payoutIrys,
      payoutWei: payoutWei.toString(),
      contractAddress,
      chainId,
      signature,
      payloadHash,
    });
  } catch (err) {
    console.error("reward-signature error", err);
    return jsonResponse({ error: err.message || "internal error" }, { status: 400 });
  }
}
