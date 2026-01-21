/*************************************************************
 * YOPO AI PRO (Single-File, v6)
 * - 추가: 비밀번호(2580) 게이트, 추천 클릭→즉시 분석→추적,
 *         코인 리스트 “가격+%” 강화, 종료 기록 패널,
 *         백테스트 필터 강화형
 *
 * ✅ PATCH (2026-01-21)
 * 1) 실시간 포지션 정밀추적: 전략별(1H/4H/1D) 남은시간(카운트다운) 표시
 * 2) 추적 카드 TP/SL에 +% / -% 표시
 *************************************************************/

// ---------- AUTH ----------
const AUTH_PASSWORD = "2580";
const AUTH_KEY = "yopo_auth_ok_v1"; // localStorage key

function isAuthed(){
  try{ return localStorage.getItem(AUTH_KEY) === "1"; }catch(e){ return false; }
}
function showAuth(){
  document.getElementById("auth-overlay").style.display = "flex";
  document.getElementById("app").style.display = "none";
  setTimeout(()=>{ document.getElementById("auth-input")?.focus(); }, 50);
}
function hideAuth(){
  document.getElementById("auth-overlay").style.display = "none";
  document.getElementById("app").style.display = "flex";
}
function tryAuth(){
  const input = document.getElementById("auth-input");
  const err = document.getElementById("auth-err");
  if(!input) return;
  const v = String(input.value || "").trim();
  if(v === AUTH_PASSWORD){
    try{ localStorage.setItem(AUTH_KEY, "1"); }catch(e){}
    err.style.display = "none";
    hideAuth();
  }else{
    err.style.display = "block";
    input.value = "";
    input.focus();
  }
}

// ---------- Storage ----------
const STORAGE_KEY = "yopo_single_v6_state";

