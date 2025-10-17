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

// ====== Keys ======
const ROUND_STATE_KEY   = "round_state_v1";     // {startTs, endTs, roundId}
const OPEN_BETS_KEY     = "open_bets_v1";       // { [roundId]: Bet[] }
const LAST_WALLET_KEY   = "last_wallet_address_v1";
const THEME_KEY         = "theme_pref_v1";

// ====== Round / time sync ======
let serverOffsetMs = 0; // serverNow - clientNow (for world sync)
const roundDuration = 5 * 60 * 1000;
const BET_LOCK_MS   = 60 * 1000;

let roundEndTime = 0;
let currentRoundId = 0;

// ====== Wallet + Irys ======
let irys = null;
let walletAddress = null;
let providerRef = null;
let signerRef = null;

// ====== Theme ======
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
  if (!providerRef) providerRef = new ethers.BrowserProvider(window.ethereum);
  let accounts = []; try { accounts = await providerRef.send("eth_accounts", []); } catch {}
  if (!accounts || accounts.length === 0) await providerRef.send("eth_requestAccounts", []);
  signerRef = await providerRef.getSigner();
  walletAddress = await signerRef.getAddress();
  window.connectedWallet = walletAddress;
  localStorage.setItem(LAST_WALLET_KEY, walletAddress);
  const wb = $("#walletBtn"); if (wb) wb.textContent = short(walletAddress);
  return { provider: providerRef, signer: signerRef, address: walletAddress };
}
async function ensureIrys() {
  if (irys) return irys;
  const { provider } = await ensureWallet();
  const IRYS_TESTNET_RPC = "https://testnet-rpc.irys.xyz/v1";
  irys = await WebUploader(WebEthereum).withAdapter(EthersV6Adapter(provider)).withRpc(IRYS_TESTNET_RPC);
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
    if (intro) intro.style.display = (id === "leaderboard" ? "none" : "");
    if (id === "leaderboard") renderLeaderboard();
  })
);
$("#walletBtn")?.addEventListener("click", async ()=>{ try{ await ensureWallet(); renderLeaderboard(); renderMyOpenBetsForCurrentRound(); }catch(e){ alert(e.message || "Wallet connection failed"); } });

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
  renderMyOpenBetsForCurrentRound();
}
function endRound(){
  resolveOpenBets();
  clearOpenBetsForRound(currentRoundId);
  $$(".active-bet").forEach((row)=>row.remove());
  showRoundModal();
}
function renderCountdown(ms){ const mins = Math.floor(ms / 60000); const secs = Math.floor((ms % 60000) / 1000); return `${mins}:${secs.toString().padStart(2,"0")}`; }
function setBetButtonsEnabled(enabled){ $$(".betBtn").forEach((b)=> b.disabled = !enabled); }
function updateCountdowns(){
  const now = Date.now() + serverOffsetMs;
  const remaining = Math.max(0, roundEndTime - now);
  const elapsed   = roundDuration - remaining;
  $$(".countdown").forEach((el)=> el.textContent = renderCountdown(remaining));
  $$(".active-bet .countdown").forEach((el)=> el.textContent = renderCountdown(remaining));
  if (elapsed >= BET_LOCK_MS) setBetButtonsEnabled(false); else setBetButtonsEnabled(true);
  if (remaining <= 0) endRound();
}
setInterval(updateCountdowns, 1000);

