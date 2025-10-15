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

// ====== Keys for persistence ======
const ROUND_STATE_KEY   = "round_state_v1";     // {startTs, endTs, roundId}
const OPEN_BETS_KEY     = "open_bets_v1";       // { [roundId]: Bet[] }
const LAST_WALLET_KEY   = "last_wallet_address_v1";
const LB_KEY            = "lb_wallet_stats_v1";  // local leaderboard
const THEME_KEY         = "theme_pref_v1";

// Optional: URL to a global leaderboard JSON snapshot
const LEADERBOARD_SNAPSHOT_URL = "";

// ====== Theme (instant toggle, no refresh) ======
const themeBtn = $("#themeBtn");
function applyTheme(mode){
  const root = document.documentElement;
  const isDark = mode === "dark";
  root.classList.toggle("dark", isDark);
  if (themeBtn) themeBtn.textContent = isDark ? "Light mode" : "Dark mode";
  localStorage.setItem(THEME_KEY, isDark ? "dark":"light");
}
applyTheme(localStorage.getItem(THEME_KEY) || "light");
themeBtn?.addEventListener("click", ()=>{
  const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
  applyTheme(next);
});

// ====== DYK ======
const DYK_FACTS = [
  { text: "Uploads under 100 KiB on Irys are free (no funding).", href: "https://docs.irys.xyz/build/d/sdk/upload/upload" },
  { text: "Each upload gets a verifiable on-chain receipt.", href: "https://docs.irys.xyz/build/d/sdk/upload/upload" },
  { text: "Fetch data anywhere via gateway.irys.xyz/<id>.", href: "https://docs.irys.xyz/build/d/sdk/upload/upload" },
  { text: "Irys is programmable: tag data and query via RPC.", href: "https://docs.irys.xyz/build/p/programmability/connecting-to-testnet" },
  { text: "Price API shows exact storage costs.", href: "https://docs.irys.xyz/build/p/apis/price-api" },
  { text: "Use @irys/web-upload + Ethers directly in the browser.", href: "https://docs.irys.xyz/build/d/irys-in-the-browser" },
];

const dykText = $("#dykText"), dykLink = $("#dykLink");
const dykPrev = $("#dykPrev"), dykNext = $("#dykNext"), dykDots = $("#dykDots");
const _facts = [...DYK_FACTS];
for (let i = _facts.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [_facts[i], _facts[j]] = [_facts[j], _facts[i]];
}
let dykIndex = 0, dykTimer = null;
function renderDots(){
  if (!dykDots) return;
  dykDots.innerHTML = "";
  const cap = Math.min(_facts.length, 8);
  for (let i=0;i<cap;i++){
    const s = document.createElement("span");
    s.className = "dot" + (i === (dykIndex % cap) ? " active" : "");
    dykDots.appendChild(s);
  }
}
function renderDYK(){
  if (!dykText || !dykLink || _facts.length===0) return;
  const item = _facts[dykIndex % _facts.length];
  dykText.textContent = item.text;
  dykLink.href = item.href;
  renderDots();
}
function nextDYK(step=1){ dykIndex = (dykIndex+step+_facts.length)%_facts.length; renderDYK(); restartDYKTimer(); }
function restartDYKTimer(){ if(dykTimer) clearInterval(dykTimer); dykTimer = setInterval(()=>nextDYK(1), 9000); }
dykPrev?.addEventListener("click", ()=>nextDYK(-1));
dykNext?.addEventListener("click", ()=>nextDYK(1));
if (dykText && dykLink){ renderDYK(); restartDYKTimer(); }

// ====== Wallet + Irys ======
let irys = null;
let walletAddress = null;
let providerRef = null;
let signerRef = null;

async function ensureWallet() {
  if (!window.ethereum) {
    alert("No EVM wallet found. Please install MetaMask (or a compatible wallet).");
    throw new Error("No wallet");
  }
  if (!providerRef) providerRef = new ethers.BrowserProvider(window.ethereum);

  let accounts = [];
  try { accounts = await providerRef.send("eth_accounts", []); } catch {}
  if (!accounts || accounts.length === 0) await providerRef.send("eth_requestAccounts", []);

  signerRef = await providerRef.getSigner();
  walletAddress = await signerRef.getAddress();
  window.connectedWallet = walletAddress;
  localStorage.setItem(LAST_WALLET_KEY, walletAddress);

  const walletBtn = $("#walletBtn");
  if (walletBtn) walletBtn.textContent = short(walletAddress);

  return { provider: providerRef, signer: signerRef, address: walletAddress };
}

