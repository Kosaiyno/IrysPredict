// ====== Imports (Irys + Ethers) ======
import { WebUploader } from "@irys/web-upload";
import { WebEthereum } from "@irys/web-upload-ethereum";
import { EthersV6Adapter } from "@irys/web-upload-ethereum-ethers-v6";
import { ethers } from "ethers";

// ====== Helpers ======
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const short = (a) => (a ? a.slice(0, 6) + "..." + a.slice(-4) : "");
const fmtUsd = (n, d = 2) =>
  typeof n === "number" ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: d })}` : "$--";

function formatStakeAmount(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return String(amount ?? "");
  return num.toFixed(3).replace(/\.0+$/, "").replace(/\.$/, "");
}

function clearCardStatus(card) {
  const status = card?.querySelector(".card-status");
  if (!status) return;
  status.className = "card-status";
  status.textContent = "";
}

function setCardStatus(card, message, state = "info") {
  const status = card?.querySelector(".card-status");
  if (!status) return;
  status.className = "card-status";
  if (!message) {
    status.textContent = "";
    return;
  }
  status.classList.add("visible");
  if (state === "loading") {
    status.classList.add("is-loading");
    status.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${message}</span>`;
    return;
  }
  if (state === "success") status.classList.add("is-success");
  if (state === "error") status.classList.add("is-error");
  status.textContent = message;
}

function clearAllCardStatuses() {
  $$(".card").forEach((card) => clearCardStatus(card));
}