// ====== Bets persistence ======
function loadAllOpenBets(){ try { return JSON.parse(localStorage.getItem(OPEN_BETS_KEY) || "{}"); } catch { return {}; } }
function saveAllOpenBets(map){ localStorage.setItem(OPEN_BETS_KEY, JSON.stringify(map)); }
function loadOpenBetsForRound(rid){ const all = loadAllOpenBets(); return Array.isArray(all[rid]) ? all[rid] : []; }
function saveOpenBetsForRound(rid, arr){ const all = loadAllOpenBets(); all[rid] = arr; saveAllOpenBets(all); }
function addOpenBet(bet){ const arr = loadOpenBetsForRound(bet.roundId); arr.push(bet); saveOpenBetsForRound(bet.roundId, arr); }
function clearOpenBetsForRound(rid){ const all = loadAllOpenBets(); delete all[rid]; saveAllOpenBets(all); }
function renderMyOpenBetsForCurrentRound(){
  const last = localStorage.getItem(LAST_WALLET_KEY);
  if (!last) return;
  if (!walletAddress) { walletAddress = last; window.connectedWallet = walletAddress; const wb=$("#walletBtn"); if(wb) wb.textContent = short(walletAddress); }
  const arr = loadOpenBetsForRound(currentRoundId).filter(b => b.wallet?.toLowerCase() === walletAddress.toLowerCase());
  $$(".active-bet").forEach(n => n.remove());
  arr.forEach(b=> showBetBelow(b.asset, b.side, b.reason, b.priceUsd));
  arr.forEach(b => { const card = document.querySelector(`[data-asset='${b.asset}']`); card?.querySelectorAll(".betBtn")?.forEach((btn)=> btn.disabled = true); });
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

// ====== Bet flow (Irys receipt stays) ======
const betModal = $("#betModal");
const betForm = $("#betForm");
const assetSpan = $("#assetSpan");
const sideSpan = $("#sideSpan");
const reasonInput = $("#reason");
const priceAtSelectionSpan = $("#priceAtSelection");
let currentBet = { asset:null, side:null };

$$(".betBtn").forEach((btn)=>
  btn.addEventListener("click", (e)=>{
    const now = Date.now() + serverOffsetMs;
    const remaining = Math.max(0, roundEndTime - now);
    const elapsed   = (roundDuration - remaining);
    if (elapsed >= BET_LOCK_MS){ alert("Betting is closed for this round. Please wait for the next round."); return; }
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
  const asset = currentBet.asset; const side  = currentBet.side;
  try{
    await ensureWallet();
    const existing = loadOpenBetsForRound(currentRoundId).find(b =>
      b.wallet?.toLowerCase()===walletAddress.toLowerCase() && b.asset===asset
    );
    if(existing){ alert("You already placed a bet on this asset for this round."); return; }
    const now = Date.now() + serverOffsetMs;
    const remaining = Math.max(0, roundEndTime - now);
    const elapsed   = (roundDuration - remaining);
    if (elapsed >= BET_LOCK_MS){ alert("Betting is closed for this round. Please wait for the next round."); betModal.close(); return; }
    const priceSnap = latestPriceBySymbol[asset]?.price ?? null;
    const card = document.querySelector(`[data-asset='${asset}']`);
    card?.querySelectorAll(".betBtn")?.forEach((b)=> b.disabled = true);

    // Upload Bet to Irys
    const uploader = await ensureIrys();
    const ts = Date.now() + serverOffsetMs;
    const payload = {
      type: "prediction", wallet: walletAddress, asset, side,
      reason: reasonInput.value.trim(), roundId: currentRoundId, ts,
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

    // Persist locally so we can resolve
    const bet = { wallet: walletAddress, asset, side, reason: reasonInput.value.trim(),
      roundId: currentRoundId, ts, priceUsd: priceSnap, irysId: receipt?.id || null };
    addOpenBet(bet);

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
  const existing = card.querySelector(".active-bet"); if(existing) existing.remove();
  const div = document.createElement("div"); div.className = "active-bet";
  const priceLine = typeof priceUsd === "number" ? ` · Locked at <b>${fmtUsd(priceUsd,4)}</b>` : "";
  const linkLine  = irysId ? `<br><a class="link" href="https://gateway.irys.xyz/${irysId}" target="_blank" rel="noreferrer">View on Irys ↗</a>` : "";
  div.innerHTML = `
    <p>
      <b>${side}</b>${priceLine}<br>
      ${reason ? `Reason: ${reason}<br>` : ""}
      <small>Time left: <span class="countdown">${
        renderCountdown(Math.max(0, roundEndTime - (Date.now() + serverOffsetMs)))
      }</span></small>
      ${linkLine}
    </p>`;
  card.appendChild(div);
}

// ====== Resolve bets + push global result (placeholder)
async function postGlobalResult({ wallet, roundId, asset, win, delta, streak, best, ts, irysId }) {
  try {
    await fetch('/api/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet, roundId, asset, win, pointsDelta: delta, streak, best, ts, irysId })
    });
  } catch {}
}
function dailyMultiplier(dayCount){ if(dayCount<=20) return 1; const extra=dayCount-20; return Math.max(0.5, 1 - extra*0.05); }
function resolveOpenBets(){
  const OPEN = loadOpenBetsForRound(currentRoundId);
  if(!OPEN.length) return;

  const byWallet = {};
  for(const b of OPEN){ if(!byWallet[b.wallet]) byWallet[b.wallet]=[]; byWallet[b.wallet].push(b); }

  Object.entries(byWallet).forEach(async ([addr, list])=>{
    let wins=0, losses=0;
    let streak=0, best=0;
    let dayCount=0;

    for (const b of list){
      const end = latestPriceBySymbol[b.asset]?.price;
      if(typeof end!=="number" || typeof b.priceUsd!=="number") continue;
      const wentUp = end >= b.priceUsd;
      const win = (b.side==="UP" && wentUp) || (b.side==="DOWN" && !wentUp);

      let delta = win ? 10 : -6;
      if(win){ streak += 1; best = Math.max(best, streak); delta += Math.min(20, streak*2); wins++; }
      else { delta -= Math.floor(streak/2); streak = 0; losses++; }

      dayCount += 1;
      delta = Math.round(delta * dailyMultiplier(dayCount));

      await postGlobalResult({
        wallet: addr, roundId: currentRoundId, asset: b.asset, win,
        delta, streak, best, ts: Date.now() + serverOffsetMs, irysId: b.irysId || null
      });
    }
  });

  renderLeaderboard();
}

// ====== Global Leaderboard (server) ======
async function fetchGlobalLeaderboard(){
  const res = await fetch('/api/leaderboard?limit=100', { cache: 'no-store' });
  if(!res.ok) throw new Error('global LB fetch failed');
  const data = await res.json();
  return Array.isArray(data.rows) ? data.rows : [];
}
async function renderLeaderboard(){
  const tbody = $("#lbBody");
  if(!tbody) return;
  try{
    const rows = await fetchGlobalLeaderboard();
    tbody.innerHTML = rows.length ? rows.map((r,i)=>`
      <tr>
        <td>${i+1}</td>
        <td>${short(r.addr)}</td>
        <td><b>${r.points}</b></td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        <td class="col-hide-sm">${r.streak ?? 0}</td>
        <td class="col-hide-sm">${r.best ?? 0}</td>
      </tr>`).join("") :
      `<tr><td>—</td><td>—</td><td>0</td><td>0</td><td>0</td><td class="col-hide-sm">0</td><td class="col-hide-sm">0</td></tr>`;
  }catch(e){
    $("#lbBody").innerHTML = `<tr><td colspan="7">Global leaderboard unavailable.</td></tr>`;
  }
}

// ====== Boot ======
const lastWallet = localStorage.getItem(LAST_WALLET_KEY);
if (lastWallet && !walletAddress) {
  walletAddress = lastWallet;
  window.connectedWallet = walletAddress;
  const wb = $("#walletBtn");
  if (wb) wb.textContent = short(walletAddress);
}

(async function boot() {
  try {
    await fetchServerTime();
  } finally {
    setInterval(fetchServerTime, 15_000);
  }
  initRoundFromStorageOrNew();
  renderMyOpenBetsForCurrentRound();
  renderLeaderboard();

  // Points modal (both buttons)
  $("#pointsInfoBtn")?.addEventListener("click", ()=> $("#pointsModal")?.showModal());
  $("#pointsInfoBtn2")?.addEventListener("click", ()=> $("#pointsModal")?.showModal());
  $("#closePointsBtn")?.addEventListener("click", ()=> $("#pointsModal")?.close());
})();