// ---------- API ----------
const BYBIT_TICKERS = "https://api.bybit.com/v5/market/tickers?category=linear";
const BYBIT_KLINE = (symbol, interval, limit) =>
  `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;

const CG_MARKETS = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h";
const CG_GLOBAL  = "https://api.coingecko.com/api/v3/global";

// ---------- Similarity / Analysis Params ----------
const SIM_WINDOW = 40;
const FUTURE_H = 8;     // ✅ “평가 기간”에 사용 (남은 카운트 계산용)
const SIM_STEP = 2;
const SIM_TOPK = 25;

// HOLD rules
const HOLD_MIN_TOPK = 12;
const HOLD_MIN_SIM_AVG = 55;
const HOLD_MIN_EDGE = 0.08;
const HOLD_MIN_TP_PCT = 0.8;

// TP/SL
const RR = 2.0;
const TF_MULT = { "60": 1.2, "240": 2.0, "D": 3.5 };
const ATR_MIN_PCT = 0.15;
const TP_MAX_PCT = 20.0;

// cooldown
const COOLDOWN_MS = { "60": 10 * 60 * 1000, "240": 30 * 60 * 1000, "D": 2 * 60 * 60 * 1000 };

// scan delay
const SCAN_DELAY_MS = 650;

// backtest
const BACKTEST_TRADES = 80;
const EXTENDED_LIMIT = 900;

// 백테스트 필터(잡신호 제거용)
const BT_MIN_PROB = 0.58;     // 58% 이상만
const BT_MIN_EDGE = 0.10;     // 엣지 10% 이상만
const BT_MIN_SIM  = 60;       // 유사도 평균 60% 이상만

// ---------- Candidate List (15) ----------
const DEFAULT_CANDIDATES = [
  { s: "BTCUSDT", n: "비트코인", cg: "bitcoin" },
  { s: "ETHUSDT", n: "이더리움", cg: "ethereum" },
  { s: "SOLUSDT", n: "솔라나", cg: "solana" },
  { s: "XRPUSDT", n: "리플", cg: "ripple" },
  { s: "ADAUSDT", n: "에이다", cg: "cardano" },
  { s: "DOGEUSDT", n: "도지코인", cg: "dogecoin" },
  { s: "AVAXUSDT", n: "아발란체", cg: "avalanche-2" },
  { s: "DOTUSDT", n: "폴카닷", cg: "polkadot" },
  { s: "LINKUSDT", n: "체인링크", cg: "chainlink" },
  { s: "POLUSDT", n: "폴리곤", cg: "polygon-ecosystem-token" },
  { s: "TRXUSDT", n: "트론", cg: "tron" },
  { s: "BCHUSDT", n: "비트코인캐시", cg: "bitcoin-cash" },
  { s: "NEARUSDT", n: "니어프로토콜", cg: "near" },
  { s: "LTCUSDT", n: "라이트코인", cg: "litecoin" },
  { s: "APTUSDT", n: "앱토스", cg: "aptos" }
];

// ---------- State ----------
let state = loadState() || {
  symbol: "BTCUSDT",
  tf: "60",
  universe: DEFAULT_CANDIDATES.map(x => ({...x})),
  activePositions: [],
  history: { total: 0, win: 0 },
  closedTrades: [],          // ✅ 종료 기록
  lastUniverseAt: 0,
  btcDom: null,
  btcDomPrev: null,
  lastApiHealth: "warn",
  lastSignalAt: {},
  lastScanAt: 0,
  lastScanResults: [],
  lastPrices: {}             // ✅ 가격 캐시 {symbol:{price,chg,ts}}
};

let tempPos = null;

/* ==========================================================
   ✅ PATCH HELPERS (전략별 남은 카운트 / 남은 시간)
   ========================================================== */
function tfToMs(tfRaw){
  // Bybit interval: "60", "240", "D"
  if(tfRaw === "60") return 60 * 60 * 1000;
  if(tfRaw === "240") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000; // "D"
}
function formatRemain(ms){
  ms = Math.max(0, ms|0);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const hh = h % 24;
  const mm = m % 60;

  if(d > 0) return `${d}일 ${hh}시간`;
  if(h > 0) return `${h}시간 ${mm}분`;
  return `${m}분`;
}
function ensureStrategyCountUI(){
  const header = document.querySelector(".tracking-header");
  if(!header) return;
  if(document.getElementById("tf-counts")) return;

  const box = document.createElement("div");
  box.id = "tf-counts";
  box.style.display = "flex";
  box.style.gap = "8px";
  box.style.alignItems = "center";
  box.style.fontWeight = "950";
  box.style.fontSize = "11px";
  box.style.color = "var(--text-sub)";
  header.appendChild(box);
}
function updateStrategyCountUI(){
  const el = document.getElementById("tf-counts");
  if(!el) return;

  let c60 = 0, c240 = 0, cD = 0;
  for(const p of (state.activePositions || [])){
    if(p.tfRaw === "60") c60++;
    else if(p.tfRaw === "240") c240++;
    else cD++;
  }

  el.innerHTML = `
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">1H ${c60}</span>
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">4H ${c240}</span>
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">1D ${cD}</span>
  `;
}
function getPosExpiryAt(pos){
  // ✅ “전략별 카운트 남은 것” = FUTURE_H개 캔들(평가기간) 기준 타이머
  //    예: 1H 전략이면 FUTURE_H(8) = 8시간이 하나의 평가 구간
  const tfMs = tfToMs(pos.tfRaw);
  const horizonMs = tfMs * FUTURE_H;
  const start = pos.createdAt || Date.now();
  return start + horizonMs;
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  // auth gate
  if(!isAuthed()){
    showAuth();
  }else{
    hideAuth();
  }
  document.getElementById("auth-input")?.addEventListener("keydown", (e)=>{
    if(e.key === "Enter") tryAuth();
  });

  initChart();
  renderUniverseList();
  renderTrackingList();
  renderClosedTrades();
  updateStatsUI();
  renderScanResults();

  // ✅ PATCH UI
  ensureStrategyCountUI();
  updateStrategyCountUI();

  await refreshUniverseAndGlobals();
  await marketTick();

  setInterval(marketTick, 2000);
  setInterval(refreshUniverseAndGlobals, 60000);

  // ✅ 남은시간(카운트다운) UI 갱신용(가벼운 텍스트만 갱신)
  setInterval(() => {
    if(!state.activePositions?.length) return;
    renderTrackingList(); // 단일파일이라 가장 안전하게 전체 렌더로 처리
  }, 15000);
});

// ---------- UI ----------
function setTF(tf, btn){
  state.tf = tf;
  document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  saveState();
  initChart();
}

function switchCoin(symbol){
  state.symbol = symbol;
  document.querySelectorAll(".coin-row").forEach(r => r.classList.remove("active"));
  const row = document.getElementById(`row-${symbol}`);
  if(row) row.classList.add("active");
  saveState();
  initChart();
}

// ---------- Chart ----------
function initChart(){
  document.getElementById("chart-wrap").innerHTML = "";
  new TradingView.widget({
    autosize:true,
    symbol:"BYBIT:" + state.symbol,
    interval:state.tf,
    timezone:"Asia/Seoul",
    theme:"light",
    style:"1",
    locale:"ko",
    toolbar_bg:"#f1f3f6",
    enable_publishing:false,
    hide_top_toolbar:false,
    container_id:"chart-wrap"
  });
}

// ---------- Universe + Dominance ----------
async function refreshUniverseAndGlobals(){
  const apiDot = document.getElementById("api-dot");
  try{
    const g = await fetchJSON(CG_GLOBAL, { timeoutMs: 6000, retry: 1 });
    const dom = g?.data?.market_cap_percentage?.btc;
    if(typeof dom === "number"){
      state.btcDomPrev = (typeof state.btcDom === "number") ? state.btcDom : null;
      state.btcDom = dom;
      document.getElementById("btc-dom-pill").innerText = `BTC DOM: ${dom.toFixed(1)}%`;
    }

    const markets = await fetchJSON(CG_MARKETS, { timeoutMs: 7000, retry: 1 });

    const enriched = DEFAULT_CANDIDATES.map(c => {
      const m = Array.isArray(markets) ? markets.find(x => x.id === c.cg) : null;
      const mc = m?.market_cap ?? 0;
      const vol = m?.total_volume ?? 0;
      const chg = m?.price_change_percentage_24h ?? 0;
      const score =
        safeLog10(mc) * 0.45 +
        safeLog10(vol) * 0.45 +
        Math.min(Math.abs(chg), 20) * 0.10;
      return { ...c, mc, vol, chg, score };
    }).sort((a,b)=> b.score - a.score);

    state.universe = enriched.slice(0, 15);
    state.lastUniverseAt = Date.now();
    state.lastApiHealth = "ok";
    saveState();

    document.getElementById("universe-ts").innerText = `업데이트: ${new Date(state.lastUniverseAt).toLocaleTimeString()}`;
    apiDot.className = "status-dot ok";
    renderUniverseList();
  }catch(e){
    console.warn("CoinGecko unavailable -> fallback to Bybit universe", e);
    apiDot.className = "status-dot warn";
    state.lastApiHealth = "warn";
    saveState();
    await fallbackUniverseFromBybit();
  }
}

async function fallbackUniverseFromBybit(){
  try{
    const json = await fetchJSON(BYBIT_TICKERS, { timeoutMs: 7000, retry: 1 });
    const tickers = json?.result?.list || [];

    const rows = tickers
      .map(t => {
        const symbol = t.symbol;
        const last = parseFloat(t.lastPrice || "0");
        const chg = parseFloat(t.price24hPcnt || "0") * 100;
        const turn =
          parseFloat(t.turnover24h || "0") ||
          parseFloat(t.turnover || "0") ||
          parseFloat(t.volume24h || "0") ||
          parseFloat(t.volume || "0") || 0;
        return { symbol, last, chg, turn };
      })
      .filter(x => x.symbol && x.symbol.endsWith("USDT") && x.last > 0);

    rows.sort((a,b)=> (b.turn - a.turn));
    const top = rows.slice(0, 60);

    const baseSet = new Set(DEFAULT_CANDIDATES.map(x=>x.s));
    const picked = [];

    for(const r of top){
      if(picked.length >= 15) break;
      if(baseSet.has(r.symbol)){
        const base = DEFAULT_CANDIDATES.find(x=>x.s===r.symbol);
        picked.push({ ...base, chg: r.chg, turn: r.turn, score: safeLog10(r.turn) });
      }
    }
    for(const r of top){
      if(picked.length >= 15) break;
      if(picked.some(x=>x.s===r.symbol)) continue;
      picked.push({ s: r.symbol, n: r.symbol.replace("USDT",""), cg: null, chg: r.chg, turn: r.turn, score: safeLog10(r.turn) });
    }

    state.universe = picked.slice(0, 15);
    state.lastUniverseAt = Date.now();
    saveState();

    document.getElementById("universe-ts").innerText = `업데이트: ${new Date(state.lastUniverseAt).toLocaleTimeString()}`;
    renderUniverseList();
  }catch(e){
    console.error("Bybit fallback universe failed:", e);
  }
}

function renderUniverseList(){
  const container = document.getElementById("market-list-container");
  container.innerHTML = "";
  state.universe.forEach(coin => {
    const div = document.createElement("div");
    div.className = `coin-row ${coin.s === state.symbol ? "active" : ""}`;
    div.id = `row-${coin.s}`;
    div.onclick = () => switchCoin(coin.s);

    div.innerHTML = `
      <div class="coin-info">
        <h4>${coin.s.replace("USDT","")}</h4>
        <span>${coin.n || "-"}</span>
      </div>
      <div class="coin-price" id="price-${coin.s}">
        <div class="p" id="p-${coin.s}">---</div>
        <div class="chg" id="c-${coin.s}">---</div>
        <div class="small-metrics" id="meta-${coin.s}"></div>
      </div>
    `;
    container.appendChild(div);

    const meta = document.getElementById(`meta-${coin.s}`);
    if(meta){
      const mcTxt = coin.mc ? `시총 ${formatMoney(coin.mc)}` : "";
      const volTxt = coin.vol ? `거래량 ${formatMoney(coin.vol)}` : "";
      const turnTxt = coin.turn ? `유동성 ${formatMoney(coin.turn)}` : "";
      const chgTxt = (typeof coin.chg === "number") ? `24h ${coin.chg.toFixed(1)}%` : "";
      meta.innerText = [mcTxt, volTxt, turnTxt, chgTxt].filter(Boolean).join(" · ");
    }

    // ✅ 캐시된 가격이 있으면 즉시 표시
    const cached = state.lastPrices?.[coin.s];
    if(cached?.price){
      updateCoinRow(coin.s, cached.price, cached.chg ?? 0, true);
    }
  });
}

// ---------- Market tick + tracking ----------
async function marketTick(){
  try{
    const json = await fetchJSON(BYBIT_TICKERS, { timeoutMs: 7000, retry: 1 });
    const tickers = json?.result?.list || [];
    const symbols = new Set(state.universe.map(x => x.s));

    for(const t of tickers){
      if(!symbols.has(t.symbol)) continue;
      const price = parseFloat(t.lastPrice || "0");
      const chg = parseFloat(t.price24hPcnt || "0") * 100;
      if(price > 0){
        updateCoinRow(t.symbol, price, chg);
        // ✅ 캐시 저장
        state.lastPrices[t.symbol] = { price, chg, ts: Date.now() };
      }
      if(price > 0) trackPositions(t.symbol, price);
    }
    saveState();

    if(!symbols.has(state.symbol) && state.universe[0]){
      switchCoin(state.universe[0].s);
    }
  }catch(e){
    console.error("Market tick error:", e);
    document.getElementById("api-dot").className = "status-dot bad";
  }
}

function updateCoinRow(symbol, price, changePct, silent=false){
  const pEl = document.getElementById(`p-${symbol}`);
  const cEl = document.getElementById(`c-${symbol}`);
  if(!pEl || !cEl) return;

  const color = changePct >= 0 ? "var(--success)" : "var(--danger)";
  const sign = changePct >= 0 ? "+" : "";

  pEl.style.color = "var(--primary)";
  pEl.textContent = `$${price.toLocaleString(undefined,{maximumFractionDigits:6})}`;

  cEl.style.color = color;
  cEl.textContent = `${sign}${changePct.toFixed(2)}%`;

  if(!silent){
    // UI 갱신은 위만으로 충분
  }
}

// ---------- Core Analysis ----------
async function executeAnalysis(){
  const btn = document.getElementById("predict-btn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 분석 중...';

  try{
    const dupKey = `${state.symbol}|${state.tf}`;
    if(hasActivePosition(state.symbol, state.tf)){
      alert("이미 같은 코인/같은 기간의 추적 포지션이 있습니다. (중복 방지)");
      return;
    }
    if(isInCooldown(dupKey)){
      alert("너무 자주 신호를 내면 승률이 내려갈 수 있어요. 지금은 쿨다운입니다.");
      return;
    }

    const candles = await fetchCandles(state.symbol, state.tf, EXTENDED_LIMIT);
    if(candles.length < (SIM_WINDOW + FUTURE_H + 80)) throw new Error("캔들 데이터가 부족합니다.");

    const pos = buildSignalFromCandles(state.symbol, state.tf, candles);
    state.lastSignalAt[dupKey] = Date.now();
    saveState();

    showResultModal(pos);
  }catch(e){
    console.error(e);
    alert("분석 중 오류가 발생했습니다. (API 지연/제한 가능)");
  }finally{
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-microchip"></i> AI 분석 및 예측 실행';
  }
}

// ✅ 추천 클릭 시: 코인/TF 적용 + 즉시 분석 실행(모달)
async function quickAnalyzeAndShow(symbol, tfRaw){
  try{
    // TF 적용
    const btns = document.querySelectorAll(".tf-btn");
    btns.forEach(b => b.classList.remove("active"));
    if(tfRaw === "60") btns[0].classList.add("active");
    else if(tfRaw === "240") btns[1].classList.add("active");
    else btns[2].classList.add("active");
    state.tf = tfRaw;

    // 코인 적용
    switchCoin(symbol);
    saveState();
    initChart();

    // 분석 실행(중복/쿨다운은 추천은 예외적으로 “사용자 선택”이니 경고만)
    if(hasActivePosition(symbol, tfRaw)){
      alert("이미 같은 코인/같은 기간의 추적 포지션이 있습니다. (중복 방지)");
      return;
    }

    const candles = await fetchCandles(symbol, tfRaw, EXTENDED_LIMIT);
    if(candles.length < (SIM_WINDOW + FUTURE_H + 80)) throw new Error("캔들 데이터가 부족합니다.");

    const pos = buildSignalFromCandles(symbol, tfRaw, candles);
    showResultModal(pos);
  }catch(e){
    console.error(e);
    alert("추천 분석 중 오류가 발생했습니다.");
  }
}

function buildSignalFromCandles(symbol, tf, candles){
  const closes = candles.map(x => x.c);
  const highs  = candles.map(x => x.h);
  const lows   = candles.map(x => x.l);
  const vols   = candles.map(x => x.v);

  const entry = closes[closes.length - 1];

  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  const atrRaw = calcATR(highs, lows, closes, 14);
  const volTrend = calcVolumeTrend(vols, 20);
  const ema20 = emaLast(closes, 20);
  const ema50 = emaLast(closes, 50);
  const trend = (ema20 >= ema50) ? 1 : -1;

  const sim = calcSimilarityStats(closes, SIM_WINDOW, FUTURE_H, SIM_STEP, SIM_TOPK);

  const dom = (typeof state.btcDom === "number") ? state.btcDom : null;
  const domPrev = (typeof state.btcDomPrev === "number") ? state.btcDomPrev : null;
  const domUp = (dom !== null && domPrev !== null) ? (dom - domPrev) : 0;

  const isAlt = (symbol !== "BTCUSDT");
  let domDamp = 1.0;
  let domHoldBoost = 0.0;
  if(dom !== null){
    if(dom > 50) domDamp *= 0.88;
    if(domUp > 0.15) { domDamp *= 0.85; domHoldBoost += 1; }
    if(isAlt && dom > 53) { domDamp *= 0.82; domHoldBoost += 1; }
  }

  let longP = sim.longProb;
  let shortP = sim.shortProb;

  const rsiBias = clamp((50 - rsi) / 50, -1, 1);
  const macdBias = clamp(macd.hist * 6, -1, 1);
  const volBias = clamp(volTrend, -1, 1);
  const trendBias = clamp(trend * 0.8, -1, 1);

  longP  += (0.12 * rsiBias) + (0.10 * macdBias) + (0.06 * volBias) + (0.08 * trendBias);
  shortP += (-0.12 * rsiBias) + (-0.10 * macdBias) + (-0.06 * volBias) + (-0.08 * trendBias);

  longP  = 0.5 + (longP - 0.5) * domDamp;
  shortP = 0.5 + (shortP - 0.5) * domDamp;

  const sum = Math.max(longP + shortP, 1e-9);
  longP /= sum; shortP /= sum;

  const type = (longP >= shortP) ? "LONG" : "SHORT";
  const winProb = Math.max(longP, shortP);
  const edge = Math.abs(longP - shortP);

  const tfMult = TF_MULT[tf] || 1.2;
  const atrMin = entry * (ATR_MIN_PCT / 100);
  const atrUsed = Math.max(atrRaw, atrMin);

  let tpDist = atrUsed * tfMult;
  let slDist = tpDist / RR;

  let tp = (type === "LONG") ? (entry + tpDist) : (entry - tpDist);
  let sl = (type === "LONG") ? (entry - slDist) : (entry + slDist);

  let tpPct = Math.abs((tp - entry) / entry) * 100;
  let slPct = Math.abs((sl - entry) / entry) * 100;

  if(tpPct > TP_MAX_PCT){
    tpPct = TP_MAX_PCT;
    const newTpDist = entry * (tpPct/100);
    tp = (type === "LONG") ? (entry + newTpDist) : (entry - newTpDist);
    sl = (type === "LONG") ? (entry - (newTpDist/RR)) : (entry + (newTpDist/RR));
    slPct = Math.abs((sl - entry) / entry) * 100;
  }

  const holdReasons = [];
  if(sim.count < HOLD_MIN_TOPK) holdReasons.push(`유사패턴 표본 부족(${sim.count}개)`);
  if(sim.avgSim < HOLD_MIN_SIM_AVG) holdReasons.push(`유사도 평균 낮음(${sim.avgSim.toFixed(1)}%)`);
  if(edge < HOLD_MIN_EDGE) holdReasons.push(`롱/숏 차이 작음(엣지 ${(edge*100).toFixed(1)}%)`);
  if(tpPct < HOLD_MIN_TP_PCT) holdReasons.push(`목표수익 너무 작음(+${tpPct.toFixed(2)}%)`);

  if(domHoldBoost >= 2 && isAlt) holdReasons.push(`BTC 도미넌스 환경이 알트에 불리(보수적)`);
  if(volTrend < -0.25) holdReasons.push(`거래량 흐름 약함(신뢰↓)`);

  const isHold = holdReasons.length > 0;

  return {
    id: Date.now(),
    symbol,
    tf: tf === "60" ? "1H" : tf === "240" ? "4H" : "1D",
    tfRaw: tf,
    type: isHold ? "HOLD" : type,
    entry,
    tp: isHold ? null : tp,
    sl: isHold ? null : sl,
    tpPct: isHold ? null : tpPct,
    slPct: isHold ? null : slPct,
    createdAt: Date.now(),
    explain: {
      winProb,
      longP, shortP,
      edge,
      simAvg: sim.avgSim,
      simCount: sim.count,
      simLongPct: sim.longProb * 100,
      simShortPct: sim.shortProb * 100,
      rsi,
      macdHist: macd.hist,
      atr: atrUsed,
      volTrend,
      ema20, ema50,
      trend,
      btcDom: dom,
      btcDomUp: domUp,
      holdReasons
    }
  };
}

// ---------- Modal ----------
function showResultModal(pos){
  tempPos = pos;

  const modal = document.getElementById("result-modal");
  const icon = document.getElementById("modal-icon");
  const title = document.getElementById("modal-title");
  const subtitle = document.getElementById("modal-subtitle");
  const grid = document.getElementById("modal-grid");
  const content = document.getElementById("modal-content");
  const confirmBtn = document.getElementById("modal-confirm");

  const isLong = pos.type === "LONG";
  const isHold = pos.type === "HOLD";

  icon.textContent = isHold ? "⏸️" : (isLong ? "📈" : "📉");
  title.textContent = isHold ? "HOLD (보류)" : `${pos.type} SIGNAL`;
  title.style.color = isHold ? "var(--text-sub)" : (isLong ? "var(--success)" : "var(--danger)");
  subtitle.textContent = `${pos.symbol} | ${pos.tf}`;

  const ex = pos.explain;

  if(isHold){
    grid.innerHTML = `
      <div class="mini-box"><small>판정</small><div>이번에는 예측 안 함</div></div>
      <div class="mini-box"><small>이유</small><div>확신 부족</div></div>
      <div class="mini-box"><small>유사도 평균</small><div>${ex.simAvg.toFixed(1)}%</div></div>
      <div class="mini-box"><small>표본 수</small><div>${ex.simCount}개</div></div>
    `;
    const reasons = ex.holdReasons.map(r => `- ${r}`).join("<br/>");
    content.innerHTML = `
      <b>이번에는 “보류”가 더 안전해요.</b><br/>
      ${reasons}<br/><br/>
      <b>정리:</b> 애매할 때 억지로 진입하면 장기 승률이 내려가서, 이번은 패스합니다.
    `;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "보류는 등록하지 않음";
  }else{
    grid.innerHTML = `
      <div class="mini-box"><small>진입가</small><div>$${pos.entry.toLocaleString(undefined,{maximumFractionDigits:6})}</div></div>
      <div class="mini-box"><small>성공확률(추정)</small><div>${(ex.winProb*100).toFixed(1)}%</div></div>
      <div class="mini-box"><small>목표가(TP)</small><div style="color:var(--success)">$${pos.tp.toLocaleString(undefined,{maximumFractionDigits:6})} (+${pos.tpPct.toFixed(2)}%)</div></div>
      <div class="mini-box"><small>손절가(SL)</small><div style="color:var(--danger)">$${pos.sl.toLocaleString(undefined,{maximumFractionDigits:6})} (-${pos.slPct.toFixed(2)}%)</div></div>
    `;

    const domMsg = (typeof ex.btcDom === "number")
      ? `BTC 도미넌스 ${ex.btcDom.toFixed(1)}% (최근 ${ex.btcDomUp>=0?"+":""}${ex.btcDomUp.toFixed(2)}p)`
      : `BTC 도미넌스: 데이터 없음`;

    content.innerHTML = `
      <b>근거 요약:</b><br/>
      - 유사패턴 ${ex.simCount}개 · 평균 유사도 ${ex.simAvg.toFixed(1)}%<br/>
      - RSI ${ex.rsi.toFixed(1)} · MACD ${ex.macdHist.toFixed(4)}<br/>
      - 추세(EMA20/EMA50) ${ex.ema20 >= ex.ema50 ? "상승 우위" : "하락 우위"}<br/>
      - 거래량 흐름 ${ex.volTrend >= 0 ? "증가" : "감소"} · 엣지 ${(ex.edge*100).toFixed(1)}%<br/>
      - ${domMsg}<br/><br/>
      <b>정리:</b> 통계+지표가 같은 방향이라 ${pos.type}로 제안합니다.
    `;

    confirmBtn.disabled = false;
    confirmBtn.textContent = "추적 시스템에 등록";
  }

  modal.style.display = "flex";
}

function closeModal(){
  document.getElementById("result-modal").style.display = "none";
  tempPos = null;
}

function confirmTrack(){
  if(!tempPos) return;
  if(tempPos.type === "HOLD") return;

  if(hasActivePosition(tempPos.symbol, tempPos.tfRaw)){
    alert("이미 같은 코인/같은 기간의 추적 포지션이 있습니다.");
    return;
  }

  // ✅ PATCH: createdAt/expiryAt (전략별 남은 카운트 표시용)
  const createdAt = Date.now();
  const expiryAt = createdAt + (tfToMs(tempPos.tfRaw) * FUTURE_H);

  state.activePositions.unshift({
    ...tempPos,
    status: "ACTIVE",
    lastPrice: tempPos.entry,
    pnl: 0,
    createdAt,
    expiryAt
  });
  saveState();
  closeModal();
  renderTrackingList();
  updateStatsUI();
}

// ---------- Tracking ----------
function trackPositions(symbol, currentPrice){
  let changed = false;

  for(let i = state.activePositions.length - 1; i >= 0; i--){
    const pos = state.activePositions[i];
    if(pos.symbol !== symbol) continue;

    pos.lastPrice = currentPrice;

    let pnl = 0;
    if(pos.type === "LONG"){
      pnl = ((currentPrice - pos.entry) / pos.entry) * 100;
    }else{
      pnl = ((pos.entry - currentPrice) / pos.entry) * 100;
    }
    pos.pnl = pnl;

    let close = false;
    let win = false;
    let exitPrice = null;
    let exitReason = "";

    if(pos.type === "LONG"){
      if(currentPrice >= pos.tp){ close = true; win = true; exitPrice = pos.tp; exitReason="TP"; }
      else if(currentPrice <= pos.sl){ close = true; win = false; exitPrice = pos.sl; exitReason="SL"; }
    }else{
      if(currentPrice <= pos.tp){ close = true; win = true; exitPrice = pos.tp; exitReason="TP"; }
      else if(currentPrice >= pos.sl){ close = true; win = false; exitPrice = pos.sl; exitReason="SL"; }
    }

    if(close){
      state.history.total++;
      if(win) state.history.win++;

      // ✅ 종료 기록 저장
      const record = {
        id: Date.now(),
        symbol: pos.symbol,
        tf: pos.tf,
        tfRaw: pos.tfRaw,
        type: pos.type,
        entry: pos.entry,
        exit: exitPrice ?? currentPrice,
        pnlPct: pnl,
        win,
        reason: exitReason,
        closedAt: Date.now()
      };
      state.closedTrades.unshift(record);
      state.closedTrades = state.closedTrades.slice(0, 30);

      state.activePositions.splice(i, 1);
      saveState();
      changed = true;

      alert(`[${pos.symbol} ${pos.tf}] 종료: ${win ? "성공" : "실패"} (${exitReason}) / 수익률 ${pnl.toFixed(2)}%`);
    }else{
      changed = true;
    }
  }

  if(changed){
    saveState();
    renderTrackingList();
    renderClosedTrades();
    updateStatsUI();
  }
}

function renderTrackingList(){
  const container = document.getElementById("tracking-container");

  // ✅ PATCH: header TF counts update
  ensureStrategyCountUI();
  updateStrategyCountUI();

  if(!state.activePositions.length){
    container.innerHTML = `
      <div style="text-align:center; padding:50px; color:var(--text-sub); font-weight:950;">
        <i class="fa-solid fa-radar" style="font-size:44px; opacity:.18;"></i><br><br>
        현재 추적 중인 포지션이 없습니다.<br/>
        왼쪽에서 코인을 고르고 “AI 분석”을 눌러보세요.
      </div>
    `;
    return;
  }

  container.innerHTML = state.activePositions.map(pos => {
    const isUp = pos.pnl >= 0;
    const color = isUp ? "var(--success)" : "var(--danger)";

    const denom = Math.max(Math.abs(pos.tp - pos.entry), 1e-9);
    const numer = (pos.type === "LONG")
      ? (pos.lastPrice - pos.entry)
      : (pos.entry - pos.lastPrice);

    let progress = (numer / denom) * 100;
    progress = clamp(progress, 0, 100);

    const ex = pos.explain || {};

    // ✅ PATCH: TP/SL percent (표시)
    const tpPct = Number.isFinite(pos.tpPct) ? pos.tpPct : null;
    const slPct = Number.isFinite(pos.slPct) ? pos.slPct : null;

    // ✅ PATCH: remaining countdown
    const expiryAt = pos.expiryAt || getPosExpiryAt(pos);
    const remainMs = expiryAt - Date.now();
    const remainText = formatRemain(remainMs);

    const explainLine =
      `남은시간 ${remainText} · 유사패턴 ${ex.simCount ?? "-"}개 · 유사도 ${(ex.simAvg ?? 0).toFixed ? ex.simAvg.toFixed(1) : "-"}% · RSI ${(ex.rsi ?? 0).toFixed ? ex.rsi.toFixed(1) : "-"} · 엣지 ${((ex.edge ?? 0)*100).toFixed ? ((ex.edge ?? 0)*100).toFixed(1) : "-"}%`;

    const tpLine = tpPct !== null
      ? `$${pos.tp.toLocaleString(undefined,{maximumFractionDigits:6})} (+${tpPct.toFixed(2)}%)`
      : `$${pos.tp.toLocaleString(undefined,{maximumFractionDigits:6})}`;

    const slLine = slPct !== null
      ? `$${pos.sl.toLocaleString(undefined,{maximumFractionDigits:6})} (-${slPct.toFixed(2)}%)`
      : `$${pos.sl.toLocaleString(undefined,{maximumFractionDigits:6})}`;

    return `
      <div class="position-card">
        <div class="card-header">
          <div class="card-symbol">
            ${pos.symbol} <span style="font-size:12px; color:var(--text-sub); font-weight:950;">${pos.tf}</span>
          </div>
          <div class="card-type ${pos.type === "LONG" ? "type-LONG" : "type-SHORT"}">${pos.type}</div>
        </div>

        <div class="card-grid">
          <div class="price-info">
            <span class="price-label">현재가</span>
            <span class="price-val">$${(pos.lastPrice||pos.entry).toLocaleString(undefined,{maximumFractionDigits:6})}</span>
          </div>

          <div>
            <div class="progress-text">
              <span style="color:${color}">수익률 ${pos.pnl.toFixed(2)}%</span>
              <span>목표까지 ${progress.toFixed(1)}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${progress}%; background:${color};"></div>
            </div>
          </div>

          <div class="price-info">
            <span class="price-label">TP / SL</span>
            <span class="price-val" style="color:var(--success);">${tpLine}</span>
            <div style="height:4px;"></div>
            <span class="price-val" style="color:var(--danger);">${slLine}</span>
          </div>
        </div>

        <div class="card-foot">${explainLine}</div>
      </div>
    `;
  }).join("");
}

function renderClosedTrades(){
  const container = document.getElementById("history-container");
  const countEl = document.getElementById("history-count");
  const list = state.closedTrades || [];
  countEl.textContent = String(list.length);

  if(!list.length){
    container.innerHTML = `
      <div style="font-size:11px; color:var(--text-sub); font-weight:900; padding:4px 2px;">
        아직 종료된 기록이 없습니다.
      </div>
    `;
    return;
  }

  container.innerHTML = list.slice(0, 8).map(x => {
    const badge = x.win ? `<span class="badge-win">성공</span>` : `<span class="badge-lose">실패</span>`;
    const pnlColor = x.pnlPct >= 0 ? "var(--success)" : "var(--danger)";
    return `
      <div class="history-item">
        <div class="left">
          ${badge}
          <span>${x.symbol.replace("USDT","")} ${x.tf}</span>
          <span style="color:var(--text-sub); font-weight:950;">(${x.reason})</span>
        </div>
        <div style="text-align:right;">
          <div style="color:${pnlColor}; font-weight:950;">${x.pnlPct.toFixed(2)}%</div>
          <div style="color:var(--text-sub); font-size:10px; font-weight:900;">
            ${new Date(x.closedAt).toLocaleTimeString()}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function updateStatsUI(){
  document.getElementById("total-stat").innerText = state.history.total;
  const rate = state.history.total > 0 ? (state.history.win / state.history.total) * 100 : 0;
  document.getElementById("win-stat").innerText = `${rate.toFixed(1)}%`;
  document.getElementById("active-stat").innerText = state.activePositions.length;

  // ✅ PATCH
  ensureStrategyCountUI();
  updateStrategyCountUI();
}

