/*************************************************************
 * YOPO AI PRO (Single-File, v6)
 * - 추가: 비밀번호(2580) 게이트, 추천 클릭→즉시 분석→추적,
 *         코인 리스트 “가격+%” 강화, 종료 기록 패널,
 *         백테스트 필터 강화형
 *
 * ✅ PATCH (2026-01-21)
 * 1) 실시간 포지션 정밀추적: 전략별(1H/4H/1D) 남은시간(카운트다운) 표시
 * 2) 추적 카드 TP/SL에 +% / -% 표시
 *
 * ✅ PATCH (2026-01-22)
 * A) 카운트다운: 전체 렌더링 반복 제거 → 부분 업데이트로 변경(성능/안정성)
 * B) TP/SL 종료 알림: alert() 제거 → 토스트 알림으로 변경(UX/실시간 끊김 방지)
 *
 * ✅ FIX (2026-01-22)
 * 1) 남은시간 계산: FUTURE_H 곱 제거 → 전략 자체 시간(1H/4H/1D)로 고정
 * 2) 기존 저장 포지션 expiryAt 자동 보정(마이그레이션)
 * 3) 카운트다운 초 단위 표시(실시간 체감)
 *
 * ✅ UPGRADE (2026-01-22)
 * ★ MTF(멀티 타임프레임) 합의 도입
 * - 분석(버튼/추천): 1H+4H+1D 3TF 합의(정밀)
 * - 자동스캔/백테스트: 2TF 합의(속도)
 * - 합의가 깨지면 HOLD 이유로 자동 반영(꼼수X, 승률 안정화)
 *
 * ✅ UPGRADE (2026-01-22B)
 * ★ ② 확신도 기반 TP/SL 미세 조정
 * - 확신 높음(edge/winProb): TP 조금 확대 + RR 살짝↑
 * - 확신 보통: 기본에 가깝게
 * - 확신 낮음: TP 현실적으로 축소 + RR↓(승률↑ 방향)
 *
 * ✅ UPGRADE (2026-01-22C)
 * ★ ③ TIME 종료 판정 고도화(MFE 반영)
 * - TIME 종료 시 최종 pnl뿐 아니라, "중간에 얼마나 갔는지(mfePct)" 반영
 * - “중간에 충분히 갔던 신호”를 통계적으로 보정 (조작X: 규칙 공개)
 *
 * ✅ ROOT UPGRADE (2026-01-22E)
 * ★ 근본 업그레이드: 레짐/최근가중/성과보정/변동성필터/트레일링/수수료
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
const FUTURE_H = 8;     // ✅ “평가 기간”에 사용 (유사패턴 미래 비교용)  ※ 카운트다운에는 사용 금지
const SIM_STEP = 2;
const SIM_TOPK = 25;

// HOLD rules
const HOLD_MIN_TOPK = 12;
const HOLD_MIN_SIM_AVG = 55;
const HOLD_MIN_EDGE = 0.08;
const HOLD_MIN_TP_PCT = 0.8;

// ✅ MTF(멀티 타임프레임) 합의 기준 (꼼수X: 근거를 늘려서 안정화)
const MTF_WEIGHTS_3TF = { "60": 0.50, "240": 0.30, "D": 0.20 }; // 분석(정밀): 3TF
const MTF_WEIGHTS_2TF = { "base": 0.65, "other": 0.35 };       // 스캔/백테스트(속도): 2TF
const MTF_MIN_AGREE = 2;           // 3TF 중 최소 2개는 같은 방향이어야 안정
const MTF_DISAGREE_PENALTY = 0.06; // 합의 부족이면 edge를 살짝 깎아 더 보수적(HOLD 증가)

// TP/SL
const RR = 2.0;
const TF_MULT = { "60": 1.2, "240": 2.0, "D": 3.5 };
const ATR_MIN_PCT = 0.15;
const TP_MAX_PCT = 20.0;

// ✅ UPGRADE ②: 확신도 기반 TP/SL 미세 조정 파라미터
// - 목표: “확신 낮은데 욕심 TP”를 줄여 실패↓, 실전 체감 승률↑
const CONF_TIER_HIGH = { winProb: 0.66, edge: 0.13 };  // 둘 다 만족하면 HIGH
const CONF_TIER_MID  = { winProb: 0.60, edge: 0.10 };  // 둘 중 하나라도 약하면 MID
// HIGH: TP ↑ + RR ↑(조금 더 멀리)
// MID : 거의 기본
// LOW : TP ↓ + RR ↓(TP 더 가깝게, SL은 상대적으로 넓혀 승률↑)
const CONF_TP_SCALE  = { HIGH: 1.10, MID: 1.00, LOW: 0.88 };
const CONF_RR_VALUE  = { HIGH: 2.20, MID: 1.90, LOW: 1.45 };
const CONF_EDGE_FLOOR = 0.04; // 너무 애매한 엣지는 LOW 취급(안전)

// ✅ UPGRADE ③: TIME 종료 판정 고도화(MFE 반영)
// - TIME 종료 시 최종 pnl<=0이라도, 중간에 “충분히” 갔던 신호는 성공으로 보정
// - 조작X: 공개 규칙(둘 다 만족해야 TIME 성공으로 인정)
const TIME_MFE_MIN_PCT = 0.45;    // 최소 0.45%는 중간에 가야 함
const TIME_MFE_TP_RATIO = 0.55;   // “TP의 55% 이상”까지 갔으면 충분했다고 판단

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

/* ==========================================================
   ✅ ADD (2026-01-22E) 근본 업그레이드: 레짐/최근가중/실전보정/변동성/트레일링/수수료
   ========================================================== */