const formatPoints = (delta) => {
  if (typeof delta !== "number" || Number.isNaN(delta)) return "0 pts";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} pts`;
};

function getDisplayWalletAddress() {
  return typeof walletAddress === "string" ? walletAddress : null;
}

function showBetOutcomeMessage({ asset, win, delta, pending, roundId, side, betKey, suggestedPayoutIrys }) {
  const card = document.querySelector(`[data-asset='${asset}']`);
  if (!card) return;
  const container = card.querySelector(".active-bet .bet-result");
  if (!container) return;

  container.className = "bet-result";
  container.innerHTML = "";

  if (pending) {
    const pendingMsg = "Result pending…";
    container.textContent = pendingMsg;
    container.classList.add("visible");
    setCardStatus(card, pendingMsg, "info");
    setTimeout(() => {
      clearCardStatus(card);
      container.classList.remove("visible");
    }, 5000);
    return;
  }

  if (win) {
    let resolvedBetKey = betKey;
    if (!resolvedBetKey) {
      const player = getDisplayWalletAddress();
      if (player) {
        try {
          resolvedBetKey = computeBetKey(roundId, player, asset, side);
        } catch {
          resolvedBetKey = null;
        }
      }
    }

    const header = document.createElement("div");
    header.textContent = `✅ You won ${formatPoints(delta)}`;
    container.appendChild(header);

    const keyHint = document.createElement("small");
    keyHint.className = "claim-hint";
    if (resolvedBetKey) {
      keyHint.innerHTML = `Bet key: <code>${short(resolvedBetKey)}</code>`;
      keyHint.title = resolvedBetKey;
    } else {
      keyHint.textContent = "Bet key will appear after reconnecting your wallet.";
    }
    container.appendChild(keyHint);

    const instructions = document.createElement("small");
    instructions.className = "claim-hint";
    instructions.textContent = "Click claim to fetch your reward signature and withdraw.";
    container.appendChild(instructions);

    const claimBtn = document.createElement("button");
    claimBtn.type = "button";
    claimBtn.className = "btn claim-btn";
    claimBtn.textContent = "Claim reward";
    claimBtn.addEventListener("click", () => {
      initiateRewardClaim({
        card,
        roundId,
        asset,
        side,
        betKey: resolvedBetKey,
        resultContainer: container,
        suggestedPayoutIrys,
      });
    });
    container.appendChild(claimBtn);

    container.classList.add("visible", "win");
    setCardStatus(card, `You won ${formatPoints(delta)}! Use the host signature to redeem your IRYS.`, "success");
    return;
  }

  const message = `❌ You lost ${formatPoints(delta)}`;
  container.textContent = message;
  container.classList.add("visible", "loss");
  setCardStatus(card, message, "error");
  setTimeout(() => {
    clearCardStatus(card);
    container.classList.remove("visible");
  }, 6500);
}


function showBetResults(results = []) {
  if (!Array.isArray(results) || results.length === 0) return;
  const activeWallet = getDisplayWalletAddress();
  if (!activeWallet) return;
  const target = activeWallet.toLowerCase();
  results
    .filter((r) => (r.wallet || "").toLowerCase() === target)
    .forEach((res) => showBetOutcomeMessage(res));
}

const leaderboardCache = {
  ttlMs: 30_000,
  entries: new Map(),
  pending: new Map(),
};

function getStoredLeaderboardRows(days) {
  const entry = leaderboardCache.entries.get(String(days));
  return entry ? entry.rows : null;
}

function hasFreshLeaderboardRows(days) {
  const entry = leaderboardCache.entries.get(String(days));
  if (!entry) return false;
  return Date.now() - entry.ts <= leaderboardCache.ttlMs;
}

function storeLeaderboardRows(days, rows) {
  leaderboardCache.entries.set(String(days), { rows, ts: Date.now() });
}

async function ensureLeaderboardData(days, { force = false } = {}) {
  const key = String(days);
  if (!force && hasFreshLeaderboardRows(days)) {
    return getStoredLeaderboardRows(days) || [];
  }

  if (!force && leaderboardCache.pending.has(key)) {
    return leaderboardCache.pending.get(key);
  }

  const promise = (async () => {
    try {
      const rows = await fetchGlobalLeaderboard(days);
      storeLeaderboardRows(days, rows);
      return rows;
    } finally {
      leaderboardCache.pending.delete(key);
    }
  })();

  leaderboardCache.pending.set(key, promise);
  return promise;
}

function renderLeaderboardRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<tr><td>-</td><td>-</td><td>0</td><td>0</td><td>0</td><td class="col-hide-sm">0</td><td class="col-hide-sm">0</td></tr>`;
  }
  return rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${short(r.addr)}</td>
      <td><b>${r.points}</b></td>
      <td>${r.wins}</td>
      <td>${r.losses}</td>
      <td class="col-hide-sm">${r.streak ?? 0}</td>
      <td class="col-hide-sm">${r.best ?? 0}</td>
    </tr>`).join("");
}

function getActiveLeaderboardDays() {
  const activePill = document.querySelector('#lbRangePills .seg-btn[aria-pressed="true"]');
  if (activePill) {
    const val = Number(activePill.dataset.days);
    return Number.isFinite(val) ? val : 7;
  }
  if (lbRangeSel) {
    const val = Number(lbRangeSel.value);
    return Number.isFinite(val) ? val : 7;
  }
  return 7;
}

const formatResolvedTs = (ts) => {
  const num = Number(ts);
  if (!Number.isFinite(num)) return "";
  return new Date(num).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

let historyCache = { wallet: null, entries: [], loading: false };
function invalidateHistoryCache() {
  historyCache.entries = [];
  historyCache.loading = false;
}

async function renderHistory(){
  const container = $("#historyBody");
  if (!container) return;
  const wallet = getDisplayWalletAddress();
  if (!wallet){
    container.innerHTML = '<p class="history-empty">Connect your wallet to view past predictions.</p>';
    historyCache = { wallet: null, entries: [], loading: false };
    return;
  }

  if (historyCache.wallet !== wallet.toLowerCase()) {
    historyCache = { wallet: wallet.toLowerCase(), entries: [], loading: false };
  }

  const needsFetch = historyCache.entries.length === 0;

  if (needsFetch && !historyCache.loading) {
    container.innerHTML = '<p class="history-empty">Loading history…</p>';
    historyCache.loading = true;
    try {
      const res = await fetch(`/api/history?wallet=${encodeURIComponent(wallet)}`);
      if (!res.ok) throw new Error('history failed');
      const data = await res.json();
      historyCache.entries = Array.isArray(data?.entries) ? data.entries : [];
    } catch (err) {
      container.innerHTML = '<p class="history-empty">History unavailable right now.</p>';
      historyCache.loading = false;
      return;
    } finally {
      historyCache.loading = false;
    }
  }

  const entries = historyCache.entries;
  if (!entries.length){
    container.innerHTML = '<p class="history-empty">No predictions yet. Make your first call!</p>';
    return;
  }

  const html = entries.map((entry)=>{
    const win = !!entry.win;
    const outcome = win ? "Won" : "Lost";
    const deltaStr = typeof entry.delta === "number" ? formatPoints(entry.delta) : "";
    const priceStart = typeof entry.priceAtBet === "number" ? fmtUsd(entry.priceAtBet,4) : "$--";
    const priceEnd = typeof entry.priceAtClose === "number" ? fmtUsd(entry.priceAtClose,4) : "$--";
    const resolved = formatResolvedTs(entry.ts);
    const irysLink = entry.irysId ? `<a class="history-link" href="https://gateway.irys.xyz/${entry.irysId}" target="_blank" rel="noreferrer">View receipt ↗</a>` : "";
    return `
      <article class="history-item ${win ? "win" : "loss"}">
        <div class="history-row">
          <strong>${entry.asset || "?"} · ${entry.side || ""}</strong>
          <span class="history-points">${outcome} ${deltaStr}</span>
        </div>
        <div class="history-row small">
          <span>Round ${entry.roundId ?? "-"}</span>
          <span>${resolved}</span>
        </div>
        <div class="history-meta">
          <span>Locked: ${priceStart}</span>
          <span>Settled: ${priceEnd}</span>
          ${irysLink ? `<span>${irysLink}</span>` : ""}
        </div>
      </article>`;
  }).join("");
  container.innerHTML = html;
}

// ====== Keys ======
const ROUND_STATE_KEY   = "round_state_v1";     // {startTs, endTs, roundId}
const OPEN_BETS_KEY     = "open_bets_v1";       // { [roundId]: Bet[] }
const LAST_WALLET_KEY   = "last_wallet_address_v1";

const STAKE_LEDGER_KEY  = "reward_pool_stakes_v1";   // { [wallet]: { [betKey]: StakeLedgerEntry } }

const ENTRY_FEE_IRYS = 0.1;
const ENTRY_FEE_WEI = ethers.parseEther("0.1");
const MAX_STAKE_RECORDS_PER_WALLET = 64;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const REWARD_POOL_ADDRESS = (() => {
  let candidate;
  try {
    const envCandidate = typeof import.meta !== "undefined" ? import.meta.env?.VITE_REWARD_POOL_ADDRESS : undefined;
    if (envCandidate) candidate = envCandidate;
  } catch {
    // ignore env access issues
  }
  if (!candidate && typeof window !== "undefined") {
    candidate = window.IRYS_REWARD_POOL_ADDRESS || window.REWARD_POOL_ADDRESS;
  }
  if (typeof candidate === "string" && candidate) {
    try {
      return ethers.getAddress(candidate);
    } catch {
      console.warn("Invalid reward pool address configured:", candidate);
    }
  }
  return ZERO_ADDRESS;
})();
const REWARD_POOL_ABI = [
  "function ENTRY_FEE_WEI() view returns (uint256)",
  "function placeBet(uint256 roundId, string asset, string side) payable returns (bytes32)",
  "function hasBet(uint256 roundId, address player, string asset, string side) view returns (bool)",
  "function claimReward(uint256 roundId, string asset, string side, uint256 payout, bytes signature)",
  "function computeBetKey(uint256 roundId, address player, string asset, string side) view returns (bytes32)",
];

const defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder();

function normalizeWallet(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function loadStakeLedger() {
  try {
    const raw = localStorage.getItem(STAKE_LEDGER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStakeLedger(ledger) {
  localStorage.setItem(STAKE_LEDGER_KEY, JSON.stringify(ledger));
}

function getStakeEntry(wallet, betKey) {
  const normalizedWallet = normalizeWallet(wallet);
  if (!normalizedWallet) return null;
  const ledger = loadStakeLedger();
  const rounds = ledger[normalizedWallet];
  if (!rounds) return null;
  return rounds[String(betKey)] ?? null;
}

function recordStakeEntry(wallet, betKey, entry) {
  const normalizedWallet = normalizeWallet(wallet);
  if (!normalizedWallet) return;
  const ledger = loadStakeLedger();
  const recordKey = String(betKey);
  const rounds = ledger[normalizedWallet] ?? {};
  rounds[recordKey] = entry;

  const ordered = Object.keys(rounds)
    .map((key) => ({ key, ts: Number(rounds[key]?.ts) || 0 }))
    .sort((a, b) => a.ts - b.ts);
  while (ordered.length > MAX_STAKE_RECORDS_PER_WALLET) {
    const oldest = ordered.shift();
    if (oldest) delete rounds[oldest.key];
  }

  ledger[normalizedWallet] = rounds;
  saveStakeLedger(ledger);
}

function clearStakeEntriesForRound(roundId) {
  const ledger = loadStakeLedger();
  let mutated = false;
  Object.keys(ledger).forEach((wallet) => {
    const rounds = ledger[wallet];
    if (!rounds) return;
    Object.entries(rounds).forEach(([key, entry]) => {
      if (entry?.roundId === roundId) {
        delete rounds[key];
        mutated = true;
      }
    });
    if (Object.keys(rounds).length === 0) delete ledger[wallet];
  });
  if (mutated) saveStakeLedger(ledger);
}

function computeBetKey(roundId, wallet, asset, side) {
  const checksumWallet = ethers.getAddress(wallet);
  const assetHash = ethers.keccak256(ethers.toUtf8Bytes(asset || ""));
  const sideHash = ethers.keccak256(ethers.toUtf8Bytes(side || ""));
  const roundValue = typeof roundId === "bigint"
    ? roundId
    : BigInt(Math.floor(Number(roundId) || 0));
  return ethers.keccak256(
    defaultAbiCoder.encode([
      "uint256",
      "address",
      "bytes32",
      "bytes32",
    ], [
      roundValue,
      checksumWallet,
      assetHash,
      sideHash,
    ])
  );
}

function getRewardPoolContract(signerOrProvider) {
  const addr = REWARD_POOL_ADDRESS;
  if (!addr || addr === ZERO_ADDRESS) {
    throw new Error("Reward pool contract address not configured.");
  }
  return new ethers.Contract(addr, REWARD_POOL_ABI, signerOrProvider);
}

async function ensureRewardStake({ signer, roundId, asset, side, card }) {
  if (!signer) throw new Error("Signer unavailable for reward pool entry");

  const betKey = computeBetKey(roundId, walletAddress, asset, side);
   const cached = getStakeEntry(walletAddress, betKey);
  if (cached) return cached;

  const contract = getRewardPoolContract(signer);
  let entryFeeWei = ENTRY_FEE_WEI;
  let entryFeeIrys = ENTRY_FEE_IRYS;
  try {
    const onchainFee = await contract.ENTRY_FEE_WEI();
    if (onchainFee) {
      entryFeeWei = onchainFee;
      entryFeeIrys = Number(ethers.formatEther(onchainFee));
    }
  } catch {
    // ignore and use fallback fee
  }
  const entryFeeLabel = formatStakeAmount(entryFeeIrys);

  const alreadyPaid = await contract.hasBet(roundId, walletAddress, asset, side);
  if (alreadyPaid) {
    const entry = {
      wallet: walletAddress,
      roundId,
      asset,
      side,
      betKey,
      amountIrys: entryFeeIrys,
      amountWei: entryFeeWei.toString(),
      txHash: null,
      ts: Date.now() + serverOffsetMs,
      confirmed: true,
    };
    recordStakeEntry(walletAddress, betKey, entry);
    return entry;
  }

  setCardStatus(card, `Confirm the ${entryFeeLabel} IRYS entry fee…`, "loading");
  const tx = await contract.placeBet(roundId, asset, side, { value: entryFeeWei });
  setCardStatus(card, "Waiting for entry confirmation…", "loading");
  const receipt = await tx.wait();

  const stakeEntry = {
    wallet: walletAddress,
    roundId,
    asset,
    side,
    betKey,
    amountIrys: entryFeeIrys,
    amountWei: entryFeeWei.toString(),
    txHash: receipt?.hash || tx?.hash || null,
    ts: Date.now() + serverOffsetMs,
    confirmed: true,
  };

  recordStakeEntry(walletAddress, betKey, stakeEntry);
  return stakeEntry;
}

async function initiateRewardClaim({ card, roundId, asset, side, betKey, resultContainer, suggestedPayoutIrys }) {
  if (!card) return;
  try {
    setCardStatus(card, "Preparing reward claim…", "loading");
    const { signer, address } = await ensureWallet();

    setCardStatus(card, "Fetching reward signature…", "loading");

    let resolvedBetKey = betKey;
    if (!resolvedBetKey) {
      try {
        resolvedBetKey = computeBetKey(roundId, address, asset, side);
      } catch {
        resolvedBetKey = null;
      }
    }

    const numericHint = Number(suggestedPayoutIrys);
    const payoutDisplayIrys = Number.isFinite(numericHint) && numericHint > 0
      ? formatStakeAmount(numericHint)
      : formatStakeAmount(ENTRY_FEE_IRYS);

    const response = await fetch("/api/reward-signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roundId: typeof roundId === "bigint" ? roundId.toString() : roundId,
        asset,
        side,
        wallet: address,
        payoutIrys: payoutDisplayIrys,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || "Reward signature unavailable");
    }

    const data = await response.json();
    const { signature, payoutWei: payoutWeiStr, betKey: betKeyFromServer } = data;

    if (!signature || typeof signature !== "string") {
      throw new Error("Signature response malformed");
    }

    let payoutWei;
    try {
      payoutWei = BigInt(payoutWeiStr);
    } catch {
      throw new Error("Invalid payout value returned");
    }

    resolvedBetKey = resolvedBetKey || betKeyFromServer || null;

    clearCardStatus(card);
    const contract = getRewardPoolContract(signer);
    const roundArg = typeof roundId === "bigint"
      ? roundId
      : BigInt(Math.floor(Number(roundId) || 0));

    setCardStatus(card, "Submitting reward claim…", "loading");
    const tx = await contract.claimReward(roundArg, asset, side, payoutWei, signature);
    setCardStatus(card, "Waiting for claim confirmation…", "loading");
    const receipt = await tx.wait();
    const txHash = receipt?.hash || tx?.hash || null;

    const payoutDisplay = formatStakeAmount(ethers.formatEther(payoutWei));
    const targetEl = resultContainer || card.querySelector(".active-bet .bet-result");
    if (targetEl) {
      targetEl.className = "bet-result visible win";
      let html = `✅ Reward claimed! ${payoutDisplay} IRYS sent.`;
      if (txHash) {
        html += `<br><a class="link" href="${IRYS_BLOCK_EXPLORER_URL}/tx/${txHash}" target="_blank" rel="noreferrer">View claim tx ↗</a>`;
      }
      if (resolvedBetKey) {
        html += `<br><small class="claim-hint">Bet key: <code>${short(resolvedBetKey)}</code></small>`;
      }
      targetEl.innerHTML = html;
    }

    setCardStatus(card, "Reward claimed! Funds should arrive shortly.", "success");
  } catch (err) {
    console.error("Reward claim failed", err);
    setCardStatus(card, err?.message || "Reward claim failed", "error");
  }
}

// ====== Round / time sync ======
let serverOffsetMs = 0; // serverNow - clientNow (for world sync)
const roundDuration = 5 * 60 * 1000;
const BET_LOCK_MS = 0; // disable lock entirely

let roundEndTime = 0;
let currentRoundId = 0;
let resolvingRound = false;

// ====== Wallet + Irys ======
const IRYS_CHAIN_ID_DEC = 1270;
const IRYS_CHAIN_ID_HEX = "0x4f6";
const IRYS_BUNDLER_RPC_URL = "https://testnet-rpc.irys.xyz/v1";
const IRYS_EXECUTION_RPC_URL = "https://testnet-rpc.irys.xyz/v1/execution-rpc";
const IRYS_BLOCK_EXPLORER_URL = "https://testnet-explorer.irys.xyz";
const IRYS_CHAIN_PARAMS = {
  chainId: IRYS_CHAIN_ID_HEX,
  chainName: "Irys Testnet",
  nativeCurrency: { name: "Irys", symbol: "IRYS", decimals: 18 },
  rpcUrls: [IRYS_EXECUTION_RPC_URL],
  blockExplorerUrls: [IRYS_BLOCK_EXPLORER_URL],
};

let irys = null;
let walletAddress = null;
let providerRef = null;
let signerRef = null;

const walletBtn = $("#walletBtn");
const walletProfile = $("#walletProfile");
const walletAddressLabel = $("#walletAddressLabel");
const walletDisconnectBtn = $("#walletDisconnectBtn");

function updateWalletUi() {
  const connected = !!walletAddress;
  if (walletBtn) {
    walletBtn.hidden = connected;
    if (!connected) walletBtn.textContent = "Connect Wallet";
  }
  if (walletProfile) walletProfile.hidden = !connected;
  if (walletAddressLabel) {
    walletAddressLabel.textContent = connected ? short(walletAddress) : "";
    walletAddressLabel.title = connected ? walletAddress : "";
  }
  if (walletDisconnectBtn) {
    walletDisconnectBtn.hidden = !connected;
    walletDisconnectBtn.style.display = connected ? "" : "none";
  }
}

function disconnectWallet() {
  walletAddress = null;
  window.connectedWallet = null;
  localStorage.removeItem(LAST_WALLET_KEY);
  irys = null;
  providerRef = null;
  signerRef = null;
  updateWalletUi();
  invalidateHistoryCache();
  renderHistory();
  renderMyOpenBetsForCurrentRound();
  setBetButtonsEnabled(true);
}

async function ensureIrysChain() {
  const { ethereum } = window;
  if (!ethereum?.request) return;

  let currentChain = null;
  try {
    currentChain = await ethereum.request({ method: "eth_chainId" });
  } catch (err) {
    console.warn("eth_chainId failed", err);
  }

  if (currentChain === IRYS_CHAIN_ID_HEX) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: IRYS_CHAIN_ID_HEX }],
    });
    return;
  } catch (switchErr) {
    const code = switchErr?.code ?? switchErr?.data?.originalError?.code;
    const message = String(switchErr?.message || "").toLowerCase();
    const needsAdd = code === 4902 || message.includes("unrecognized chain");
    if (!needsAdd) {
      throw new Error("Switch to the Irys Testnet network in your wallet to continue.");
    }

    try {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [IRYS_CHAIN_PARAMS],
      });
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: IRYS_CHAIN_ID_HEX }],
      });
    } catch (addErr) {
      throw new Error("Please add the Irys Testnet network to your wallet to continue.");
    }
  }
}

walletDisconnectBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  disconnectWallet();
});

updateWalletUi();

// ====== DYK ======
const DYK_FACTS = [
  { text: "Did you know you can upload small files on Irys completely free? Anything under 100 KiB doesn’t even need funding.", href: "https://docs.irys.xyz/build/d/sdk/upload/upload" },
  { text: "Every time you upload on Irys, you get a digital receipt that proves your data exists forever on-chain.", href: "https://docs.irys.xyz/build/d/sdk/upload/upload" },
  { text: "Once your data is uploaded, fetch it anywhere via gateway.irys.xyz/<id>.", href: "https://docs.irys.xyz/build/d/sdk/upload/upload" },
  { text: "Irys is a programmable data layer: tag uploads, add logic, and query via RPC.", href: "https://docs.irys.xyz/build/p/programmability/connecting-to-testnet" },
  { text: "Price API tells you storage costs ahead of time.", href: "https://docs.irys.xyz/build/p/apis/price-api" },
  { text: "Use @irys/web-upload + Ethers in the browser.", href: "https://docs.irys.xyz/build/d/irys-in-the-browser" },
];
const dykText = $("#dykText"), dykLink = $("#dykLink");
const dykPrev = $("#dykPrev"), dykNext = $("#dykNext"), dykDots = $("#dykDots");
const _facts = [...DYK_FACTS];
for (let i = _facts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_facts[i], _facts[j]] = [_facts[j], _facts[i]]; }
let dykIndex = 0, dykTimer = null;
function renderDots(){ if (!dykDots) return; dykDots.innerHTML = ""; const cap = Math.min(_facts.length, 8);
  for (let i=0;i<cap;i++){ const s = document.createElement("span"); s.className = "dot" + (i === (dykIndex % cap) ? " active" : ""); dykDots.appendChild(s); } }
function renderDYK(){ if (!dykText || !dykLink || _facts.length===0) return; const item = _facts[dykIndex % _facts.length]; dykText.textContent = item.text; dykLink.href = item.href; renderDots(); }
function nextDYK(step=1){ dykIndex = (dykIndex+step+_facts.length)%_facts.length; renderDYK(); restartDYKTimer(); }
function restartDYKTimer(){ if(dykTimer) clearInterval(dykTimer); dykTimer = setInterval(()=>nextDYK(1), 9000); }
dykPrev?.addEventListener("click", ()=>nextDYK(-1)); dykNext?.addEventListener("click", ()=>nextDYK(1));
if (dykText && dykLink){ renderDYK(); restartDYKTimer(); }

// ====== Wallet/Irys helpers ======
async function ensureWallet() {
  if (!window.ethereum) { alert("No EVM wallet found. Please install MetaMask (or a compatible wallet)."); throw new Error("No wallet"); }

  const { ethereum } = window;

  const requestProvider = new ethers.BrowserProvider(ethereum);
  await requestProvider.send("eth_requestAccounts", []);

  await ensureIrysChain();

  providerRef = new ethers.BrowserProvider(ethereum);
  const network = await providerRef.getNetwork();
  if (Number(network?.chainId) !== IRYS_CHAIN_ID_DEC) {
    throw new Error("Please switch to the Irys Testnet network to continue.");
  }

  signerRef = await providerRef.getSigner();
  walletAddress = await signerRef.getAddress();
  window.connectedWallet = walletAddress;
  localStorage.setItem(LAST_WALLET_KEY, walletAddress);
  updateWalletUi();
  renderHistory();
  renderMyOpenBetsForCurrentRound();
  return { provider: providerRef, signer: signerRef, address: walletAddress };
}
async function ensureIrys() {
  if (irys) return irys;
  const { provider } = await ensureWallet();
  irys = await WebUploader(WebEthereum).withAdapter(EthersV6Adapter(provider)).withRpc(IRYS_BUNDLER_RPC_URL);
  return irys;
}

// ====== Server time sync (global) ======
async function fetchServerTime() {
  try {
    const r = await fetch('/api/time', { cache: 'no-store' });
    const t = await r.json();

    const localNow = Date.now();
    serverOffsetMs = (typeof t.now === 'number' ? t.now : localNow) - localNow;

    const end = typeof t.roundEnd === 'number'
      ? t.roundEnd
      : Math.ceil((localNow + serverOffsetMs) / roundDuration) * roundDuration;

    const start = end - roundDuration;
    currentRoundId = Math.floor(start / roundDuration);
    roundEndTime   = end;

    saveRoundState({ startTs: start, endTs: end, roundId: currentRoundId });
  } catch (e) {
    console.warn('fetchServerTime failed', e);
  }
}

// ====== Tabs ======
const tabs = $$(".tab"), panes = $$(".tabpane"), intro = $("#intro");
tabs.forEach((t)=>
  t.addEventListener("click", ()=>{
    tabs.forEach((x)=>x.classList.remove("active"));
    t.classList.add("active");
    const id = t.dataset.tab;
    panes.forEach((p)=>p.classList.toggle("active", p.id === id));
    if (intro) intro.style.display = id === "markets" ? "" : "none";
    if (id === "leaderboard") renderLeaderboard();
    if (id === "history") renderHistory();
  })
);
walletBtn?.addEventListener("click", async (event)=>{
  event.preventDefault();
  try{
    await ensureWallet();
    renderLeaderboard();
  }catch(e){
    alert(e.message || "Wallet connection failed");
  }
});

// ====== Round persistence ======
function loadRoundState(){ try { return JSON.parse(localStorage.getItem(ROUND_STATE_KEY) || "null"); } catch { return null; } }
function saveRoundState(state){ localStorage.setItem(ROUND_STATE_KEY, JSON.stringify(state)); }
function initRoundFromStorageOrNew(){
  const saved = loadRoundState();
  const now = Date.now() + serverOffsetMs;
  if (saved && now < saved.endTs) { currentRoundId = saved.roundId; roundEndTime = saved.endTs; }
  else { startNewRound(); }
}
function showRoundModal(){
  const roundModal = $("#roundModal");
  const roundCountdownEl = $("#roundCountdown");
  const startRoundBtn = $("#startRoundBtn");
  if(!roundModal || !roundCountdownEl){ startNewRound(); return; }
  let countdown = 5;
  roundCountdownEl.textContent = `0:0${countdown}`;
  roundModal.showModal();
  const interval = setInterval(()=>{
    countdown--;
    roundCountdownEl.textContent = `0:0${Math.max(countdown,0)}`;
    if(countdown<=0){ clearInterval(interval); roundModal.close(); startNewRound(); }
  },1000);
  startRoundBtn.onclick = ()=>{ clearInterval(interval); roundModal.close(); startNewRound(); };
}
function startNewRound(){
  const now = Date.now() + serverOffsetMs;
  currentRoundId = Math.floor(now / roundDuration);
  roundEndTime   = (currentRoundId + 1) * roundDuration;
  const startTs  = roundEndTime - roundDuration;
  saveRoundState({ startTs, endTs: roundEndTime, roundId: currentRoundId });
  setBetButtonsEnabled(true);
  clearAllCardStatuses();
  resolvingRound = false;
  renderMyOpenBetsForCurrentRound();
}
async function endRound(){
  if (resolvingRound) return;
  resolvingRound = true;
  try {
    const results = await resolveOpenBets();
    showBetResults(results);
  } finally {
    clearOpenBetsForRound(currentRoundId);
    showRoundModal();
  }
}
function renderCountdown(ms){ const mins = Math.floor(ms / 60000); const secs = Math.floor((ms % 60000) / 1000); return `${mins}:${secs.toString().padStart(2,"0")}`; }
function setBetButtonsEnabled(enabled){ $$(".betBtn").forEach((b)=> b.disabled = !enabled); }
function updateCountdowns(){
  const now = Date.now() + serverOffsetMs;
  const remaining = Math.max(0, roundEndTime - now);
  const elapsed   = roundDuration - remaining;
  $$(".countdown").forEach((el)=> el.textContent = renderCountdown(remaining));
  $$(".active-bet .countdown").forEach((el)=> el.textContent = renderCountdown(remaining));
  setBetButtonsEnabled(true);
  if (remaining <= 0) endRound();
}
setInterval(updateCountdowns, 1000);

// ====== Bets persistence ======
function loadAllOpenBets(){ try { return JSON.parse(localStorage.getItem(OPEN_BETS_KEY) || "{}"); } catch { return {}; } }
function saveAllOpenBets(map){ localStorage.setItem(OPEN_BETS_KEY, JSON.stringify(map)); }
function loadOpenBetsForRound(rid){ const all = loadAllOpenBets(); return Array.isArray(all[rid]) ? all[rid] : []; }
function saveOpenBetsForRound(rid, arr){ const all = loadAllOpenBets(); all[rid] = arr; saveAllOpenBets(all); }
function addOpenBet(bet){ const arr = loadOpenBetsForRound(bet.roundId); arr.push(bet); saveOpenBetsForRound(bet.roundId, arr); }
function clearOpenBetsForRound(rid){ const all = loadAllOpenBets(); delete all[rid]; saveAllOpenBets(all); clearStakeEntriesForRound(rid); }
function renderMyOpenBetsForCurrentRound(){
  if (!walletAddress) {
    $$(".active-bet").forEach((node) => node.remove());
    return;
  }
  const target = walletAddress.toLowerCase();
  const stored = loadOpenBetsForRound(currentRoundId);
  const arr = stored.filter((b) => (b.wallet || "").toLowerCase() === target);
  let mutated = false;
  arr.forEach((bet) => {
    if (!bet.stake) {
      let betKey = bet.betKey;
      if (!betKey) {
        try {
          betKey = computeBetKey(bet.roundId, bet.wallet, bet.asset, bet.side);
          bet.betKey = betKey;
        } catch {
          return;
        }
      }
      const ledgerStake = getStakeEntry(bet.wallet, betKey);
      if (ledgerStake) {
        bet.stake = ledgerStake;
        mutated = true;
      }
    }
  });
  if (mutated) saveOpenBetsForRound(currentRoundId, stored);
  $$(".active-bet").forEach((node) => node.remove());
  arr.forEach((b)=> showBetBelow(b));
  arr.forEach((b) => {
    const card = document.querySelector(`[data-asset='${b.asset}']`);
    card?.querySelectorAll(".betBtn")?.forEach((btn)=> btn.disabled = true);
  });
}

// ====== Prices (CoinGecko via Edge proxy) ======
const STATIC_IDS = { BTC: "bitcoin", ETH: "ethereum" };
const ID_CACHE_KEY = "cg_id_cache_v1";
const idCache = JSON.parse(localStorage.getItem(ID_CACHE_KEY) || "{}");
const latestPriceBySymbol = {};
async function resolveCoinId(sym){
  if (STATIC_IDS[sym]) return STATIC_IDS[sym];
  if (idCache[sym]) return idCache[sym];
  try{
    const r = await fetch("https://api.coingecko.com/api/v3/coins/list?include_platform=false");
    const list = await r.json();
    const lower = sym.toLowerCase();
    const exact = list.find(c => (c.symbol||"").toLowerCase()===lower);
    if(exact){ idCache[sym]=exact.id; localStorage.setItem(ID_CACHE_KEY, JSON.stringify(idCache)); return exact.id; }
    const byName = list.find(c => (c.name||"").toLowerCase().includes(lower));
    if(byName){ idCache[sym]=byName.id; localStorage.setItem(ID_CACHE_KEY, JSON.stringify(idCache)); return byName.id; }
  }catch{}
  return null;
}
function ensurePriceBadge(card){
  let badge = card.querySelector(".price-badge");
  if(!badge){ badge = document.createElement("span"); badge.className = "price-badge"; const h3 = card.querySelector("h3"); if(h3) h3.after(badge); }
  return badge;
}
async function fetchPrices(){
  const cards = $$(".card");
  const symToId = {};
  await Promise.all(cards.map(async (card)=>{
    const sym = card.dataset.asset;
    symToId[sym] = await resolveCoinId(sym);
  }));
  const ids = [...new Set(Object.values(symToId).filter(Boolean))];
  if(ids.length===0) return;

  try{
    const res = await fetch(`/api/prices?ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
    if(!res.ok) throw new Error("prices api not ok");
    const data = await res.json();
    if (data?.error) throw new Error(data.error);

    cards.forEach((card)=>{
      const sym = card.dataset.asset;
      const id = symToId[sym];
      if(!id || !data[id]) return;

      const price  = data[id].usd;
      const change = data[id].usd_24hr_change ?? data[id].usd_24h_change ?? 0;

      if (typeof price === "number") {
        latestPriceBySymbol[sym] = { id, price, change: Number(change) || 0 };

        const upEl = card.querySelector(".pct.up");
        const downEl = card.querySelector(".pct.down");
        if (upEl)   upEl.textContent   = `${Math.max(latestPriceBySymbol[sym].change, 0).toFixed(2)}%`;
        if (downEl) downEl.textContent = `${Math.max(-latestPriceBySymbol[sym].change, 0).toFixed(2)}%`;

        const badge = ensurePriceBadge(card);
        badge.textContent = fmtUsd(price, 2);
        badge.style.borderColor = latestPriceBySymbol[sym].change >= 0 ? "var(--up)" : "var(--down)";
      }
    });
  }catch(e){
    console.warn("price fetch failed", e);
  }
}
fetchPrices();
setInterval(fetchPrices, 32000 + Math.floor(Math.random()*4000)); // 32–36s jitter