async function ensureIrys() {
  if (irys) return irys;
  const { provider } = await ensureWallet();
  const IRYS_TESTNET_RPC = "https://testnet-rpc.irys.xyz/v1";
  irys = await WebUploader(WebEthereum).withAdapter(EthersV6Adapter(provider)).withRpc(IRYS_TESTNET_RPC);
  try { console.log(`Irys connected from ${irys.address}`); } catch {}
  return irys;
}

// ====== Tabs (hide intro on Leaderboard) ======
const walletBtn = $("#walletBtn");
const tabs = $$(".tab"), panes = $$(".tabpane"), intro = $("#intro");

tabs.forEach((t)=>
  t.addEventListener("click", ()=>{
    tabs.forEach((x)=>x.classList.remove("active"));
    t.classList.add("active");
    const id = t.dataset.tab;
    panes.forEach((p)=>p.classList.toggle("active", p.id === id));
    if (intro) intro.style.display = (id === "leaderboard" ? "none" : "");
    if (id === "leaderboard") renderLeaderboard();
  })
);

walletBtn?.addEventListener("click", async ()=>{
  try{
    await ensureWallet();
    renderLeaderboard();
    renderMyOpenBetsForCurrentRound();
  }catch(e){ alert(e.message || "Wallet connection failed"); }
});

// ====== Round Engine (5m) with 1m lock + persistence ======
const roundDuration = 5 * 60 * 1000;
const BET_LOCK_MS   = 60 * 1000;

let roundEndTime = 0;
let currentRoundId = 0;

function loadRoundState(){
  try { return JSON.parse(localStorage.getItem(ROUND_STATE_KEY) || "null"); } catch { return null; }
}
function saveRoundState(state){ localStorage.setItem(ROUND_STATE_KEY, JSON.stringify(state)); }

function initRoundFromStorageOrNew(){
  const saved = loadRoundState();
  const now = Date.now();
  if (saved && now < saved.endTs) {
    currentRoundId = saved.roundId;
    roundEndTime   = saved.endTs;
  } else {
    startNewRound(false);
  }
}

function showRoundModal(){
  const roundModal = $("#roundModal");
  const roundCountdownEl = $("#roundCountdown");
  const startRoundBtn = $("#startRoundBtn");
  if(!roundModal || !roundCountdownEl){ startNewRound(false); return; }
  let countdown = 5;
  roundCountdownEl.textContent = `0:0${countdown}`;
  roundModal.showModal();
  const interval = setInterval(()=>{
    countdown--;
    roundCountdownEl.textContent = `0:0${Math.max(countdown,0)}`;
    if(countdown<=0){ clearInterval(interval); roundModal.close(); startNewRound(true); }
  },1000);
  startRoundBtn.onclick = ()=>{ clearInterval(interval); roundModal.close(); startNewRound(true); };
}

function startNewRound(){
  const startTs = Date.now();
  currentRoundId = Math.floor(startTs / roundDuration);
  roundEndTime   = startTs + roundDuration;
  saveRoundState({ startTs, endTs: roundEndTime, roundId: currentRoundId });

  setBetButtonsEnabled(true);
  renderMyOpenBetsForCurrentRound();
}

function endRound(){
  resolveOpenBets();
  clearOpenBetsForRound(currentRoundId);
  $$(".active-bet").forEach((row)=>row.remove());
  showRoundModal();
}