// 1) 레짐(추세) 필터: 추세 강도(EMA거리/ATR)가 낮으면 HOLD
const REGIME_MIN_STRENGTH_BY_TF = {
  "60": 0.55,
  "240": 0.50,
  "D": 0.45
};

// 2) 유사도 최근가중치: 오래된 패턴 영향↓
const SIM_RECENCY_HALFLIFE_STEPS = 140; // 값↓일수록 더 "최근만" 믿음

// 2-추가) 최근 성과 캘리브레이션: winProb 소폭 보정
const RECENT_CALIB_N = 20;
const RECENT_CALIB_ALPHA = 0.15;

// 3) 변동성 위험 필터: ATR%가 너무 크면 HOLD
const VOL_MAX_ATR_PCT_BY_TF = { // 보수적으로: 급변 구간 회피
  "60": 2.20,
  "240": 3.10,
  "D": 4.60
};

// 4) 브레이크이븐/트레일링
const BE_TRIGGER_PCT = 0.65;     // MFE가 +0.65% 이상이면 보호 시작
const BE_OFFSET_PCT  = 0.06;     // SL을 진입가 +0.06%(롱) / -0.06%(숏)로
const TRAIL_START_PCT = 1.10;    // MFE가 +1.10% 이상이면 트레일링 시작
const TRAIL_GAP_PCT   = 0.55;    // 최고수익 대비 0.55% 뒤로 SL 따라오기

// 5) 비용(수수료+슬리피지) 반영(보수적으로)
const FEE_PCT = 0.12;            // % 단위. (원하면 조절)

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
  if(tfRaw === "60") return 60 * 60 * 1000;        // 1H
  if(tfRaw === "240") return 4 * 60 * 60 * 1000;   // 4H
  return 24 * 60 * 60 * 1000;                      // 1D
}

// ✅ FIX: 초 단위 표시까지 (실시간 카운트 체감)
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

// ✅ FIX: “전략 자체 시간”을 만료로 사용 (FUTURE_H 금지)
function getPosExpiryAt(pos){
  const start = pos.createdAt || Date.now();
  return start + tfToMs(pos.tfRaw);
}

/* ==========================================================
   ✅ PATCH (2026-01-22): TOAST (alert 대체)
   ========================================================== */
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
  wrap.styleE6p.style.pointerEvents = "none";
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

/* ==========================================================
   ✅ PATCH (2026-01-22): COUNTDOWN 부분 업데이트
   ========================================================== */

// ✅ FIX: 기존 저장된 포지션 expiryAt이 FUTURE_H 기반이면 자동 보정
function ensureExpiryOnAllPositions(){
  if(!state.activePositions?.length) return;
  let changed = false;

  for(const p of state.activePositions){
    if(!p.createdAt){
      p.createdAt = Date.now();
      changed = true;
    }

    const expected = p.createdAt + tfToMs(p.tfRaw);

    // 5분 이상 차이나면 잘못된 값으로 판단하고 교정
    if(!p.expiryAt || Math.abs(p.expiryAt - expected) > (5 * 60 * 1000)){
      p.expiryAt = expected;
      changed = true;
    }

    // ✅ UPGRADE ③: mfePct 초기값 보정(구버전 마이그레이션)
    if(typeof p.mfePct !== "number"){
      p.mfePct = 0;
      changed = true;
    }

    // ✅ 안정: sl/tp가 숫자가 아니면 트레일링 때 터질 수 있으니 방어
    if(p.type !== "HOLD"){
      if(typeof p.sl !== "number" || !Number.isFinite(p.sl)) { p.sl = p.sl ?? p.entry; changed = true; }
      if(typeof p.tp !== "number" || !Number.isFinite(p.tp)) { p.tp = p.tp ?? p.entry; changed = true; }
    }
  }

  if(changed) saveState();
}

function updateCountdownTexts(){
  const list = state.activePositions || [];
  if(!list.length) return;

  for(const pos of list){
    const el = document.getElementById(`remain-${pos.id}`);
    if(!el) continue;

    const expiryAt = pos.expiryAt || getPosExpiryAt(pos);
    const remainMs = expiryAt - Date.now();
    el.textContent = formatRemain(remainMs);
  }
}

/* ==========================================================
   ✅ UPGRADE ③: TIME 종료 처리(MFE 반영)
   + ✅ UPGRADE ⑤: 비용(FEE_PCT) 반영(중복 차감 없음: 여기서 "한 번만" 차감)
   ========================================================== */