// ====== Bet flow (NO modal, instant sign) ======
$$(".betBtn").forEach((btn)=>
  btn.addEventListener("click", async (e)=>{
    try{
      const card  = e.currentTarget.closest(".card");
      const asset = card?.dataset.asset || "UNKNOWN";
      const side  = e.currentTarget.dataset.side;

      setCardStatus(card, "Connecting wallet…", "loading");

      const { signer } = await ensureWallet();

      setCardStatus(card, `Processing ${formatStakeAmount(ENTRY_FEE_IRYS)} IRYS entry fee…`, "loading");

      // avoid duplicate bet on same asset in current round
      const existing = loadOpenBetsForRound(currentRoundId).find(b =>
        b.wallet?.toLowerCase()===walletAddress.toLowerCase() && b.asset===asset
      );
      if(existing){
        setCardStatus(card, "You already placed a bet on this asset for this round.", "error");
        return;
      }

      const priceSnap = latestPriceBySymbol[asset]?.price ?? null;

      // disable both buttons on that card
      card?.querySelectorAll(".betBtn")?.forEach((b)=> b.disabled = true);

      const uploader = await ensureIrys();

      const stake = await ensureRewardStake({
        signer,
        roundId: currentRoundId,
        asset,
        side,
        card,
      });

      setCardStatus(card, "Uploading bet…", "loading");
      const ts = Date.now() + serverOffsetMs;
      const payload = {
        type: "prediction", wallet: walletAddress, asset, side,
        reason: "", roundId: currentRoundId, ts,
        priceUsdAtBet: priceSnap, app: "IrysPredict", network: "irys-testnet",
      };
      const tags = [
        { name:"app", value:"irys-predict-prototype" },
        { name:"type", value:"prediction" },
        { name:"asset", value:asset },
        { name:"side", value:side },
        { name:"round-id", value:String(currentRoundId) },
        { name:"wallet", value:walletAddress.toLowerCase() },
        { name:"timestamp", value:String(ts) },
        { name:"content-type", value:"application/json" },
      ];
      const receipt = await uploader.upload(JSON.stringify(payload), { tags });

      // Persist locally + show
      const betKey = stake?.betKey || computeBetKey(currentRoundId, walletAddress, asset, side);
      const bet = { wallet: walletAddress, asset, side, reason: "",
        roundId: currentRoundId, ts, priceUsd: priceSnap, irysId: receipt?.id || null, stake, betKey };
      addOpenBet(bet);
      showBetBelow(bet);
      setCardStatus(card, "Bet saved on Irys. Good luck!", "success");
      setTimeout(() => clearCardStatus(card), 4000);
    }catch(err){
      alert(err?.message || "Bet upload failed");
      const card  = e.currentTarget.closest(".card");
      card?.querySelectorAll(".betBtn")?.forEach((b)=> (b.disabled = false));
      setCardStatus(card, err?.message || "Bet upload failed", "error");
    }
  })
);