function renderCountdown(ms){
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2,"0")}`;
}
function setBetButtonsEnabled(enabled){ $$(".betBtn").forEach((b)=> b.disabled = !enabled); }
function updateCountdowns(){
  const now = Date.now();
  const remaining = Math.max(0, roundEndTime - now);
  const elapsed   = roundDuration - remaining;

  $$(".countdown").forEach((el)=> el.textContent = renderCountdown(remaining));
  $$(".active-bet .countdown").forEach((el)=> el.textContent = renderCountdown(remaining));

  if (elapsed >= BET_LOCK_MS) setBetButtonsEnabled(false);
  else setBetButtonsEnabled(true);

  if (remaining <= 0) endRound();
}
setInterval(updateCountdowns, 1000);

// ====== Persisted Open Bets ======
function loadAllOpenBets(){ try { return JSON.parse(localStorage.getItem(OPEN_BETS_KEY) || "{}"); } catch { return {}; } }
function saveAllOpenBets(map){ localStorage.setItem(OPEN_BETS_KEY, JSON.stringify(map)); }
function loadOpenBetsForRound(rid){ const all = loadAllOpenBets(); return Array.isArray(all[rid]) ? all[rid] : []; }
function saveOpenBetsForRound(rid, arr){ const all = loadAllOpenBets(); all[rid] = arr; saveAllOpenBets(all); }
function addOpenBet(bet){ const arr = loadOpenBetsForRound(bet.roundId); arr.push(bet); saveOpenBetsForRound(bet.roundId, arr); }
function clearOpenBetsForRound(rid){ const all = loadAllOpenBets(); delete all[rid]; saveAllOpenBets(all); }

function renderMyOpenBetsForCurrentRound(){
  const last = localStorage.getItem(LAST_WALLET_KEY);
  if (!last) return;
  if (!walletAddress) {
    walletAddress = last;
    window.connectedWallet = walletAddress;
    if (walletBtn) walletBtn.textContent = short(walletAddress);
  }
  const arr = loadOpenBetsForRound(currentRoundId).filter(b => b.wallet?.toLowerCase() === walletAddress.toLowerCase());
  $$(".active-bet").forEach(n => n.remove());
  arr.forEach(b=> showBetBelow(b.asset, b.side, b.reason, b.priceUsd));
  arr.forEach(b => {
    const card = document.querySelector(`[data-asset='${b.asset}']`);
    card?.querySelectorAll(".betBtn")?.forEach((btn)=> btn.disabled = true);
  });
}

// ====== Prices (CoinGecko) ======
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
  if(!badge){
    badge = document.createElement("span");
    badge.className = "price-badge";
    const h3 = card.querySelector("h3"); if(h3) h3.after(badge);
  }
  return badge;
}
async function fetchPrices(){
  const cards = $$(".card");
  const symToId = {};
  await Promise.all(cards.map(async (card)=>{
    const sym = card.dataset.asset;
    symToId[sym] = await resolveCoinId(sym);
  }));
  const ids = Object.values(symToId).filter(Boolean);
  if(ids.length===0) return;

  const url = "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&ids=" + [...new Set(ids)].join(",");
  try{
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if(!res.ok) return; // handle rate-limit quietly
    const data = await res.json();

    cards.forEach((card)=>{
      const sym = card.dataset.asset;
      const id = symToId[sym];
      if(!id || !data[id]) return;
      const price  = data[id].usd;
      const change = data[id].usd_24h_change || 0;

      latestPriceBySymbol[sym] = { id, price, change };

      const upEl = card.querySelector(".pct.up");
      const downEl = card.querySelector(".pct.down");
      if (upEl)   upEl.textContent   = `${Math.max(change, 0).toFixed(2)}%`;
      if (downEl) downEl.textContent = `${Math.max(-change, 0).toFixed(2)}%`;

      const badge = ensurePriceBadge(card);
      badge.textContent = fmtUsd(price, 2);
      badge.style.borderColor = change >= 0 ? "var(--up)" : "var(--down)";
    });
  }catch{}
}
fetchPrices(); setInterval(fetchPrices, 30000);

// ====== Bet flow (persisted) ======
const betModal = $("#betModal");
const betForm = $("#betForm");
const assetSpan = $("#assetSpan");
const sideSpan = $("#sideSpan");
const reasonInput = $("#reason");
const priceAtSelectionSpan = $("#priceAtSelection");
let currentBet = { asset:null, side:null };

$$(".betBtn").forEach((btn)=>
  btn.addEventListener("click", (e)=>{
    const now = Date.now();
    const remaining = Math.max(0, roundEndTime - now);
    const elapsed   = (roundDuration - remaining);
    if (elapsed >= BET_LOCK_MS){
      alert("Betting is closed for this round. Please wait for the next round.");
      return;
    }
    const card = e.currentTarget.closest(".card");
    const asset = card?.dataset.asset || "UNKNOWN";
    const side  = e.currentTarget.dataset.side;
    currentBet = { asset, side };
    assetSpan.textContent = asset;
    sideSpan.textContent  = side;

    const snap = latestPriceBySymbol[asset]?.price;
    priceAtSelectionSpan.textContent = typeof snap === "number" ? fmtUsd(snap, 4) : "$--";

    reasonInput.value = "";
    betModal.showModal();
  })
);

$("#cancelBtn")?.addEventListener("click", ()=> betModal.close());

betForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const asset = currentBet.asset;
  const side  = currentBet.side;

  try{
    await ensureWallet();

    const existing = loadOpenBetsForRound(currentRoundId).find(b =>
      b.wallet?.toLowerCase()===walletAddress.toLowerCase() && b.asset===asset
    );
    if(existing){ alert("You already placed a bet on this asset for this round."); return; }

    const now = Date.now();
    const remaining = Math.max(0, roundEndTime - now);
    const elapsed   = (roundDuration - remaining);
    if (elapsed >= BET_LOCK_MS){
      alert("Betting is closed for this round. Please wait for the next round.");
      betModal.close(); return;
    }

    const priceSnap = latestPriceBySymbol[asset]?.price ?? null;

    const card = document.querySelector(`[data-asset='${asset}']`);
    card?.querySelectorAll(".betBtn")?.forEach((b)=> b.disabled = true);

    // Upload to Irys
    const uploader = await ensureIrys();
    const ts = Date.now();
    const payload = {
      type: "prediction",
      wallet: walletAddress,
      asset, side,
      reason: reasonInput.value.trim(),
      roundId: currentRoundId,
      ts,
      priceUsdAtBet: priceSnap,
      app: "IrysPredict",
      network: "irys-testnet",
    };
    const tags = [
      { name:"app", value:"irys-predict-prototype" },
      { name:"type", value:"prediction" },
      { name:"asset", value:asset },
      { name:"side", value:side },
      { name:"round-id", value:String(currentRoundId) },
      { name:"timestamp", value:String(ts) },
      { name:"content-type", value:"application/json" },
    ];
    const receipt = await uploader.upload(JSON.stringify(payload), { tags });

    // Persist open bet
    const bet = {
      wallet: walletAddress, asset, side,
      reason: reasonInput.value.trim(), roundId: currentRoundId, ts,
      priceUsd: priceSnap,
      irysId: receipt?.id || null
    };
    addOpenBet(bet);

    // Show below card with a link to Irys if available
    showBetBelow(asset, side, reasonInput.value.trim(), priceSnap, bet.irysId);

    betModal.close();
  }catch(err){
    alert(err?.message || "Bet upload failed");
    const card = document.querySelector(`[data-asset='${currentBet.asset}']`);
    card?.querySelectorAll(".betBtn")?.forEach((b)=> (b.disabled = false));
  }
});

function showBetBelow(asset, side, reason, priceUsd, irysId){
  const card = document.querySelector(`[data-asset='${asset}']`);
  if(!card) return;
  const existing = card.querySelector(".active-bet");
  if(existing) existing.remove();

  const div = document.createElement("div");
  div.className = "active-bet";
  const priceLine = typeof priceUsd === "number" ? ` · Locked at <b>${fmtUsd(priceUsd,4)}</b>` : "";
  const linkLine  = irysId ? `<br><a class="link" href="https://gateway.irys.xyz/${irysId}" target="_blank" rel="noreferrer">View on Irys ↗</a>` : "";
  div.innerHTML = `
    <p>
      <b>${side}</b>${priceLine}<br>
      ${reason ? `Reason: ${reason}<br>` : ""}
      <small>Time left: <span class="countdown">${renderCountdown(Math.max(0, roundEndTime - Date.now()))}</span></small>
      ${linkLine}
    </p>`;
  card.appendChild(div);
}

// ====== Leaderboard (local) ======
function loadAllStats(){ try{ return JSON.parse(localStorage.getItem(LB_KEY) || "{}"); }catch{ return {}; } }
function saveAllStats(map){ localStorage.setItem(LB_KEY, JSON.stringify(map)); }
function getStats(addr){
  const all = loadAllStats();
  if(!all[addr]){
    all[addr] = { points:0,wins:0,losses:0,streak:0,bestStreak:0,rounds:0,history:[],lastDay:null,dayCount:0,lastDecayAt:Date.now() };
    saveAllStats(all);
  }
  return all[addr];
}
function putStats(addr,stats){ const all = loadAllStats(); all[addr]=stats; saveAllStats(all); }
function dailyMultiplier(dayCount){ if(dayCount<=20) return 1; const extra=dayCount-20; return Math.max(0.5, 1 - extra*0.05); }
function applySmallDecay(stats){ const now=Date.now(); const elapsedMin=Math.max(0, now-(stats.lastDecayAt||now))/60000; if(elapsedMin>=5){ stats.points=Math.round(stats.points*0.995); stats.lastDecayAt=now; } }

// Compute win/loss for open bets at round end
function resolveOpenBets(){
  const arr = loadOpenBetsForRound(currentRoundId);
  if(!arr.length) return;

  const byWallet = {};
  for(const b of arr){ if(!byWallet[b.wallet]) byWallet[b.wallet]=[]; byWallet[b.wallet].push(b); }

  Object.entries(byWallet).forEach(([addr, list])=>{
    const stats = getStats(addr);
    const today = new Date().toISOString().slice(0,10);
    if(stats.lastDay !== today){ stats.lastDay=today; stats.dayCount=0; }

    list.forEach((b)=>{
      const end = latestPriceBySymbol[b.asset]?.price;
      if(typeof end!=="number" || typeof b.priceUsd!=="number") return;
      const wentUp = end >= b.priceUsd;
      const win = (b.side==="UP" && wentUp) || (b.side==="DOWN" && !wentUp);

      let delta = win ? 10 : -6;
      if(win){ stats.streak += 1; stats.bestStreak = Math.max(stats.bestStreak, stats.streak); delta += Math.min(20, stats.streak*2); }
      else { delta -= Math.floor(stats.streak/2); stats.streak = 0; }

      stats.dayCount += 1;
      delta = Math.round(delta * dailyMultiplier(stats.dayCount));

      if(win) stats.wins += 1; else stats.losses += 1;
      stats.rounds += 1; stats.points += delta;
      stats.history.push({ ts: Date.now(), asset: b.asset, side: b.side, win });
      applySmallDecay(stats);
    });

    putStats(addr, stats);
  });

  renderLeaderboard();
}

async function renderLeaderboard(){
  const tbody = $("#lbBody");
  if(!tbody) return;

  // Optional global snapshot: we’ll only render the fields we need
  if (LEADERBOARD_SNAPSHOT_URL){
    try{
      const res = await fetch(LEADERBOARD_SNAPSHOT_URL, { cache: "no-store" });
      if (res.ok){
        const rows = await res.json(); // may include extra fields; we ignore them
        if (Array.isArray(rows) && rows.length){
          rows.sort((a,b)=> (b.points-a.points) || ((b.best||0)-(a.best||0)));
          tbody.innerHTML = rows.map((r,i)=>`
            <tr>
              <td>${i+1}</td>
              <td>${short(r.addr)}</td>
              <td><b>${r.points ?? 0}</b></td>
              <td>${r.wins ?? 0}</td>
              <td>${r.losses ?? 0}</td>
              <td class="col-hide-sm">${r.streak ?? 0}</td>
              <td class="col-hide-sm">${r.best ?? 0}</td>
            </tr>`).join("");
          return;
        }
      }
    }catch{}
  }

  // Local stats fallback (no rounds/accuracy)
  const all = loadAllStats();
  const rows = Object.entries(all).map(([addr,s])=>({
    addr,
    points: s.points||0,
    wins:   s.wins||0,
    losses: s.losses||0,
    streak: s.streak||0,
    best:   s.bestStreak||0
  }));
  rows.sort((a,b)=> (b.points-a.points) || (b.best-a.best));

  tbody.innerHTML = rows.length ? rows.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${short(r.addr)}</td>
      <td><b>${r.points}</b></td>
      <td>${r.wins}</td>
      <td>${r.losses}</td>
      <td class="col-hide-sm">${r.streak}</td>
      <td class="col-hide-sm">${r.best}</td>
    </tr>`).join("") : `
    <tr>
      <td>—</td><td>—</td><td>0</td><td>0</td><td>0</td>
      <td class="col-hide-sm">0</td><td class="col-hide-sm">0</td>
    </tr>`;
}


// ====== Boot ======
const lastWallet = localStorage.getItem(LAST_WALLET_KEY);
if (lastWallet && !walletAddress) {
  walletAddress = lastWallet;
  window.connectedWallet = walletAddress;
  if (walletBtn) walletBtn.textContent = short(walletAddress);
}
initRoundFromStorageOrNew();
renderMyOpenBetsForCurrentRound();
renderLeaderboard();

// Points modal trigger
$("#pointsInfoBtn")?.addEventListener("click", ()=> $("#pointsModal").showModal());
$("#closePointsBtn")?.addEventListener("click", ()=> $("#pointsModal").close());