// ---------- Auto Scan ----------
async function autoScanUniverse(){
  const scanBtn = document.getElementById("scan-btn");
  const status = document.getElementById("scan-status");
  scanBtn.disabled = true;
  status.textContent = "스캔 중...";

  try{
    const results = [];
    for(let i=0;i<state.universe.length;i++){
      const coin = state.universe[i];
      status.textContent = `스캔 중... (${i+1}/${state.universe.length})`;

      try{
        const candles = await fetchCandles(coin.s, state.tf, 380);
        if(candles.length < (SIM_WINDOW + FUTURE_H + 80)) continue;
        const pos = buildSignalFromCandles(coin.s, state.tf, candles);
        if(pos.type === "HOLD") continue;

        results.push({
          symbol: pos.symbol,
          tf: pos.tf,
          tfRaw: pos.tfRaw,
          type: pos.type,
          winProb: pos.explain.winProb,
          edge: pos.explain.edge
        });
      }catch(e){}

      await sleep(SCAN_DELAY_MS);
    }

    results.sort((a,b)=> (b.winProb - a.winProb) || (b.edge - a.edge));
    state.lastScanResults = results.slice(0, 6);
    state.lastScanAt = Date.now();
    saveState();

    renderScanResults();
    status.textContent = state.lastScanResults.length ? "완료" : "추천 없음";
  }finally{
    scanBtn.disabled = false;
    setTimeout(()=>{ document.getElementById("scan-status").textContent = "대기"; }, 1500);
  }
}