function settleExpiredPositions(){
  const list = state.activePositions || [];
  if(!list.length) return;

  const now = Date.now();
  let changed = false;

  for(let i = list.length - 1; i >= 0; i--){
    const pos = list[i];
    const expiryAt = pos.expiryAt || getPosExpiryAt(pos);
    if(now < expiryAt) continue;

    // 만료 시점: TP/SL 미도달 → TIME 종료
    const lastPrice = Number.isFinite(pos.lastPrice) ? pos.lastPrice : pos.entry;

    // 최종 pnl (NET: 비용 반영)
    let pnlGross = 0;
    if(pos.type === "LONG"){
      pnlGross = ((lastPrice - pos.entry) / pos.entry) * 100;
    }else{
      pnlGross = ((pos.entry - lastPrice) / pos.entry) * 100;
    }
    const pnl = pnlGross - FEE_PCT; // ✅ 비용 1회 차감(원천)
    pos.pnl = pnl;

    // ✅ MFE 기반 보정 승리 조건(공개 규칙)
    const mfe = (typeof pos.mfePct === "number") ? pos.mfePct : 0;
    const tpPct = Number.isFinite(pos.tpPct) ? pos.tpPct : null;

    let win = false;
    let reason = "TIME";
    if(pnl > 0){
      win = true;
      reason = "TIME";
    }else{
      const needByTp = (tpPct !== null) ? (tpPct * TIME_MFE_TP_RATIO) : TIME_MFE_MIN_PCT;
      const need = Math.max(TIME_MFE_MIN_PCT, needByTp);
      if(mfe >= need){
        win = true;
        reason = "TIME_MFE"; // ✅ “중간에 충분히 갔던 신호” 보정
      }else{
        win = false;
        reason = "TIME";
      }
    }

    state.history.total++;
    if(win) state.history.win++;

    const record = {
      id: Date.now(),
      symbol: pos.symbol,
      tf: pos.tf,
      tfRaw: pos.tfRaw,
      type: pos.type,
      entry: pos.entry,
      exit: lastPrice,
      pnlPct: pnl,          // ✅ NET
      mfePct: mfe,
      win,
      reason,
      closedAt: Date.now()
    };
    state.closedTrades.unshift(record);
    state.closedTrades = state.closedTrades.slice(0, 30);

    list.splice(i, 1);
    changed = true;

    const extra = (reason === "TIME_MFE")
      ? ` / MFE ${mfe.toFixed(2)}% (보정승)`
      : ` / MFE ${mfe.toFixed(2)}%`;
    toast(`[${pos.symbol} ${pos.tf}] 시간 종료: ${win ? "성공" : "실패"} (${reason}) / 수익률 ${pnl.toFixed(2)}%${extra} (비용 -${FEE_PCT.toFixed(2)}%)`, win ? "success" : "danger");
  }

  if(changed){
    saveState();
    renderTrackingList();
    renderClosedTrades();
    updateStatsUI();
  }
}

/* ==========================================================
   ✅ UPGRADE ②: 확신도 기반 TP/SL 미세 조정
   ========================================================== */
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

  return {
    tier,
    rr,
    tpDist: tpDist * tpScale
  };
}

/* ==========================================================
   ✅ UPGRADE: MTF(멀티 타임프레임) 합의
   ========================================================== */

// 3TF(정밀)에서 사용할 TF 세트
function getMTFSet3(){
  return ["60", "240", "D"];
}

// 2TF(속도)에서 base tf에 맞춰 “옆 TF” 하나만 선택
function getMTFSet2(baseTf){
  if(baseTf === "60") return ["60", "240"];
  if(baseTf === "240") return ["240", "D"];
  return ["D", "240"]; // 1D는 4H와 같이 보는게 체감이 좋음
}

// tfRaw -> 사람이 읽기 좋은 이름
function tfName(tfRaw){
  return tfRaw === "60" ? "1H" : tfRaw === "240" ? "4H" : "1D";
}

/* ==========================================================
   ✅ ADD: 최근 성과(winRate) 계산 (symbol+tf별 최근 N개)
   ========================================================== */
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

// “확률/엣지/유사도” 계산을 재사용하기 위한 코어 함수
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

  // ✅ 근본 1) 레짐(추세강도): |EMA20-EMA50| / ATR
  const trendStrength = (atrRaw > 0) ? (Math.abs(ema20 - ema50) / atrRaw) : 0;

  // ✅ 근본 3) 변동성(ATR%): ATR/entry*100
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
    atrPct,           // ✅ ADD
    volTrend,
    ema20,
    ema50,
    trend,
    trendStrength,    // ✅ ADD
    btcDom: dom,
    btcDomUp: domUp,
    domHoldBoost
  };
}

