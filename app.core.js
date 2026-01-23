/*************************************************************
 * YOPO AI PRO — app.core.js (분할 v1)
 * 역할: 공용 상수/전역상태(state)/저장/유틸/토스트/시간계산/지표/유사도/신호코어
 * 주의:
 * - index.html onclick 바인딩(window.xxx=...)은 app.features.js에서 최종 처리
 * - 이 파일은 “공용 기반”만 제공한다.
 *************************************************************/

/* =========================
   AUTH
========================= */
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
    if(err) err.style.display = "none";
    hideAuth();
  }else{
    if(err) err.style.display = "block";
    input.value = "";
    input.focus();
  }
}

/* =========================
   Storage
========================= */
const STORAGE_KEY = "yopo_single_v6_state";

function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

/* =========================
   API constants (URL만)
========================= */
const BYBIT_TICKERS = "https://api.bybit.com/v5/market/tickers?category=linear";
const BYBIT_KLINE = (symbol, interval, limit) =>
  `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;

const CG_MARKETS = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h";
const CG_GLOBAL  = "https://api.coingecko.com/api/v3/global";

/* =========================
   Similarity / Analysis Params
========================= */
const SIM_WINDOW = 40;
const FUTURE_H = 8;     // ✅ “평가 기간”에 사용 (유사패턴 미래 비교용)  ※ 카운트다운에는 사용 금지
const SIM_STEP = 2;
const SIM_TOPK = 25;

// HOLD rules
const HOLD_MIN_TOPK = 12;
const HOLD_MIN_SIM_AVG = 55;
const HOLD_MIN_EDGE = 0.08;
const HOLD_MIN_TP_PCT = 0.8;

// ✅ MTF 합의 기준
const MTF_WEIGHTS_3TF = { "60": 0.50, "240": 0.30, "D": 0.20 }; // 분석(정밀): 3TF
const MTF_WEIGHTS_2TF = { "base": 0.65, "other": 0.35 };       // 스캔/백테스트(속도): 2TF
const MTF_MIN_AGREE = 2;           // 3TF 중 최소 2개는 같은 방향이어야 안정
const MTF_DISAGREE_PENALTY = 0.06; // 합의 부족이면 edge를 살짝 깎아 더 보수적(HOLD 증가)

// TP/SL
const RR = 2.0;
const TF_MULT = { "60": 1.2, "240": 2.0, "D": 3.5 };
const ATR_MIN_PCT = 0.15;
const TP_MAX_PCT = 20.0;

// ✅ UPGRADE ②: 확신도 기반 TP/SL 미세 조정
const CONF_TIER_HIGH = { winProb: 0.66, edge: 0.13 };
const CONF_TIER_MID  = { winProb: 0.60, edge: 0.10 };
const CONF_TP_SCALE  = { HIGH: 1.10, MID: 1.00, LOW: 0.88 };
const CONF_RR_VALUE  = { HIGH: 2.20, MID: 1.90, LOW: 1.45 };
const CONF_EDGE_FLOOR = 0.04;

// ✅ UPGRADE ③: TIME 종료 판정 고도화(MFE 반영)
const TIME_MFE_MIN_PCT = 0.45;
const TIME_MFE_TP_RATIO = 0.55;

// cooldown
const COOLDOWN_MS = { "60": 10 * 60 * 1000, "240": 30 * 60 * 1000, "D": 2 * 60 * 60 * 1000 };

// scan delay
const SCAN_DELAY_MS = 650;

// backtest
const BACKTEST_TRADES = 80;
const EXTENDED_LIMIT = 900;

// 백테스트 필터(잡신호 제거용)
const BT_MIN_PROB = 0.58;
const BT_MIN_EDGE = 0.10;
const BT_MIN_SIM  = 60;

/* ==========================================================
   ✅ ADD (2026-01-22E) 근본 업그레이드: 레짐/최근가중/실전보정/변동성/트레일링/수수료
   ========================================================== */

// 1) 레짐(추세) 필터
const REGIME_MIN_STRENGTH_BY_TF = { "60": 0.55, "240": 0.50, "D": 0.45 };

// 2) 유사도 최근가중치
const SIM_RECENCY_HALFLIFE_STEPS = 140;

// 2-추가) 최근 성과 캘리브레이션
const RECENT_CALIB_N = 20;
const RECENT_CALIB_ALPHA = 0.15;

// 3) 변동성 위험 필터
const VOL_MAX_ATR_PCT_BY_TF = { "60": 2.20, "240": 3.10, "D": 4.60 };

// 4) 브레이크이븐/트레일링
const BE_TRIGGER_PCT = 0.65;
const BE_OFFSET_PCT  = 0.06;
const TRAIL_START_PCT = 1.10;
const TRAIL_GAP_PCT   = 0.55;

// 5) 비용(수수료+슬리피지)
const FEE_PCT = 0.12; // % 단위

/* ==========================================================
   ✅ NEW: 실패 패턴 엔진 (핵심 변경: "차단" → "패널티")
   ========================================================== */
const PATTERN_DB_VERSION = 1;
const PATTERN_MIN_SAMPLES = 14;       // 통계로 쓸 최소 표본
const PATTERN_BAD_WINRATE = 0.48;     // 이하면 "나쁜 패턴"
const PATTERN_MAX_AVOID = 120;        // avoid 리스트 상한
const PATTERN_BIN = {
  atrPct: 0.50,
  trendStrength: 0.10,
  edge: 0.02,
  simAvg: 5,
  dom: 1.0
};

// ✅ 핵심: 예측을 줄이지 않기 위한 "감점" 파라미터
const PATTERN_PENALTY_MAX = 0.12;     // winProb 최대 감점(0~0.12)
const PATTERN_PENALTY_EDGE_W = 0.70;  // edge 감점 비중
const PATTERN_HARD_HOLD_WR = 0.34;    // 정말 최악일 때만 HOLD
const PATTERN_HARD_HOLD_N  = 28;      // 표본도 충분할 때만

function ensurePatternDB(){
  if(!state.patternDB || typeof state.patternDB !== "object"){
    state.patternDB = { v: PATTERN_DB_VERSION, stats: {}, avoid: {} };
    saveState();
    return;
  }
  if(state.patternDB.v !== PATTERN_DB_VERSION){
    state.patternDB = { v: PATTERN_DB_VERSION, stats: {}, avoid: {} };
    saveState();
    return;
  }
  if(!state.patternDB.stats || typeof state.patternDB.stats !== "object") state.patternDB.stats = {};
  if(!state.patternDB.avoid || typeof state.patternDB.avoid !== "object") state.patternDB.avoid = {};
}

function _bin(x, step){
  const v = Number.isFinite(x) ? x : 0;
  const s = Math.max(step, 1e-9);
  return Math.max(0, Math.floor(v / s));
}

function buildPatternSignature(symbol, tfRaw, type, ex){
  const atrB = _bin(ex?.atrPct ?? 0, PATTERN_BIN.atrPct);
  const tsB  = _bin(ex?.trendStrength ?? 0, PATTERN_BIN.trendStrength);
  const eB   = _bin(ex?.edge ?? 0, PATTERN_BIN.edge);
  const sB   = _bin(ex?.simAvg ?? 0, PATTERN_BIN.simAvg);
  const mA   = Number.isFinite(ex?.mtf?.agree) ? ex.mtf.agree : 1;
  const cT   = (ex?.conf?.tier) ? String(ex.conf.tier) : "NA";

  const dom = (typeof ex?.btcDom === "number") ? ex.btcDom : null;
  const domB = dom === null ? "X" : String(_bin(dom, PATTERN_BIN.dom));
  const domUp = (typeof ex?.btcDomUp === "number") ? ex.btcDomUp : 0;
  const domU = domUp > 0.10 ? "UP" : domUp < -0.10 ? "DN" : "FL";

  return `${symbol}|${tfRaw}|${type}|A${atrB}|T${tsB}|E${eB}|S${sB}|M${mA}|C${cT}|D${domB}|U${domU}`;
}

function recordPatternOutcome(signature, win){
  ensurePatternDB();
  if(!signature) return;

  const stats = state.patternDB.stats;
  const cur = stats[signature] || { n: 0, win: 0 };
  cur.n += 1;
  if(win) cur.win += 1;
  stats[signature] = cur;

  // avoid: "통계가 충분하고 승률이 낮으면" 등록 (여기서는 '차단 리스트'로 쓰지 않고 '패널티 메타'로 씀)
  const wr = cur.n > 0 ? (cur.win / cur.n) : 1;
  if(cur.n >= PATTERN_MIN_SAMPLES && wr <= PATTERN_BAD_WINRATE){
    state.patternDB.avoid[signature] = { n: cur.n, wr: wr };
  }else{
    if(state.patternDB.avoid[signature]) delete state.patternDB.avoid[signature];
  }

  // 상한
  const keys = Object.keys(state.patternDB.avoid);
  if(keys.length > PATTERN_MAX_AVOID){
    keys.sort((a,b)=> (state.patternDB.avoid[a]?.n ?? 0) - (state.patternDB.avoid[b]?.n ?? 0));
    const trim = keys.length - PATTERN_MAX_AVOID;
    for(let i=0;i<trim;i++){
      delete state.patternDB.avoid[keys[i]];
    }
  }

  saveState();
}

function getAvoidMeta(signature){
  ensurePatternDB();
  return state.patternDB.avoid?.[signature] || null;
}

// ✅ 핵심: 승률/표본 기반 패널티 계산 (예측을 "줄이지" 않음)
function computePatternPenalty(meta){
  if(!meta) return { penalty: 0, hardHold: false };

  const n = Number(meta.n || 0);
  const wr = Number(meta.wr || 1);

  // 나쁜 정도(0~1): BAD_WINRATE(0.48)보다 얼마나 더 나쁜가
  const bad = clamp((PATTERN_BAD_WINRATE - wr) / Math.max(PATTERN_BAD_WINRATE, 1e-9), 0, 1);

  // 표본 가중(0~1): 14개부터 서서히 커짐
  const nW = clamp((n - PATTERN_MIN_SAMPLES) / 30, 0, 1);

  const penalty = clamp(PATTERN_PENALTY_MAX * bad * (0.45 + 0.55 * nW), 0, PATTERN_PENALTY_MAX);

  // 정말 최악일 때만 HOLD (예측 줄이기 목적이 아니라 "반복 폭사 방지")
  const hardHold = (n >= PATTERN_HARD_HOLD_N && wr <= PATTERN_HARD_HOLD_WR);

  return { penalty, hardHold };
}

/* =========================
   Candidate List (15)
========================= */
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

/* =========================
   State (전역)
========================= */
let state = loadState() || {
  symbol: "BTCUSDT",
  tf: "60",
  universe: DEFAULT_CANDIDATES.map(x => ({...x})),
  activePositions: [],
  history: { total: 0, win: 0 },
  closedTrades: [],
  lastUniverseAt: 0,
  btcDom: null,
  btcDomPrev: null,
  lastApiHealth: "warn",
  lastSignalAt: {},
  lastScanAt: 0,
  lastScanResults: [],
  lastPrices: {}
};

ensurePatternDB();

let tempPos = null; // 모달 임시 포지션(features에서 사용)

/* =========================
   Time helpers (카운트다운)
========================= */
function tfToMs(tfRaw){
  if(tfRaw === "60") return 60 * 60 * 1000;
  if(tfRaw === "240") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function formatRemain(ms){
  ms = Math.max(0, ms|0);

  const totalSec = Math.floor(ms / 1000);
  const ss = totalSec % 60;

  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;

  const totalH = Math.floor(totalMin / 60);
  const hh = totalH % 24;

  const dd = Math.floor(totalH / 24);

  if(dd > 0) return `${dd}일 ${hh}시간`;
  if(totalH > 0) return `${totalH}시간 ${mm}분 ${ss}초`;
  return `${totalMin}분 ${ss}초`;
}

// ✅ FIX: “전략 자체 시간”을 만료로 사용
function getPosExpiryAt(pos){
  const start = pos.createdAt || Date.now();
  return start + tfToMs(pos.tfRaw);
}

/* =========================
   TOAST (alert 대체)
========================= */
function ensureToastUI(){
  if(document.getElementById("yopo-toast-wrap")) return;

  const wrap = document.createElement("div");
  wrap.id = "yopo-toast-wrap";
  wrap.style.position = "fixed";
  wrap.style.top = "16px";
  wrap.style.right = "16px";
  wrap.style.zIndex = "9999999";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "10px";
  wrap.style.pointerEvents = "none";
  document.body.appendChild(wrap);
}

function toast(msg, kind="info"){
  ensureToastUI();
  const wrap = document.getElementById("yopo-toast-wrap");
  if(!wrap) return;

  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.style.minWidth = "260px";
  el.style.maxWidth = "360px";
  el.style.padding = "12px 14px";
  el.style.borderRadius = "14px";
  el.style.border = "1px solid var(--border)";
  el.style.boxShadow = "0 14px 32px rgba(0,0,0,.14)";
  el.style.fontWeight = "950";
  el.style.fontSize = "12px";
  el.style.lineHeight = "1.35";
  el.style.background = "#fff";
  el.style.opacity = "0";
  el.style.transform = "translateY(-6px)";
  el.style.transition = "opacity .18s ease, transform .18s ease";

  let leftBar = "var(--primary)";
  let title = "알림";
  if(kind === "success"){ leftBar = "var(--success)"; title = "성공"; }
  if(kind === "danger"){ leftBar = "var(--danger)"; title = "실패"; }
  if(kind === "warn"){ leftBar = "#f59e0b"; title = "주의"; }

  el.style.borderLeft = `5px solid ${leftBar}`;
  el.innerHTML = `<div style="font-size:11px; color:var(--text-sub); margin-bottom:4px;">${title}</div><div>${msg}</div>`;

  wrap.appendChild(el);

  requestAnimationFrame(()=>{
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });

  setTimeout(()=>{
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
    setTimeout(()=>{ try{ el.remove(); }catch(e){} }, 220);
  }, 3800);
}

/* =========================
   Migration helper
========================= */
function ensureExpiryOnAllPositions(){
  if(!state.activePositions?.length) return;
  let changed = false;

  for(const p of state.activePositions){
    if(!p.createdAt){
      p.createdAt = Date.now();
      changed = true;
    }

    const expected = p.createdAt + tfToMs(p.tfRaw);

    if(!p.expiryAt || Math.abs(p.expiryAt - expected) > (5 * 60 * 1000)){
      p.expiryAt = expected;
      changed = true;
    }

    if(typeof p.mfePct !== "number"){
      p.mfePct = 0;
      changed = true;
    }

    if(p.type !== "HOLD"){
      if(typeof p.sl !== "number" || !Number.isFinite(p.sl)) { p.sl = p.sl ?? p.entry; changed = true; }
      if(typeof p.tp !== "number" || !Number.isFinite(p.tp)) { p.tp = p.tp ?? p.entry; changed = true; }
    }

    if(!p.sig && p.explain && p.symbol && p.tfRaw && p.type && p.type !== "HOLD"){
      p.sig = buildPatternSignature(p.symbol, p.tfRaw, p.type, p.explain);
      changed = true;
    }
  }

  if(changed) saveState();
}

/* =========================
   MTF helpers
========================= */
function getMTFSet3(){ return ["60", "240", "D"]; }

function getMTFSet2(baseTf){
  if(baseTf === "60") return ["60", "240"];
  if(baseTf === "240") return ["240", "D"];
  return ["D", "240"];
}

function tfName(tfRaw){
  return tfRaw === "60" ? "1H" : tfRaw === "240" ? "4H" : "1D";
}

/* =========================
   Recent performance
========================= */
function getRecentWinRate(symbol, tfRaw, n=20){
  const list = state.closedTrades || [];
  let hit = 0, total = 0;
  for(const x of list){
    if(x.symbol !== symbol) continue;
    if(x.tfRaw !== tfRaw) continue;
    total++;
    if(x.win) hit++;
    if(total >= n) break;
  }
  if(total <= 0) return 0.5;
  return clamp(hit / total, 0.0, 1.0);
}

/* =========================
   Signal core (지표/유사도/합의)
========================= */
function computeSignalCore(symbol, tfRaw, candles){
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

  const trendStrength = (atrRaw > 0) ? (Math.abs(ema20 - ema50) / atrRaw) : 0;
  const atrPct = (entry > 0) ? ((atrRaw / entry) * 100) : 0;

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

  return {
    entry,
    tfRaw,
    type,
    winProb,
    longP,
    shortP,
    edge,
    simAvg: sim.avgSim,
    simCount: sim.count,
    rsi,
    macdHist: macd.hist,
    atrRaw,
    atrPct,
    volTrend,
    ema20,
    ema50,
    trend,
    trendStrength,
    btcDom: dom,
    btcDomUp: domUp,
    domHoldBoost
  };
}

function consensus3TF(cores){
  const w = MTF_WEIGHTS_3TF;

  let longP = 0, shortP = 0;
  let simAvgW = 0, simCountW = 0;
  let edgeW = 0, winProbW = 0;

  const votes = [];
  for(const tfRaw of Object.keys(w)){
    const c = cores[tfRaw];
    if(!c) continue;
    const wt = w[tfRaw] || 0;
    longP += (c.longP * wt);
    shortP += (c.shortP * wt);
    simAvgW += (c.simAvg * wt);
    simCountW += (c.simCount * wt);
    edgeW += (c.edge * wt);
    winProbW += (c.winProb * wt);
    votes.push(c.type);
  }

  const sum = Math.max(longP + shortP, 1e-9);
  longP /= sum; shortP /= sum;

  const type = (longP >= shortP) ? "LONG" : "SHORT";
  const winProb = Math.max(longP, shortP);
  let edge = Math.abs(longP - shortP);

  let agree = 0;
  for(const v of votes){
    if(v === type) agree++;
  }

  if(agree < MTF_MIN_AGREE){
    edge = Math.max(0, edge - MTF_DISAGREE_PENALTY);
  }

  return {
    longP, shortP, type, winProb, edge,
    simAvg: simAvgW,
    simCount: Math.round(simCountW),
    agree,
    votes
  };
}

function consensus2TF(baseCore, otherCore){
  const wb = MTF_WEIGHTS_2TF.base;
  const wo = MTF_WEIGHTS_2TF.other;

  let longP = baseCore.longP * wb + otherCore.longP * wo;
  let shortP = baseCore.shortP * wb + otherCore.shortP * wo;

  const sum = Math.max(longP + shortP, 1e-9);
  longP /= sum; shortP /= sum;

  const type = (longP >= shortP) ? "LONG" : "SHORT";
  const winProb = Math.max(longP, shortP);
  let edge = Math.abs(longP - shortP);

  const agree = (baseCore.type === otherCore.type) ? 2 : 1;
  if(agree < 2){
    edge = Math.max(0, edge - (MTF_DISAGREE_PENALTY * 0.7));
  }

  return {
    longP, shortP, type, winProb, edge,
    simAvg: (baseCore.simAvg * wb + otherCore.simAvg * wo),
    simCount: Math.round(baseCore.simCount * wb + otherCore.simCount * wo),
    agree,
    votes: [baseCore.type, otherCore.type]
  };
}

function getConfidenceTier(winProb, edge){
  const e = Math.max(0, edge || 0);
  const w = Math.max(0, Math.min(1, winProb || 0));

  if(e < CONF_EDGE_FLOOR) return "LOW";
  if(w >= CONF_TIER_HIGH.winProb && e >= CONF_TIER_HIGH.edge) return "HIGH";
  if(w >= CONF_TIER_MID.winProb && e >= CONF_TIER_MID.edge) return "MID";
  return "LOW";
}

function applyConfidenceTpSl(tpDist, winProb, edge){
  const tier = getConfidenceTier(winProb, edge);
  const tpScale = CONF_TP_SCALE[tier] ?? 1.0;
  const rr = CONF_RR_VALUE[tier] ?? RR;
  return { tier, rr, tpDist: tpDist * tpScale };
}

function buildSignalFromCandles_MTF(symbol, baseTfRaw, candlesByTf, mode="3TF"){
  const baseCandles = candlesByTf[baseTfRaw];
  const base = computeSignalCore(symbol, baseTfRaw, baseCandles);

  const entry = base.entry;

  const atrMin = entry * (ATR_MIN_PCT / 100);
  const atrUsed = Math.max(base.atrRaw, atrMin);

  const tfMult = TF_MULT[baseTfRaw] || 1.2;
  let tpDistBase = atrUsed * tfMult;

  let con = null;
  let mtfExplain = null;

  if(mode === "3TF"){
    const cores = {};
    for(const tfRaw of getMTFSet3()){
      const candles = candlesByTf[tfRaw];
      if(!candles || candles.length < (SIM_WINDOW + FUTURE_H + 80)) continue;
      cores[tfRaw] = computeSignalCore(symbol, tfRaw, candles);
    }
    const have = Object.keys(cores).length;
    if(have >= 2){
      if(have === 3){
        con = consensus3TF(cores);
      }else{
        const keys = Object.keys(cores);
        const c0 = cores[keys[0]];
        const c1 = cores[keys[1]];
        con = consensus2TF(c0, c1);
      }
      mtfExplain = cores;
    }else{
      con = {
        longP: base.longP, shortP: base.shortP,
        type: base.type, winProb: base.winProb, edge: base.edge,
        simAvg: base.simAvg, simCount: base.simCount,
        agree: 1, votes: [base.type]
      };
      mtfExplain = { [baseTfRaw]: base };
    }
  }else{
    const set = getMTFSet2(baseTfRaw);
    const otherTf = set[1];
    const otherCandles = candlesByTf[otherTf];

    if(otherCandles && otherCandles.length >= (SIM_WINDOW + FUTURE_H + 80)){
      const other = computeSignalCore(symbol, otherTf, otherCandles);
      con = consensus2TF(base, other);
      mtfExplain = { [baseTfRaw]: base, [otherTf]: other };
    }else{
      con = {
        longP: base.longP, shortP: base.shortP,
        type: base.type, winProb: base.winProb, edge: base.edge,
        simAvg: base.simAvg, simCount: base.simCount,
        agree: 1, votes: [base.type]
      };
      mtfExplain = { [baseTfRaw]: base };
    }
  }

  const type = con.type;

  // 기본 확률/엣지
  const winProbRaw = con.winProb;
  let winProbAdj = winProbRaw;
  let edgeAdj = con.edge;

  // 최근 성과 보정(기존)
  const recent = getRecentWinRate(symbol, baseTfRaw, RECENT_CALIB_N);
  winProbAdj = clamp((1 - RECENT_CALIB_ALPHA) * winProbAdj + RECENT_CALIB_ALPHA * recent, 0.5, 0.99);

  // --- explain(초안) ---
  const holdReasons = [];
  const mtfVotes = (con.votes || []).join("/");

  const explainBase = {
    winProb: winProbAdj,      // 이후 패턴 패널티 반영으로 갱신됨
    winProbRaw: winProbRaw,
    recentWinRate: recent,
    longP: con.longP,
    shortP: con.shortP,
    edge: edgeAdj,            // 이후 패턴 패널티 반영으로 갱신됨
    simAvg: con.simAvg,
    simCount: con.simCount,

    rsi: base.rsi,
    macdHist: base.macdHist,
    atr: Math.max(atrUsed, 1e-9),
    atrPct: base.atrPct,
    volTrend: base.volTrend,
    ema20: base.ema20,
    ema50: base.ema50,
    trend: base.trend,
    trendStrength: base.trendStrength,
    btcDom: base.btcDom,
    btcDomUp: base.btcDomUp,

    conf: null, // 아래에서 채움
    mtf: {
      mode,
      agree: con.agree,
      votes: con.votes,
      weights: (mode === "3TF") ? MTF_WEIGHTS_3TF : MTF_WEIGHTS_2TF,
      detail: Object.fromEntries(Object.entries(mtfExplain || {}).map(([k,v]) => ([
        k,
        {
          tf: tfName(k),
          type: v.type,
          winProb: v.winProb,
          edge: v.edge,
          simAvg: v.simAvg,
          simCount: v.simCount,
          trendStrength: v.trendStrength,
          atrPct: v.atrPct
        }
      ])))
    },

    holdReasons,
    pattern: null // 아래에서 채움
  };

  // ✅ NEW: 실패패턴 "감점" 적용 (예측을 줄이지 않음)
  const sigForPenalty = buildPatternSignature(symbol, baseTfRaw, type, explainBase);
  const avoidMeta = getAvoidMeta(sigForPenalty);
  const pp = computePatternPenalty(avoidMeta);

  if(avoidMeta && pp.penalty > 0){
    // winProb, edge 감점 (최저 0.50 유지)
    winProbAdj = clamp(winProbAdj - pp.penalty, 0.50, 0.99);
    edgeAdj = Math.max(0, edgeAdj - (pp.penalty * PATTERN_PENALTY_EDGE_W));
  }

  // 패턴 메타 기록
  explainBase.pattern = avoidMeta ? {
    sig: sigForPenalty,
    n: Number(avoidMeta.n || 0),
    wr: Number(avoidMeta.wr || 0),
    penalty: pp.penalty,
    hardHold: pp.hardHold
  } : {
    sig: sigForPenalty,
    n: 0,
    wr: null,
    penalty: 0,
    hardHold: false
  };

  // explain에 갱신 반영
  explainBase.winProb = winProbAdj;
  explainBase.edge = edgeAdj;

  // 확신도 기반 TP/SL (패널티 반영된 winProb/edge로 결정)
  const adj = applyConfidenceTpSl(tpDistBase, winProbAdj, edgeAdj);
  const tpDist = adj.tpDist;
  const rrUsed = adj.rr;
  explainBase.conf = { tier: adj.tier, rrUsed, tpScale: (CONF_TP_SCALE[adj.tier] ?? 1.0) };

  const slDist = tpDist / Math.max(rrUsed, 1.01);

  let tp = (type === "LONG") ? (entry + tpDist) : (entry - tpDist);
  let sl = (type === "LONG") ? (entry - slDist) : (entry + slDist);

  let tpPct = Math.abs((tp - entry) / entry) * 100;
  let slPct = Math.abs((sl - entry) / entry) * 100;

  if(tpPct > TP_MAX_PCT){
    tpPct = TP_MAX_PCT;
    const newTpDist = entry * (tpPct/100);
    tp = (type === "LONG") ? (entry + newTpDist) : (entry - newTpDist);
    sl = (type === "LONG")
      ? (entry - (newTpDist/Math.max(rrUsed, 1.01)))
      : (entry + (newTpDist/Math.max(rrUsed, 1.01)));
    slPct = Math.abs((sl - entry) / entry) * 100;
  }

  // HOLD 룰(기존)
  if(con.simCount < HOLD_MIN_TOPK) holdReasons.push(`유사패턴 표본 부족(${con.simCount}개)`);
  if(con.simAvg < HOLD_MIN_SIM_AVG) holdReasons.push(`유사도 평균 낮음(${con.simAvg.toFixed(1)}%)`);
  if(edgeAdj < HOLD_MIN_EDGE) holdReasons.push(`롱/숏 차이 작음(엣지 ${(edgeAdj*100).toFixed(1)}%)`);
  if(tpPct < HOLD_MIN_TP_PCT) holdReasons.push(`목표수익 너무 작음(+${tpPct.toFixed(2)}%)`);

  if(con.votes && con.votes.length >= 2){
    const agreeNeed = (con.votes.length === 3) ? MTF_MIN_AGREE : 2;
    if(con.agree < agreeNeed){
      holdReasons.push(`타임프레임 합의 부족(${mtfVotes})`);
    }
  }

  const minStrength = REGIME_MIN_STRENGTH_BY_TF[baseTfRaw] ?? 0.5;
  const ts = base.trendStrength ?? 0;
  if(ts < minStrength){
    holdReasons.push(`추세 약함(강도 ${ts.toFixed(2)} < ${minStrength.toFixed(2)})`);
  }

  const maxAtrPct = VOL_MAX_ATR_PCT_BY_TF[baseTfRaw] ?? 3.0;
  const ap = base.atrPct ?? 0;
  if(ap > maxAtrPct){
    holdReasons.push(`급변동 위험(ATR ${ap.toFixed(2)}% > ${maxAtrPct.toFixed(2)}%)`);
  }

  if(base.domHoldBoost >= 2 && symbol !== "BTCUSDT") holdReasons.push(`BTC 도미넌스 환경이 알트에 불리(보수적)`);
  if(base.volTrend < -0.25) holdReasons.push(`거래량 흐름 약함(신뢰↓)`);

  // 패턴 감점은 설명용 문구만 추가
  if(avoidMeta && pp.penalty > 0){
    holdReasons.push(`(패턴 감점 적용: -${(pp.penalty*100).toFixed(1)}%p, n=${avoidMeta.n}, wr ${(avoidMeta.wr*100).toFixed(0)}%)`);
  }

  const isHoldByBaseRules = holdReasons.some(r => !String(r).startsWith("(패턴 감점 적용"));

  const hardHold = !!(avoidMeta && pp.hardHold);
  if(hardHold){
    holdReasons.push(`실패패턴 극악(강제 HOLD): n=${avoidMeta.n}, wr ${(avoidMeta.wr*100).toFixed(0)}%`);
  }

  const finalHold = isHoldByBaseRules || hardHold;

  return {
    id: Date.now(),
    symbol,
    tf: baseTfRaw === "60" ? "1H" : baseTfRaw === "240" ? "4H" : "1D",
    tfRaw: baseTfRaw,
    type: finalHold ? "HOLD" : type,
    entry,
    tp: finalHold ? null : tp,
    sl: finalHold ? null : sl,
    tpPct: finalHold ? null : tpPct,
    slPct: finalHold ? null : slPct,
    createdAt: Date.now(),
    explain: explainBase,
    sig: finalHold ? null : sigForPenalty
  };
}

// (기존 함수명 유지용)
function buildSignalFromCandles(symbol, tf, candles){
  const byTf = { [tf]: candles };
  return buildSignalFromCandles_MTF(symbol, tf, byTf, "2TF");
}

/* =========================
   Similarity (최근가중)
========================= */
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

    const ageSteps = (lastStart - s) / Math.max(step, 1);
    const w = Math.exp(-Math.log(2) * (ageSteps / Math.max(SIM_RECENCY_HALFLIFE_STEPS, 1)));

    sims.push({ sim, r, w });
  }

  sims.sort((a,b)=> b.sim - a.sim);
  const top = sims.slice(0, Math.min(topK, sims.length));

  const count = top.length;
  if(count === 0){
    return { longProb: 0.5, shortProb: 0.5, avgSim: 0, count: 0 };
  }

  let wSum = 0, wUp = 0, wDown = 0;
  for(const x of top){
    const w = Number.isFinite(x.w) ? x.w : 1;
    wSum += w;
    if(x.r >= 0) wUp += w;
    else wDown += w;
  }

  const longProb = (wUp + 1) / (wSum + 2);
  const shortProb = (wDown + 1) / (wSum + 2);

  let avgZ = 0;
  for(const x of top){
    const w = Number.isFinite(x.w) ? x.w : 1;
    avgZ += (x.sim * w);
  }
  avgZ = avgZ / Math.max(wSum, 1e-9);
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

/* =========================
   Indicators
========================= */
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

/* =========================
   Protections (공용)
========================= */
function hasActivePosition(symbol, tfRaw){
  return state.activePositions.some(p => p.symbol === symbol && p.tfRaw === tfRaw);
}

// ✅ FIX: tfRaw를 인자로 받아 COOLDOWN 기준이 깨지지 않게 함
function isInCooldown(key, tfRaw = state.tf){
  const last = state.lastSignalAt?.[key] || 0;
  const cd = COOLDOWN_MS[tfRaw] || (10*60*1000);
  return (Date.now() - last) < cd;
}

/* =========================
   Fetch helpers (공용)
========================= */
async function fetchJSON(url, opt={}){
  const timeoutMs = opt.timeoutMs ?? 7000;
  const retry = opt.retry ?? 0;

  let lastErr = null;
  for(let i=0;i<=retry;i++){
    try{
      const data = await fetchWithTimeout(url, timeoutMs);
