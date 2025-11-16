#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";
import { config as loadEnv } from "dotenv";
import solc from "solc";
import { ethers } from "ethers";

loadEnv();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("Set DEPLOYER_PRIVATE_KEY in .env before running this script.");
  process.exit(1);
}

const RPC_URL = process.env.IRYS_RPC_URL || "https://testnet-rpc.irys.xyz/v1/execution-rpc";
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

async function compileContract() {
  const sourcePath = resolve("contracts/PredictionRewardPool.sol");
  const source = readFileSync(sourcePath, "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "PredictionRewardPool.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: false, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const contractOutput = output.contracts?.["PredictionRewardPool.sol"]?.PredictionRewardPool;

  if (!contractOutput) {
    console.error("Compilation failed:", output.errors || "Unknown error");
    process.exit(1);
  }

  const abi = contractOutput.abi;
  const bytecode = contractOutput.evm?.bytecode?.object;

  if (!bytecode || bytecode.length === 0) {
    console.error("Compiled bytecode is empty. Check the contract and compiler settings.");
    process.exit(1);
  }

  return { abi, bytecode: `0x${bytecode}` };
}

async function main() {
  const { abi, bytecode } = await compileContract();

  console.log("Deploying from:", await wallet.getAddress());
  const network = await provider.getNetwork();
  console.log("Network chain ID:", network.chainId.toString());

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  const deploymentTx = contract.deploymentTransaction();
  console.log("Deployment tx hash:", deploymentTx?.hash);

  await contract.waitForDeployment();
  console.log(`✅ Reward pool deployed to ${contract.target}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