// ✅ 3TF(정밀) 합의: 분석 버튼/추천 클릭에서 사용
function consensus3TF(cores){
  // cores: { "60": core, "240": core, "D": core }
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

  // 합의 점수(3표 중 같은 방향 개수)
  let agree = 0;
  for(const v of votes){
    if(v === type) agree++;
  }

  // 합의 부족이면 edge를 살짝 깎아서 HOLD로 더 잘 가게 만들기(꼼수X)
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

// ✅ 2TF(속도) 합의: 스캔/백테스트에서 사용
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

  // 2TF가 서로 반대면 edge를 살짝 깎기
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

// ✅ “합의 기반 최종 포지션” 만들기
function buildSignalFromCandles_MTF(symbol, baseTfRaw, candlesByTf, mode="3TF"){
  const baseCandles = candlesByTf[baseTfRaw];
  const base = computeSignalCore(symbol, baseTfRaw, baseCandles);

  // TP/SL은 “기준 TF”로 잡는다 (기간/목표가가 일관돼야 실전 운영이 쉬움)
  const entry = base.entry;

  const atrMin = entry * (ATR_MIN_PCT / 100);
  const atrUsed = Math.max(base.atrRaw, atrMin);

  const tfMult = TF_MULT[baseTfRaw] || 1.2;
  let tpDistBase = atrUsed * tfMult;

  // ---- MTF 합의 확률 만들기 ----
  let con = null;
  let mtfExplain = null;

  if(mode === "3TF"){
    const cores = {};
    for(const tfRaw of getMTFSet3()){
      const candles = candlesByTf[tfRaw];
      if(!candles || candles.length < (SIM_WINDOW + FUTURE_H + 80)) continue;
      cores[tfRaw] = computeSignalCore(symbol, tfRaw, candles);
    }
    // 누락 방지: 최소 2개라도 있으면 합의
    const have = Object.keys(cores).length;
    if(have >= 2){
      // 3개 다 있으면 3TF, 아니면 2TF로 다운그레이드
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
      // fallback: base 단일
      con = {
        longP: base.longP, shortP: base.shortP,
        type: base.type, winProb: base.winProb, edge: base.edge,
        simAvg: base.simAvg, simCount: base.simCount,
        agree: 1, votes: [base.type]
      };
      mtfExplain = { [baseTfRaw]: base };
    }
  }else{
    // 2TF 모드(속도)
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

  // 최종 방향/확률은 “합의 결과”를 따른다
  const type = con.type;
  const winProb = con.winProb;
  const edge = con.edge;

  // ✅ 근본 2) 최근 성과로 winProb 소폭 보정
  const recent = getRecentWinRate(symbol, baseTfRaw, RECENT_CALIB_N);
  const winProbAdj = clamp((1 - RECENT_CALIB_ALPHA) * winProb + RECENT_CALIB_ALPHA * recent, 0.5, 0.99);

  // ✅ UPGRADE ②: 확신도 기반 TP/SL 조정 적용(여기서 TP거리/RR이 바뀜)
  const adj = applyConfidenceTpSl(tpDistBase, winProbAdj, edge);
  const tpDist = adj.tpDist;
  const rrUsed = adj.rr;

  const slDist = tpDist / Math.max(rrUsed, 1.01);

  let tp = (type === "LONG") ? (entry + tpDist) : (entry - tpDist);
  let sl = (type === "LONG") ? (entry - slDist) : (entry + slDist);

  let tpPct = Math.abs((tp - entry) / entry) * 100;
  let slPct = Math.abs((sl - entry) / entry) * 100;

  if(tpPct > TP_MAX_PCT){
    tpPct = TP_MAX_PCT;
    const newTpDist = entry * (tpPct/100);
    tp = (type === "LONG") ? (entry + newTpDist) : (entry - newTpDist);
    // RR 유지
    sl = (type === "LONG") ? (entry - (newTpDist/Math.max(rrUsed, 1.01))) : (entry + (newTpDist/Math.max(rrUsed, 1.01)));
    slPct = Math.abs((sl - entry) / entry) * 100;
  }

  // ---- HOLD 규칙(기존 + MTF 합의 + 근본필터) ----
  const holdReasons = [];
  if(con.simCount < HOLD_MIN_TOPK) holdReasons.push(`유사패턴 표본 부족(${con.simCount}개)`);
  if(con.simAvg < HOLD_MIN_SIM_AVG) holdReasons.push(`유사도 평균 낮음(${con.simAvg.toFixed(1)}%)`);
  if(edge < HOLD_MIN_EDGE) holdReasons.push(`롱/숏 차이 작음(엣지 ${(edge*100).toFixed(1)}%)`);
  if(tpPct < HOLD_MIN_TP_PCT) holdReasons.push(`목표수익 너무 작음(+${tpPct.toFixed(2)}%)`);

  // ✅ MTF 합의 부족은 HOLD로 더 잘 보내 승률을 지킴(꼼수X)
  const mtfVotes = (con.votes || []).join("/");
  if(con.votes && con.votes.length >= 2){
    const agreeNeed = (con.votes.length === 3) ? MTF_MIN_AGREE : 2;
    if(con.agree < agreeNeed){
      holdReasons.push(`타임프레임 합의 부족(${mtfVotes})`);
    }
  }

  // ✅ 근본 1) 레짐(추세강도) 필터: 추세 약하면 HOLD
  const minStrength = REGIME_MIN_STRENGTH_BY_TF[baseTfRaw] ?? 0.5;
  const ts = base.trendStrength ?? 0;
  if(ts < minStrength){
    holdReasons.push(`추세 약함(강도 ${ts.toFixed(2)} < ${minStrength.toFixed(2)})`);
  }

  // ✅ 근본 3) 변동성 위험 필터: ATR%가 너무 크면 HOLD
  const maxAtrPct = VOL_MAX_ATR_PCT_BY_TF[baseTfRaw] ?? 3.0;
  const ap = base.atrPct ?? 0;
  if(ap > maxAtrPct){
    holdReasons.push(`급변동 위험(ATR ${ap.toFixed(2)}% > ${maxAtrPct.toFixed(2)}%)`);
  }

  // 기존 도미넌스/거래량 보수성 (base 기준)
  if(base.domHoldBoost >= 2 && symbol !== "BTCUSDT") holdReasons.push(`BTC 도미넌스 환경이 알트에 불리(보수적)`);
  if(base.volTrend < -0.25) holdReasons.push(`거래량 흐름 약함(신뢰↓)`);

  const isHold = holdReasons.length > 0;

  return {
    id: Date.now(),
    symbol,
    tf: baseTfRaw === "60" ? "1H" : baseTfRaw === "240" ? "4H" : "1D",
    tfRaw: baseTfRaw,
    type: isHold ? "HOLD" : type,
    entry,
    tp: isHold ? null : tp,
    sl: isHold ? null : sl,
    tpPct: isHold ? null : tpPct,
    slPct: isHold ? null : slPct,
    createdAt: Date.now(),
    explain: {
      // 최종(합의) 값
      winProb: winProbAdj,      // ✅ 보정된 확률로 기록
      winProbRaw: winProb,      // ✅ 원본도 같이 남김(투명)
      recentWinRate: recent,    // ✅ 최근 성과
      longP: con.longP,
      shortP: con.shortP,
      edge,
      simAvg: con.simAvg,
      simCount: con.simCount,

      // base 지표(설명용)
      rsi: base.rsi,
      macdHist: base.macdHist,
      atr: atrUsed,
      atrPct: base.atrPct,              // ✅ 변동성 지표
      volTrend: base.volTrend,
      ema20: base.ema20,
      ema50: base.ema50,
      trend: base.trend,
      trendStrength: base.trendStrength, // ✅ 레짐 지표
      btcDom: base.btcDom,
      btcDomUp: base.btcDomUp,

      // ✅ UPGRADE ②: 조정 정보 기록(투명)
      conf: {
        tier: adj.tier,
        rrUsed,
        tpScale: (CONF_TP_SCALE[adj.tier] ?? 1.0),
      },

      // MTF 설명
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

      holdReasons
    }
  };
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

  // ✅ PATCH
  ensureToastUI();

  // ✅ FIX: 기존 activePositions expiryAt 보정 + ✅ MFE 마이그레이션
  ensureExpiryOnAllPositions();

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

  // ✅ PATCH: 남은시간 텍스트만 부분 업데이트 + ✅ UPGRADE ③: TIME 종료 처리
  setInterval(() => {
    if(!state.activePositions?.length) return;
    updateCountdownTexts();
    settleExpiredPositions(); // ✅ TIME 종료 + MFE 보정
  }, 1000);
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
      toast("이미 같은 코인/같은 기간의 추적 포지션이 있습니다. (중복 방지)", "warn");
      return;
    }
    if(isInCooldown(dupKey)){
      toast("너무 자주 신호를 내면 승률이 내려갈 수 있어요. 지금은 쿨다운입니다.", "warn");
      return;
    }

    // ✅ MTF(정밀): 1H+4H+1D 모두 가져와 합의
    const tfSet = getMTFSet3();
    const candlesByTf = {};
    for(const tfRaw of tfSet){
      const candles = await fetchCandles(state.symbol, tfRaw, EXTENDED_LIMIT);
      candlesByTf[tfRaw] = candles;
    }

    // 기준 TF는 “지금 선택한 TF”
    const baseTf = state.tf;
    const baseCandles = candlesByTf[baseTf] || [];
    if(baseCandles.length < (SIM_WINDOW + FUTURE_H + 80)) throw new Error("캔들 데이터가 부족합니다.");

    const pos = buildSignalFromCandles_MTF(state.symbol, baseTf, candlesByTf, "3TF");
    state.lastSignalAt[dupKey] = Date.now();
    saveState();

    showResultModal(pos);
  }catch(e){
    console.error(e);
    toast("분석 중 오류가 발생했습니다. (API 지연/제한 가능)", "danger");
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

    if(hasActivePosition(symbol, tfRaw)){
      toast("이미 같은 코인/같은 기간의 추적 포지션이 있습니다. (중복 방지)", "warn");
      return;
    }

    // ✅ MTF(정밀): 추천 클릭도 3TF 합의
    const tfSet = getMTFSet3();
    const candlesByTf = {};
    for(const t of tfSet){
      const candles = await fetchCandles(symbol, t, EXTENDED_LIMIT);
      candlesByTf[t] = candles;
    }

    const baseCandles = candlesByTf[tfRaw] || [];
    if(baseCandles.length < (SIM_WINDOW + FUTURE_H + 80)) throw new Error("캔들 데이터가 부족합니다.");

    const pos = buildSignalFromCandles_MTF(symbol, tfRaw, candlesByTf, "3TF");
    showResultModal(pos);
  }catch(e){
    console.error(e);
    toast("추천 분석 중 오류가 발생했습니다.", "danger");
  }
}