function showBetBelow(bet){
  const card = document.querySelector(`[data-asset='${bet.asset}']`);
  if(!card) return;
  const existing = card.querySelector(".active-bet"); if(existing) existing.remove();
  const div = document.createElement("div"); div.className = "active-bet";
  const priceLine = typeof bet.priceUsd === "number" ? ` · Locked at <b>${fmtUsd(bet.priceUsd,4)}</b>` : "";
  const stakeAmount = bet?.stake?.amountIrys ?? (bet?.stake?.amount || null);
  const stakeTx = bet?.stake?.txHash;
  let stakeLine = "";
  if (stakeAmount) {
    stakeLine += `<br><span class="active-stake">${formatStakeAmount(stakeAmount)} IRYS entry fee</span>`;
    if (stakeTx) {
      stakeLine += `<br><a class="link" href="${IRYS_BLOCK_EXPLORER_URL}/tx/${stakeTx}" target="_blank" rel="noreferrer">Reward pool tx ↗</a>`;
    }
  }
  const linkLine  = bet.irysId ? `<br><a class="link" href="https://gateway.irys.xyz/${bet.irysId}" target="_blank" rel="noreferrer">View on Irys ↗</a>` : "";
  div.innerHTML = `
    <p>
      <b>${bet.side}</b>${priceLine}${stakeLine}<br>
      ${bet.reason ? `Reason: ${bet.reason}<br>` : ""}
      <small>Time left: <span class="countdown">${
        renderCountdown(Math.max(0, roundEndTime - (Date.now() + serverOffsetMs)))
      }</span></small>
      ${linkLine}
    </p>
    <div class="bet-result" role="status" aria-live="polite"></div>`;
  card.appendChild(div);
}

