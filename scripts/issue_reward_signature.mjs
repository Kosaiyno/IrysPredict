#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";

loadEnv();

const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i += 1) {
  const token = args[i];
  if (!token.startsWith("--")) continue;
  const key = token.slice(2);
  const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "";
  params[key] = value;
  if (value) i += 1;
}

function required(value, description) {
  if (!value) {
    throw new Error(`Missing required ${description}.`);
  }
  return value;
}

function toBigInt(value, description) {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid ${description}: ${value}`);
  }
}

function computeBetKey(roundId, player, asset, side) {
  const assetHash = ethers.keccak256(ethers.toUtf8Bytes(asset));
  const sideHash = ethers.keccak256(ethers.toUtf8Bytes(side));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "bytes32", "bytes32"],
      [roundId, player, assetHash, sideHash]
    )
  );
}

const privateKey = required(process.env.REWARD_POOL_OWNER_KEY, "REWARD_POOL_OWNER_KEY in .env");
const contractAddress = ethers.getAddress(
  params.contract || process.env.REWARD_POOL_ADDRESS || (() => { throw new Error("Set REWARD_POOL_ADDRESS in .env or pass --contract"); })()
);
const chainId = Number(params.chain || process.env.REWARD_POOL_CHAIN_ID || 1270);
if (!Number.isFinite(chainId)) {
  throw new Error(`Invalid chain id: ${params.chain || process.env.REWARD_POOL_CHAIN_ID}`);
}

const round = toBigInt(required(params.round, "--round"));
const player = ethers.getAddress(required(params.player, "--player"));
const asset = required(params.asset, "--asset");
const side = required(params.side, "--side");
const payoutIrys = required(params.payout, "--payout");

let payoutWei;
try {
  payoutWei = ethers.parseEther(payoutIrys);
} catch {
  throw new Error(`Invalid payout amount: ${payoutIrys}`);
}
if (payoutWei <= 0n) {
  throw new Error("Payout must be greater than zero");
}

const betKey = computeBetKey(round, player, asset, side);
const payloadHash = ethers.solidityPackedKeccak256(
  ["string", "address", "uint256", "bytes32", "address", "uint256"],
  ["IRYS_PREDICTION_REWARD", contractAddress, chainId, betKey, player, payoutWei]
);

const wallet = new ethers.Wallet(privateKey);
const signature = await wallet.signMessage(ethers.getBytes(payloadHash));

console.log("\nReward signature ready:\n");
console.log(JSON.stringify({
  betKey,
  player,
  asset,
  side,
  round: round.toString(),
  payoutIrys,
  payoutWei: payoutWei.toString(),
  contractAddress,
  chainId,
  payloadHash,
  signature,
}, null, 2));

console.log("\nShare the signature, round, asset, side, and payout with the winner so they can claim.\n");