// (기존 함수명 유지용: 내부는 MTF로 대체)
function buildSignalFromCandles(symbol, tf, candles){
  const byTf = { [tf]: candles };
  return buildSignalFromCandles_MTF(symbol, tf, byTf, "2TF");
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

  const mtf = ex.mtf;
  const mtfLine = mtf
    ? `MTF 합의: ${mtf.agree}/${(mtf.votes||[]).length} (${(mtf.votes||[]).join("/")})`
    : `MTF 합의: -`;

  const confLine = ex.conf
    ? `확신도: ${ex.conf.tier} (RR ${ex.conf.rrUsed.toFixed(2)}, TP×${(ex.conf.tpScale||1).toFixed(2)})`
    : `확신도: -`;

  // ✅ 근본 보정 정보(짧게)
  const calibLine = `최근승률 ${(ex.recentWinRate*100).toFixed(0)}% → winProb ${(ex.winProb*100).toFixed(1)}% (α ${RECENT_CALIB_ALPHA})`;
  const regimeLine = `추세강도 ${Number(ex.trendStrength||0).toFixed(2)} / ATR ${Number(ex.atrPct||0).toFixed(2)}%`;

  if(isHold){
    grid.innerHTML = `
      <div class="mini-box"><small>판정</small><div>이번에는 예측 안 함</div></div>
      <div class="mini-box"><small>MTF</small><div>${mtfLine}</div></div>
      <div class="mini-box"><small>유사도 평균</small><div>${ex.simAvg.toFixed(1)}%</div></div>
      <div class="mini-box"><small>표본 수</small><div>${ex.simCount}개</div></div>
    `;
    const reasons = ex.holdReasons.map(r => `- ${r}`).join("<br/>");
    content.innerHTML = `
      <b>이번에는 “보류”가 더 안전해요.</b><br/>
      ${reasons}<br/><br/>
      <b>추가 정보:</b><br/>
      - ${calibLine}<br/>
      - ${regimeLine}<br/><br/>
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
      - ${mtfLine}<br/>
      - ${confLine}<br/>
      - ${calibLine}<br/>
      - ${regimeLine}<br/>
      - 유사패턴 ${ex.simCount}개 · 평균 유사도 ${ex.simAvg.toFixed(1)}%<br/>
      - RSI ${ex.rsi.toFixed(1)} · MACD ${ex.macdHist.toFixed(4)}<br/>
      - 추세(EMA20/EMA50) ${ex.ema20 >= ex.ema50 ? "상승 우위" : "하락 우위"}<br/>
      - 거래량 흐름 ${ex.volTrend >= 0 ? "증가" : "감소"} · 엣지 ${(ex.edge*100).toFixed(1)}%<br/>
      - ${domMsg}<br/><br/>
      <b>정리:</b> 여러 기간(1H/4H/1D)이 같은 방향이면 더 믿을만해서, ${pos.type}로 제안합니다.
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
    toast("이미 같은 코인/같은 기간의 추적 포지션이 있습니다.", "warn");
    return;
  }

  // ✅ FIX: expiryAt = 전략 자체 시간(1H/4H/1D)
  const createdAt = Date.now();
  const expiryAt = createdAt + tfToMs(tempPos.tfRaw);

  state.activePositions.unshift({
    ...tempPos,
    status: "ACTIVE",
    lastPrice: tempPos.entry,
    pnl: 0,
    mfePct: 0,
    createdAt,
    expiryAt
  });
  saveState();
  closeModal();
  renderTrackingList();
  updateStatsUI();
  updateCountdownTexts(); // ✅ 즉시 1회 반영
}

// ---------- Tracking ----------
function trackPositions(symbol, currentPrice){
  let changed = false;

  for(let i = state.activePositions.length - 1; i >= 0; i--){
    const pos = state.activePositions[i];
    if(pos.symbol !== symbol) continue;

    pos.lastPrice = currentPrice;

    // pnl (NET: 비용 반영)
    let pnlGross = 0;
    if(pos.type === "LONG"){
      pnlGross = ((currentPrice - pos.entry) / pos.entry) * 100;
    }else{
      pnlGross = ((pos.entry - currentPrice) / pos.entry) * 100;
    }
    const pnl = pnlGross - FEE_PCT;
    pos.pnl = pnl;

    // ✅ UPGRADE ③: MFE 업데이트(중간에 얼마나 “유리하게” 갔는지) (GROSS 기준으로 추적이 자연스러움)
    const favorable = (pos.type === "LONG")
      ? ((currentPrice - pos.entry) / pos.entry) * 100
      : ((pos.entry - currentPrice) / pos.entry) * 100;

    if(Number.isFinite(favorable)){
      if(typeof pos.mfePct !== "number") pos.mfePct = 0;
      if(favorable > pos.mfePct) pos.mfePct = favorable;
    }

    // ✅ 근본 4) 브레이크이븐 + 트레일링 SL (승률 체감↑)
    if(Number.isFinite(pos.mfePct) && pos.status === "ACTIVE"){
      // 브레이크이븐 보호
      if(pos.mfePct >= BE_TRIGGER_PCT){
        if(pos.type === "LONG"){
          const beSL = pos.entry * (1 + (BE_OFFSET_PCT/100));
          if(typeof pos.sl !== "number" || !Number.isFinite(pos.sl)) pos.sl = pos.entry;
          if(pos.sl < beSL) pos.sl = beSL;
        }else{
          const beSL = pos.entry * (1 - (BE_OFFSET_PCT/100));
          if(typeof pos.sl !== "number" || !Number.isFinite(pos.sl)) pos.sl = pos.entry;
          if(pos.sl > beSL) pos.sl = beSL;
        }
      }

      // 트레일링
      if(pos.mfePct >= TRAIL_START_PCT){
        if(pos.type === "LONG"){
          const trailSL = pos.entry * (1 + ((pos.mfePct - TRAIL_GAP_PCT)/100));
          if(pos.sl < trailSL) pos.sl = trailSL;
        }else{
          const trailSL = pos.entry * (1 - ((pos.mfePct - TRAIL_GAP_PCT)/100));
          if(pos.sl > trailSL) pos.sl = trailSL;
        }
      }
    }

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

      // ✅ 종료 pnl은 "exitPrice 기준 NET"으로 확정 기록(중복 차감 없음)
      let pnlExitGross = 0;
      const px = (exitPrice ?? currentPrice);
      if(pos.type === "LONG"){
        pnlExitGross = ((px - pos.entry) / pos.entry) * 100;
      }else{
        pnlExitGross = ((pos.entry - px) / pos.entry) * 100;
      }
      const pnlExit = pnlExitGross - FEE_PCT;

      const record = {
        id: Date.now(),
        symbol: pos.symbol,
        tf: pos.tf,
        tfRaw: pos.tfRaw,
        type: pos.type,
        entry: pos.entry,
        exit: px,
        pnlPct: pnlExit, // ✅ NET
        mfePct: (typeof pos.mfePct === "number") ? pos.mfePct : 0,
        win,
        reason: exitReason,
        closedAt: Date.now()
      };
      state.closedTrades.unshift(record);
      state.closedTrades = state.closedTrades.slice(0, 30);

      state.activePositions.splice(i, 1);
      saveState();
      changed = true;

      toast(
        `[${pos.symbol} ${pos.tf}] 종료: ${win ? "성공" : "실패"} (${exitReason}) / 수익률 ${pnlExit.toFixed(2)}% / MFE ${record.mfePct.toFixed(2)}% (비용 -${FEE_PCT.toFixed(2)}%)`,
        win ? "success" : "danger"
      );
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

  ensureExpiryOnAllPositions();

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
    const tpPct = Number.isFinite(pos.tpPct) ? pos.tpPct : null;
    const slPct = Number.isFinite(pos.slPct) ? pos.slPct : null;

    const expiryAt = pos.expiryAt || getPosExpiryAt(pos);
    const remainMs = expiryAt - Date.now();
    const remainText = formatRemain(remainMs);

    const mtf = ex.mtf;
    const mtfMini = mtf
      ? `MTF ${mtf.agree}/${(mtf.votes||[]).length}(${(mtf.votes||[]).join("/")})`
      : `MTF -`;

    const confMini = ex.conf
      ? `CONF ${ex.conf.tier}(RR ${Number(ex.conf.rrUsed||RR).toFixed(2)})`
      : `CONF -`;

    const mfeMini = `MFE ${(typeof pos.mfePct === "number" ? pos.mfePct : 0).toFixed(2)}%`;

    const regimeMini = (typeof ex.trendStrength === "number")
      ? `TS ${ex.trendStrength.toFixed(2)}`
      : `TS -`;
    const volMini = (typeof ex.atrPct === "number")
      ? `ATR ${ex.atrPct.toFixed(2)}%`
      : `ATR -`;

    const explainLine =
      `남은시간 <b id="remain-${pos.id}">${remainText}</b> · ${mtfMini} · ${confMini} · ${mfeMini} · ${regimeMini} · ${volMini} · 유사패턴 ${ex.simCount ?? "-"}개 · 유사도 ${(ex.simAvg ?? 0).toFixed ? ex.simAvg.toFixed(1) : "-"}% · RSI ${(ex.rsi ?? 0).toFixed ? ex.rsi.toFixed(1) : "-"} · 엣지 ${((ex.edge ?? 0)*100).toFixed ? ((ex.edge ?? 0)*100).toFixed(1) : "-"}%`;

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
              <span style="color:${color}">수익률 ${pos.pnl.toFixed(2)}% <span style="color:var(--text-sub); font-weight:900;">(비용 반영)</span></span>
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

  updateCountdownTexts();
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
    const mfeTxt = (typeof x.mfePct === "number") ? ` · MFE ${x.mfePct.toFixed(2)}%` : "";
    return `
      <div class="history-item">
        <div class="left">
          ${badge}
          <span>${x.symbol.replace("USDT","")} ${x.tf}</span>
          <span style="color:var(--text-sub); font-weight:950;">(${x.reason}${mfeTxt})</span>
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

    // ✅ 스캔은 “속도”가 중요: 2TF 합의로 실행
    const tfSet = getMTFSet2(state.tf);
    const baseTf = tfSet[0];
    const otherTf = tfSet[1];

    for(let i=0;i<state.universe.length;i++){
      const coin = state.universe[i];
      status.textContent = `스캔 중... (${i+1}/${state.universe.length})`;

      try{
        const cBase = await fetchCandles(coin.s, baseTf, 380);
        if(cBase.length < (SIM_WINDOW + FUTURE_H + 80)) continue;

        const candlesByTf = { [baseTf]: cBase };

        // otherTf는 “가능하면”만 (API 제한/속도 고려)
        try{
          const cOther = await fetchCandles(coin.s, otherTf, 380);
          candlesByTf[otherTf] = cOther;
        }catch(e){}

        const pos = buildSignalFromCandles_MTF(coin.s, baseTf, candlesByTf, "2TF");
        if(pos.type === "HOLD") continue;

        results.push({
          symbol: pos.symbol,
          tf: pos.tf,
          tfRaw: pos.tfRaw,
          type: pos.type,
          winProb: pos.explain.winProb,
          edge: pos.explain.edge,
          mtfAgree: pos.explain?.mtf?.agree ?? 1,
          mtfVotes: (pos.explain?.mtf?.votes || []).join("/"),
          confTier: pos.explain?.conf?.tier ?? "-"
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
    const mtf = item.mtfVotes ? ` · MTF ${item.mtfAgree}/2(${item.mtfVotes})` : "";
    const conf = item.confTier ? ` · ${item.confTier}` : "";

    return `
      <div class="rec-item" onclick="quickAnalyzeAndShow('${item.symbol}','${item.tfRaw}')">
        <div class="rec-left">
          ${item.symbol.replace("USDT","")}
          <span class="pill ${pillClass}">${item.type}</span>
        </div>
        <div class="rec-right">
          성공확률 ${prob}%<br/>
          엣지 ${edge}% · ${item.tf}${mtf}${conf}
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
    const tfSet = getMTFSet2(state.tf);
    const baseTf = tfSet[0];
    const otherTf = tfSet[1];

    const candlesBase = await fetchCandles(state.symbol, baseTf, EXTENDED_LIMIT);
    if(candlesBase.length < (SIM_WINDOW + FUTURE_H + 120)) throw new Error("캔들 데이터가 부족합니다.");

    let candlesOther = null;
    try{
      candlesOther = await fetchCandles(state.symbol, otherTf, 520);
    }catch(e){}

    let wins=0, total=0;
    let pnlSum=0;

    const end = candlesBase.length - (FUTURE_H + 20);
    const start = Math.max(SIM_WINDOW + 80, end - (BACKTEST_TRADES * 7));

    for(let idx = start; idx < end; idx += 7){
      const sliceBase = candlesBase.slice(0, idx+1);
      if(sliceBase.length < (SIM_WINDOW + FUTURE_H + 80)) continue;

      const byTf = { [baseTf]: sliceBase };

      if(Array.isArray(candlesOther) && candlesOther.length > 120){
        byTf[otherTf] = candlesOther.slice(-520);
      }

      const pos = buildSignalFromCandles_MTF(state.symbol, baseTf, byTf, "2TF");
      if(pos.type === "HOLD") continue;

      const ex = pos.explain || {};
      if((ex.winProb ?? 0) < BT_MIN_PROB) continue;
      if((ex.edge ?? 0) < BT_MIN_EDGE) continue;
      if((ex.simAvg ?? 0) < BT_MIN_SIM) continue;

      const future = candlesBase.slice(idx+1, Math.min(idx+1+140, candlesBase.length));
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

    const tfNameShow = baseTf === "60" ? "1H" : baseTf === "240" ? "4H" : "1D";
    document.getElementById("bt-range").textContent =
      `${state.symbol} · ${tfNameShow} · 최근 ${EXTENDED_LIMIT}캔들 (필터: 확률≥${Math.round(BT_MIN_PROB*100)}%, 엣지≥${Math.round(BT_MIN_EDGE*100)}%, 유사도≥${BT_MIN_SIM}%) · MTF(2TF) · CONF(TP/SL 조정) · 비용 -${FEE_PCT.toFixed(2)}% 반영`;

    box.classList.add("show");
  }catch(e){
    console.error(e);
    toast("백테스트 중 오류가 발생했습니다.", "danger");
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
        const pnl = ((pos.tp - pos.entry)/pos.entry)*100 - FEE_PCT; // ✅ 비용 반영(원천)
        return { resolved:true, win:true, pnlPct:pnl };
      }
      if(lo <= pos.sl){
        const pnl = ((pos.sl - pos.entry)/pos.entry)*100 - FEE_PCT;
        return { resolved:true, win:false, pnlPct:pnl };
      }
    }else{
      if(lo <= pos.tp){
        const pnl = ((pos.entry - pos.tp)/pos.entry)*100 - FEE_PCT;
        return { resolved:true, win:true, pnlPct:pnl };
      }
      if(hi >= pos.sl){
        const pnl = ((pos.entry - pos.sl)/pos.entry)*100 - FEE_PCT;
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
// ✅ 근본 2) 최근가중 유사도 + 가중 확률
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

  // 라플라스 스무딩
  const longProb = (wUp + 1) / (wSum + 2);
  const shortProb = (wDown + 1) / (wSum + 2);

  // 가중 평균 유사도
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