// ====== Resolve bets + push global result (placeholder)
async function postGlobalResult({ wallet, roundId, asset, win, delta, streak, best, ts, irysId, side, priceAtBet, priceAtClose, betKey, suggestedPayoutIrys }) {
  try {
    await fetch('/api/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet,
        roundId,
        asset,
        win,
        pointsDelta: delta,
        streak,
        best,
        ts,
        irysId,
        side,
        priceAtBet,
        priceAtClose,
        betKey,
        suggestedPayoutIrys,
      })
    });
  } catch {}
}
function dailyMultiplier(dayCount){ if(dayCount<=20) return 1; const extra=dayCount-20; return Math.max(0.5, 1 - extra*0.05); }
async function resolveOpenBets(){
  const OPEN = loadOpenBetsForRound(currentRoundId);
  if(!OPEN.length) return [];

  const byWallet = {};
  for(const b of OPEN){ if(!byWallet[b.wallet]) byWallet[b.wallet]=[]; byWallet[b.wallet].push(b); }

  const results = [];
  const resolvedTs = Date.now() + serverOffsetMs;

  for (const [addr, list] of Object.entries(byWallet)){
    let streak=0, best=0;
    let dayCount=0;

    for (const b of list){
      const end = latestPriceBySymbol[b.asset]?.price;
      if(typeof end!=="number" || typeof b.priceUsd!=="number"){
        results.push({ wallet: addr, asset: b.asset, pending: true, side: b.side, roundId: currentRoundId });
        continue;
      }
      const wentUp = end >= b.priceUsd;
      const win = (b.side==="UP" && wentUp) || (b.side==="DOWN" && !wentUp);

      let delta = win ? 10 : -6;
      if(win){ streak += 1; best = Math.max(best, streak); delta += Math.min(20, streak*2); }
      else { delta -= Math.floor(streak/2); streak = 0; }

      dayCount += 1;
      delta = Math.round(delta * dailyMultiplier(dayCount));

      const resultDetail = {
        wallet: addr,
        asset: b.asset,
        win,
        delta,
        side: b.side,
        roundId: currentRoundId,
        priceStart: b.priceUsd,
        priceEnd: end,
        resolvedTs,
        irysId: b.irysId || null,
        betKey: b.betKey || null,
        suggestedPayoutIrys: b.stake?.amountIrys || null,
      };
      results.push(resultDetail);

      await postGlobalResult({
        wallet: addr,
        roundId: currentRoundId,
        asset: b.asset,
        win,
        delta,
        streak,
        best,
        ts: resolvedTs,
        irysId: b.irysId || null,
        side: b.side,
        priceAtBet: b.priceUsd,
        priceAtClose: end,
        betKey: resultDetail.betKey,
        suggestedPayoutIrys: resultDetail.suggestedPayoutIrys,
      });
    }
  }

  renderLeaderboard({ force: true });
  invalidateHistoryCache();
  renderHistory();
  return results;
}