function renderScanResults(){
  const container = document.getElementById("rec-container");
  const list = state.lastScanResults || [];
  if(!list.length){
    container.innerHTML = `
      <div style="font-size:11px; color:var(--text-sub); font-weight:900; padding:6px 2px;">
        아직 추천 결과가 없습니다. “자동 스캔”을 눌러주세요.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(item => {
    const pillClass = item.type === "LONG" ? "long" : "short";
    const prob = (item.winProb*100).toFixed(1);
    const edge = (item.edge*100).toFixed(1);

    return `
      <div class="rec-item" onclick="quickAnalyzeAndShow('${item.symbol}','${item.tfRaw}')">
        <div class="rec-left">
          ${item.symbol.replace("USDT","")}
          <span class="pill ${pillClass}">${item.type}</span>
        </div>
        <div class="rec-right">
          성공확률 ${prob}%<br/>
          엣지 ${edge}% · ${item.tf}
        </div>
      </div>
    `;
  }).join("");
}

// ---------- Backtest (필터 강화형) ----------
async function runBacktest(){
  const btBtn = document.getElementById("bt-btn");
  btBtn.disabled = true;
  btBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 백테스트...';

  const box = document.getElementById("bt-box");
  box.classList.remove("show");

  try{
    const candles = await fetchCandles(state.symbol, state.tf, EXTENDED_LIMIT);
    if(candles.length < (SIM_WINDOW + FUTURE_H + 120)) throw new Error("캔들 데이터가 부족합니다.");

    let wins=0, total=0;
    let pnlSum=0;

    const end = candles.length - (FUTURE_H + 20);
    const start = Math.max(SIM_WINDOW + 80, end - (BACKTEST_TRADES * 7));

    for(let idx = start; idx < end; idx += 7){
      const sliceCandles = candles.slice(0, idx+1);
      if(sliceCandles.length < (SIM_WINDOW + FUTURE_H + 80)) continue;

      const pos = buildSignalFromCandles(state.symbol, state.tf, sliceCandles);
      if(pos.type === "HOLD") continue;

      // ✅ 필터 강화(백테스트만)
      const ex = pos.explain || {};
      if((ex.winProb ?? 0) < BT_MIN_PROB) continue;
      if((ex.edge ?? 0) < BT_MIN_EDGE) continue;
      if((ex.simAvg ?? 0) < BT_MIN_SIM) continue;

      const future = candles.slice(idx+1, Math.min(idx+1+140, candles.length));
      const outcome = simulateOutcome(pos, future);
      if(!outcome.resolved) continue;

      total++;
      if(outcome.win) wins++;
      pnlSum += outcome.pnlPct;

      if(total >= BACKTEST_TRADES) break;
    }

    const winRate = total ? (wins/total)*100 : 0;
    const avgPnl = total ? (pnlSum/total) : 0;

    document.getElementById("bt-n").textContent = `${total}회`;
    document.getElementById("bt-win").textContent = `${winRate.toFixed(1)}%`;
    document.getElementById("bt-avg").textContent = `${avgPnl.toFixed(2)}%`;

    const tfName = state.tf === "60" ? "1H" : state.tf === "240" ? "4H" : "1D";
    document.getElementById("bt-range").textContent =
      `${state.symbol} · ${tfName} · 최근 ${EXTENDED_LIMIT}캔들 (필터: 확률≥${Math.round(BT_MIN_PROB*100)}%, 엣지≥${Math.round(BT_MIN_EDGE*100)}%, 유사도≥${BT_MIN_SIM}%)`;

    box.classList.add("show");
  }catch(e){
    console.error(e);
    alert("백테스트 중 오류가 발생했습니다.");
  }finally{
    btBtn.disabled = false;
    btBtn.innerHTML = '<i class="fa-solid fa-flask"></i> 백테스트';
  }
}

function simulateOutcome(pos, futureCandles){
  for(const c of futureCandles){
    const hi = c.h, lo = c.l;
    if(pos.type === "LONG"){
      if(hi >= pos.tp){
        const pnl = ((pos.tp - pos.entry)/pos.entry)*100;
        return { resolved:true, win:true, pnlPct:pnl };
      }
      if(lo <= pos.sl){
        const pnl = ((pos.sl - pos.entry)/pos.entry)*100;
        return { resolved:true, win:false, pnlPct:pnl };
      }
    }else{
      if(lo <= pos.tp){
        const pnl = ((pos.entry - pos.tp)/pos.entry)*100;
        return { resolved:true, win:true, pnlPct:pnl };
      }
      if(hi >= pos.sl){
        const pnl = ((pos.entry - pos.sl)/pos.entry)*100;
        return { resolved:true, win:false, pnlPct:pnl };
      }
    }
  }
  return { resolved:false, win:false, pnlPct:0 };
}

// ---------- Candle Fetch ----------
async function fetchCandles(symbol, tf, limit){
  const res = await fetchJSON(BYBIT_KLINE(symbol, tf, limit), { timeoutMs: 9000, retry: 1 });
  const kline = res?.result?.list || [];
  const candles = kline.map(row => ({
    t: Number(row[0]),
    o: parseFloat(row[1]),
    h: parseFloat(row[2]),
    l: parseFloat(row[3]),
    c: parseFloat(row[4]),
    v: parseFloat(row[5])
  })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.c) && Number.isFinite(x.h) && Number.isFinite(x.l));
  candles.sort((a,b)=> a.t - b.t);
  return candles;
}

// ---------- Similarity ----------
function calcSimilarityStats(closes, winLen, futureH, step, topK){
  const n = closes.length;
  const curStart = n - winLen;
  const curSeg = closes.slice(curStart, n);
  const curRet = returns(curSeg);

  const sims = [];
  const lastStart = n - winLen - futureH - 2;
  for(let s=0; s<=lastStart; s+=step){
    const seg = closes.slice(s, s + winLen);
    const ret = returns(seg);
    const sim = zncc(curRet, ret);
    if(!Number.isFinite(sim)) continue;

    const entry = closes[s + winLen - 1];
    const future = closes[s + winLen - 1 + futureH];
    const r = (future - entry) / Math.max(entry, 1e-12);
    sims.push({ sim, r });
  }

  sims.sort((a,b)=> b.sim - a.sim);
  const top = sims.slice(0, Math.min(topK, sims.length));

  const count = top.length;
  if(count === 0){
    return { longProb: 0.5, shortProb: 0.5, avgSim: 0, count: 0 };
  }

  const up = top.filter(x => x.r >= 0).length;
  const down = count - up;

  const longProb = (up + 1) / (count + 2);
  const shortProb = (down + 1) / (count + 2);

  const avgZ = top.reduce((a,b)=>a+b.sim,0) / count;
  const avgSim = clamp((avgZ + 1) * 50, 0, 100);

  return { longProb, shortProb, avgSim, count };
}

function returns(seg){
  const out = [];
  for(let i=1;i<seg.length;i++){
    out.push((seg[i] - seg[i-1]) / Math.max(seg[i-1], 1e-12));
  }
  return out;
}

function zncc(a,b){
  const m = Math.min(a.length, b.length);
  if(m < 5) return 0;

  const a0 = a.slice(0,m);
  const b0 = b.slice(0,m);

  const ma = mean(a0), mb = mean(b0);
  let sa = 0, sb = 0;
  for(let i=0;i<m;i++){
    sa += (a0[i]-ma)*(a0[i]-ma);
    sb += (b0[i]-mb)*(b0[i]-mb);
  }
  sa = Math.sqrt(sa / m);
  sb = Math.sqrt(sb / m);
  if(sa === 0 || sb === 0) return 0;

  let dot = 0;
  for(let i=0;i<m;i++){
    dot += ((a0[i]-ma)/sa) * ((b0[i]-mb)/sb);
  }
  return dot / m;
}

function mean(arr){
  return arr.reduce((a,b)=>a+b,0) / Math.max(arr.length,1);
}

// ---------- Indicators ----------
function calcRSI(closes, period=14){
  if(closes.length < period+1) return 50;
  let gains = 0, losses = 0;
  for(let i = closes.length - period - 1; i < closes.length - 1; i++){
    const diff = closes[i+1] - closes[i];
    if(diff >= 0) gains += diff;
    else losses -= diff;
  }
  if(losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function ema(values, period){
  const k = 2 / (period + 1);
  let prev = values[0];
  const out = [prev];
  for(let i=1;i<values.length;i++){
    prev = values[i]*k + prev*(1-k);
    out.push(prev);
  }
  return out;
}

function emaLast(values, period){
  if(values.length < period) return values[values.length-1] || 0;
  const e = ema(values.slice(-Math.max(period*3, period+5)), period);
  return e[e.length-1];
}

function calcMACD(closes){
  if(closes.length < 60) return { macd:0, signal:0, hist:0 };
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = e12.map((v,i)=> v - e26[i]);
  const signalLine = ema(macdLine, 9);
  const macd = macdLine[macdLine.length-1];
  const signal = signalLine[signalLine.length-1];
  const hist = macd - signal;
  return { macd, signal, hist };
}

function calcATR(highs, lows, closes, period=14){
  if(closes.length < period+1) return 0;
  const trs = [];
  for(let i=1;i<closes.length;i++){
    const h = highs[i], l = lows[i], pc = closes[i-1];
    const tr = Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc));
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  const sum = slice.reduce((a,b)=>a+b,0);
  return sum / slice.length;
}

function calcVolumeTrend(vols, lookback=20){
  if(vols.length < lookback*2) return 0;
  const a = avg(vols.slice(-lookback));
  const b = avg(vols.slice(-(lookback*2), -lookback));
  if(b === 0) return 0;
  return (a - b) / b;
}

function avg(arr){
  if(!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

// ---------- Protections ----------
function hasActivePosition(symbol, tfRaw){
  return state.activePositions.some(p => p.symbol === symbol && p.tfRaw === tfRaw);
}

function isInCooldown(key){
  const last = state.lastSignalAt?.[key] || 0;
  const cd = COOLDOWN_MS[state.tf] || (10*60*1000);
  return (Date.now() - last) < cd;
}

// ---------- Storage + Fetch ----------
function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

async function fetchJSON(url, opt={}){
  const timeoutMs = opt.timeoutMs ?? 7000;
  const retry = opt.retry ?? 0;

  let lastErr = null;
  for(let i=0;i<=retry;i++){
    try{
      const data = await fetchWithTimeout(url, timeoutMs);
      return data;
    }catch(e){
      lastErr = e;
      await sleep(350 * (i+1));
    }
  }
  throw lastErr;
}

async function fetchWithTimeout(url, timeoutMs){
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try{
    const r = await fetch(url, { cache:"no-store", signal: controller.signal });
    if(!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  }finally{
    clearTimeout(id);
  }
}

function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

// ---------- Utils ----------
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function safeLog10(x){ return Math.log10(Math.max(x, 1)); }
function formatMoney(x){
  if(x >= 1e12) return (x/1e12).toFixed(2)+"T";
  if(x >= 1e9)  return (x/1e9).toFixed(2)+"B";
  if(x >= 1e6)  return (x/1e6).toFixed(2)+"M";
  if(x >= 1e3)  return (x/1e3).toFixed(2)+"K";
  return String(Math.round(x));
}