// ====== Global Leaderboard (server) ======
async function fetchGlobalLeaderboard(days = 7){
  // days = 0 means all-time; always include the days param so the server sees 0 explicitly
  const qp = `limit=100&days=${encodeURIComponent(String(days))}`;
  const res = await fetch('/api/leaderboard?' + qp, { cache: 'no-store' });
  try{
    const data = await res.json().catch(()=>null);
    console.debug('fetchGlobalLeaderboard', { qp, status: res.status, rows: Array.isArray(data?.rows) ? data.rows.length : null });
    return Array.isArray(data?.rows) ? data.rows : [];
  }catch(e){
    console.debug('fetchGlobalLeaderboard parse error', e);
    throw e;
  }
}
async function renderLeaderboard({ force = false } = {}){
  const tbody = $("#lbBody");
  if(!tbody) return;

  const days = getActiveLeaderboardDays();
  const cachedRows = getStoredLeaderboardRows(days);
  if (cachedRows) {
    tbody.innerHTML = renderLeaderboardRows(cachedRows);
  } else {
    tbody.innerHTML = `<tr><td colspan="7">Loading leaderboard…</td></tr>`;
  }

  try {
    const rows = await ensureLeaderboardData(days, { force });
    if (getActiveLeaderboardDays() === days) {
      tbody.innerHTML = renderLeaderboardRows(rows);
    }
  } catch (e) {
    if (!cachedRows) {
      tbody.innerHTML = `<tr><td colspan="7">Global leaderboard unavailable.</td></tr>`;
    }
  }
}

// wire timeframe selector (pills or legacy select)
const lbTitle = document.querySelector('#lbTitle');
const pillGroup = document.querySelector('#lbRangePills');
const lbRangeSel = document.querySelector('#lbRange'); // legacy fallback

function setActivePill(btn){
  if (!btn) return;
  const all = pillGroup ? [...pillGroup.querySelectorAll('.seg-btn')] : [];
  all.forEach(b => b.setAttribute('aria-pressed','false'));
  btn.setAttribute('aria-pressed','true');
  const v = Number(btn.dataset.days);
  if (lbTitle) lbTitle.textContent = v === 0 ? 'Leaderboard (all time)' : 'Leaderboard (this week, Friday → Thursday)';
  renderLeaderboard({ force: !hasFreshLeaderboardRows(v) });
}

  if (pillGroup) {
  pillGroup.addEventListener('click', (e)=>{
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    setActivePill(btn);
  });

  // keyboard navigation (left/right) and activation (enter/space)
  pillGroup.addEventListener('keydown', (e)=>{
    const keys = ['ArrowLeft','ArrowRight','Enter',' '];
    if (!keys.includes(e.key)) return;
    const buttons = [...pillGroup.querySelectorAll('.seg-btn')];
    const idx = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      const next = buttons[(idx + dir + buttons.length) % buttons.length];
      next.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const btn = document.activeElement.closest('.seg-btn');
      if (btn) setActivePill(btn);
    }
  });
}

// legacy select fallback
  if (lbRangeSel) {
  lbRangeSel.addEventListener('change', ()=>{
    const v = Number(lbRangeSel.value);
    if (lbTitle) lbTitle.textContent = v === 0 ? 'Leaderboard (all time)' : 'Leaderboard (this week, Friday → Thursday)';
    renderLeaderboard({ force: !hasFreshLeaderboardRows(v) });
  });
}

$('#historyRefreshBtn')?.addEventListener('click', () => {
  invalidateHistoryCache();
  renderHistory();
});

// ====== Boot ======
(async function boot() {
  try {
    await fetchServerTime();
  } finally {
    setInterval(fetchServerTime, 15_000);
  }
  initRoundFromStorageOrNew();
  renderMyOpenBetsForCurrentRound();
  renderLeaderboard();
  ensureLeaderboardData(0).catch(()=>{});

  // Points modal (both buttons) left as-is in case you still use it elsewhere
  $("#pointsInfoBtn")?.addEventListener("click", ()=> $("#pointsModal")?.showModal());
  $("#pointsInfoBtn2")?.addEventListener("click", ()=> $("#pointsModal")?.showModal());
  $("#closePointsBtn")?.addEventListener("click", ()=> $("#pointsModal")?.close());
})();
