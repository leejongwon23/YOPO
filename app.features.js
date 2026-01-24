/*************************************************************
 * YOPO AI PRO — app.features.js (분할 v1)
 * 역할: 화면/동작 전부(부트, 차트, 렌더, 분석/스캔/백테스트, 추적/만료, 모달)
 * 의존:
 * - app.core.js: state, tempPos, 유틸/신호코어/토스트/저장/마이그레이션 등
 * - app.api.js : refreshUniverseAndGlobals, marketTick, fetchCandles 등
 *
 * ✅ 중요:
 * - index.html onclick과 호환되도록 마지막에 window.xxx 바인딩을 한다.
 * - setTF는 btn이 없어도 안전하게 동작하도록 보강했다. (호환용)
 *************************************************************/

/* ==========================================================
   ✅ OPERATION CANCEL ENGINE (NEW)
   - 분석/스캔/백테스트 "진행중 취소"를 위한 공통 엔진
   - index.html 에서 버튼으로 window.cancelOperation() 호출하면 됨
   ========================================================== */
const __op = {
  running: false,
  kind: null,          // "ANALYSIS" | "SCAN" | "BACKTEST" | ...
  token: 0,
  canceled: false
};

function beginOperation(kind){
  __op.token++;
  __op.running = true;
  __op.kind = kind || "OP";
  __op.canceled = false;
  return __op.token;
}

/* ✅ FIX: 취소 버튼 누를 때 UX + 안전(작업 없어도 안내) */
function cancelOperation(){
  // 작업이 없어도 UX상 안내는 해주는게 좋음
  if(!__op.running){
    try{ toast("진행중인 작업이 없습니다.", "warn"); }catch(e){}
    return;
  }
  __op.canceled = true;
  try{ toast("진행 취소 요청 완료(다음 단계부터 중단).", "warn"); }catch(e){}
}

function endOperation(token){
  // 토큰이 다르면(새 작업 시작됨) 종료시키지 않음
  if(token !== __op.token) return;
  __op.running = false;
  __op.kind = null;
  __op.canceled = false;
}

function checkCanceled(token){
  if(token !== __op.token) throw new Error("CANCELLED");
  if(__op.canceled) throw new Error("CANCELLED");
}

function sleepCancelable(ms, token){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>resolve(), ms);
    const tick = () => {
      try{
        checkCanceled(token);
        setTimeout(tick, 80);
      }catch(e){
        clearTimeout(t);
        reject(e);
      }
    };
    setTimeout(tick, 0);
  });
}

/* ==========================================================
   ✅ SAFETY: formatMoney 폴백 (부트 중 renderUniverseList가 터지면
   setInterval이 아예 안 걸려서 "정산/통계/추적 갱신 멈춤" 현상이 생김)
   ========================================================== */
function formatMoney(n){
  const v = Number(n);
  if(!Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if(abs >= 1e12) return (v/1e12).toFixed(2) + "T";
  if(abs >= 1e9)  return (v/1e9).toFixed(2)  + "B";
  if(abs >= 1e6)  return (v/1e6).toFixed(2)  + "M";
  if(abs >= 1e3)  return (v/1e3).toFixed(2)  + "K";
  return v.toFixed(0);
}

/* ==========================================================
   ✅ RUNTIME SAFETY (핵심)
   ========================================================== */
function ensureRuntimeState(){
  if(typeof state !== "object" || !state) return;

  if(!Array.isArray(state.activePositions)) state.activePositions = [];
  if(!Array.isArray(state.closedTrades)) state.closedTrades = [];

  if(typeof state.history !== "object" || !state.history){
    state.history = { total: 0, win: 0 };
  }

  if(!Number.isFinite(state.history.total)) state.history.total = 0;
  if(!Number.isFinite(state.history.win)) state.history.win = 0;

  if(!Array.isArray(state.universe)) state.universe = [];
  if(typeof state.lastPrices !== "object" || !state.lastPrices) state.lastPrices = {};
}

// ✅ 초기화/리셋/전체취소는 별도 비밀번호(2580) 재확인
function requirePin(actionLabel){
  const v = (window.prompt || (()=>null))(`${actionLabel}\n비밀번호(2580)를 입력하세요.`);
  if(String(v || "") === String(AUTH_PASSWORD)) return true;
  toast("비밀번호가 틀렸습니다.", "danger");
  return false;
}

/* ==========================================================
   ✅ NEW: 운영 버튼 기능 (누적 리셋 / 추적 전체취소 / 전체 초기화)
   ========================================================== */
function resetStatsUIAndData(){
  ensureRuntimeState();

  if(!requirePin("누적 리셋")) return;

  state.history = { total: 0, win: 0 };
  state.closedTrades = [];

  // 스캔 결과는 유지하고 싶으면 아래 2줄 지워도 됨
  // state.lastScanResults = [];
  // state.lastScanAt = 0;

  saveState();

  try{ renderClosedTrades(); }catch(e){}
  try{ updateStatsUI(); }catch(e){}

  toast("누적(분석/성공률)과 종료 기록을 리셋했습니다.", "success");
}

function cancelAllTracking(){
  ensureRuntimeState();

  if(!requirePin("추적 전체 취소")) return;

  const n = (state.activePositions || []).length;
  state.activePositions = [];

  saveState();

  try{ renderTrackingList(); }catch(e){}
  try{ updateStatsUI(); }catch(e){}
  try{ updateStrategyCountUI(); }catch(e){}
  try{ updateCountdownTexts(); }catch(e){}

  toast(`추적 포지션 ${n}개를 전체 취소했습니다.`, "warn");
}

function resetAll(){
  ensureRuntimeState();

  if(!requirePin("전체 초기화")) return;

  // 진행중 작업 취소
  try{ cancelOperation(); }catch(e){}

  // 모달 닫기 + 멀티 상태 초기화
  try{ closeModal(); }catch(e){}
  try{ closeScanModal && closeScanModal(); }catch(e){}
  try{ closeBacktestModal && closeBacktestModal(); }catch(e){}

  // 누적/추적/스캔/쿨다운까지 싹 초기화
  state.history = { total: 0, win: 0 };
  state.closedTrades = [];
  state.activePositions = [];

  state.lastSignalAt = {};
  state.lastScanResults = [];
  state.lastScanFullList = [];
  state.lastScanFullMap = {};
  state.lastScanAt = 0;

  state.lastBacktestSummary = null;
  state.lastBacktestRows = [];
  state.lastBacktestAt = 0;

  saveState();

  try{ renderTrackingList(); }catch(e){}
  try{ renderClosedTrades(); }catch(e){}
  try{ renderScanResults(); }catch(e){}
  try{ updateStatsUI(); }catch(e){}

  toast("전체 초기화 완료 (누적 + 추적 + 진행취소 + 추천 초기화)", "success");
}

/* ==========================================================
   ✅ BUGFIX HELPERS
   ========================================================== */
function genPosId(){
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ensurePosId(pos){
  if(!pos) return pos;
  if(!pos.id || typeof pos.id !== "string" || !pos.id.trim()){
    pos.id = genPosId();
  }
  return pos;
}

function ensureIdsOnAllPositions(){
  if(!state) return;
  if(Array.isArray(state.activePositions)){
    for(const p of state.activePositions) ensurePosId(p);
  }
  if(Array.isArray(state.closedTrades)){
    for(const r of state.closedTrades){
      if(!r.id) r.id = Date.now() + Math.floor(Math.random() * 1000);
    }
  }
}

/* ==========================================================
   ✅ NEW (예측 줄이지 않기용)
   ========================================================== */
function isPatternBlockedHold(pos){
  if(!pos || pos.type !== "HOLD") return false;
  const reasons = pos?.explain?.holdReasons || [];
  const text = reasons.map(x=>String(x)).join(" | ");
  return (
    text.includes("실패패턴") ||
    text.includes("패턴 감점 적용") ||
    text.includes("강제 HOLD")
  );
}

function buildForcedTrackFromHold(pos){
  if(!pos || pos.type !== "HOLD") return null;

  const ex = pos.explain || {};
  const symbol = pos.symbol;
  const tfRaw = pos.tfRaw;

  const longP = Number(ex.longP ?? 0.5);
  const shortP = Number(ex.shortP ?? 0.5);
  const inferredType = (longP >= shortP) ? "LONG" : "SHORT";

  const entry = Number.isFinite(pos.entry) ? pos.entry : null;
  if(!Number.isFinite(entry) || entry <= 0) return null;

  const TF_MULT_SAFE = (typeof TF_MULT === "object" && TF_MULT) ? TF_MULT : { "60":1.0, "240":1.15, "D":1.3 };
  const RR_SAFE = (typeof RR === "number" && Number.isFinite(RR)) ? RR : 1.6;
  const TP_MAX_PCT_SAFE = (typeof TP_MAX_PCT === "number" && Number.isFinite(TP_MAX_PCT)) ? TP_MAX_PCT : 6.0;

  const atrUsed = Number(ex.atr ?? 0);
  const tfMult = TF_MULT_SAFE[tfRaw] || 1.2;

  const tpScale = Number(ex?.conf?.tpScale ?? 1.0);
  const rrUsed = Number(ex?.conf?.rrUsed ?? RR_SAFE);

  let tpDist = atrUsed * tfMult * tpScale;
  if(!Number.isFinite(tpDist) || tpDist <= 0){
    return null;
  }

  let tp = (inferredType === "LONG") ? (entry + tpDist) : (entry - tpDist);
  let tpPct = Math.abs((tp - entry) / entry) * 100;

  if(tpPct > TP_MAX_PCT_SAFE){
    tpPct = TP_MAX_PCT_SAFE;
    const newTpDist = entry * (tpPct / 100);
    tpDist = newTpDist;
    tp = (inferredType === "LONG") ? (entry + newTpDist) : (entry - newTpDist);
  }

  const slDist = tpDist / Math.max(rrUsed, 1.01);
  let sl = (inferredType === "LONG") ? (entry - slDist) : (entry + slDist);
  let slPct = Math.abs((sl - entry) / entry) * 100;

  let sig = null;
  try{
    if(typeof buildPatternSignature === "function"){
      sig = buildPatternSignature(symbol, tfRaw, inferredType, ex);
    }
  }catch(e){}

  ensurePosId(pos);

  return {
    ...pos,
    type: inferredType,
    tp,
    sl,
    tpPct,
    slPct,
    sig,
    _forceTrack: true,
    _forceReason: "PATTERN_BLOCK_OVERRIDE"
  };
}

function computeScanScore(item){
  const w = Number(item.winProb ?? 0);
  const e = Number(item.edge ?? 0);
  const s = Number(item.simAvg ?? 0) / 100;
  const atr = Number(item.atrPct ?? 0);
  const adx = Number(item.adx ?? 0);
  const adxN = clamp((adx - 15) / 25, 0, 1);
  const srP = Number(item.srPenalty ?? 0); // 0~1 (클수록 불리)
  const penalty = item.isRisk ? 0.06 : 0.0;
  return (w * 1.05) + (e * 0.75) + (s * 0.45) + (adxN * 0.25) - (atr * 0.12) - (srP * 0.45) - penalty;
}

/* ==========================================================
   ✅ MULTI (6전략 통합 예측) 상태
   ========================================================== */
let tempMulti = null;          // { "15":pos, "30":pos, "60":pos, "240":pos, "D":pos, "W":pos }
let selectedMultiPos = null;   // 선택된 pos(또는 forcedPos)

/* ==========================================================
   PATCH HELPERS (전략별 카운트 UI)
   ========================================================== */
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

  let c15=0, c30=0, c60 = 0, c240 = 0, cD = 0, cW=0;
  for(const p of (state.activePositions || [])){
    if(p.tfRaw === "15") c15++;
    else if(p.tfRaw === "30") c30++;
    else if(p.tfRaw === "60") c60++;
    else if(p.tfRaw === "240") c240++;
    else if(p.tfRaw === "W") cW++;
    else cD++;
  }

  el.innerHTML = `
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">15m ${c15}</span>
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">30m ${c30}</span>
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">1H ${c60}</span>
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">4H ${c240}</span>
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">1D ${cD}</span>
    <span style="background:var(--secondary); border:1px solid var(--border); padding:4px 8px; border-radius:999px;">1W ${cW}</span>
  `;
}

/* ==========================================================
   COUNTDOWN 부분 업데이트 + 만료 정산
   ========================================================== */
function updateCountdownTexts(){
  ensureRuntimeState();

  const list = state.activePositions || [];
  if(!list.length) return;

  for(const pos of list){
    ensurePosId(pos);

    const el = document.getElementById(`remain-${pos.id}`);
    if(!el) continue;

    const expiryAt = pos.expiryAt || getPosExpiryAt(pos);
    const remainMs = expiryAt - Date.now();
    el.textContent = formatRemain(remainMs);
  }
}

/* ==========================================================
   TIME 만료 정산 (MFE 반영) + 비용 반영
   ========================================================== */
function settleExpiredPositions(){
  ensureRuntimeState();

  const list = state.activePositions || [];
  if(!list.length) return false;

  const now = Date.now();
  let changed = false;

  const DRIFT_MS = 500;

  const FEE_SAFE = (typeof FEE_PCT === "number" && Number.isFinite(FEE_PCT)) ? FEE_PCT : 0;
  const TIME_MFE_MIN_SAFE = (typeof TIME_MFE_MIN_PCT === "number" && Number.isFinite(TIME_MFE_MIN_PCT)) ? TIME_MFE_MIN_PCT : 0;
  const TIME_MFE_RATIO_SAFE = (typeof TIME_MFE_TP_RATIO === "number" && Number.isFinite(TIME_MFE_TP_RATIO)) ? TIME_MFE_TP_RATIO : 0;

  for(let i = list.length - 1; i >= 0; i--){
    const pos = list[i];
    ensurePosId(pos);

    const expiryAt = pos.expiryAt || getPosExpiryAt(pos);

    if(Number.isFinite(expiryAt)){
      if(now < (expiryAt - DRIFT_MS)) continue;
    }

    const lastPrice = Number.isFinite(pos.lastPrice) ? pos.lastPrice : pos.entry;

    let pnlGross = 0;
    if(pos.type === "LONG"){
      pnlGross = ((lastPrice - pos.entry) / pos.entry) * 100;
    }else{
      pnlGross = ((pos.entry - lastPrice) / pos.entry) * 100;
    }
    const pnl = pnlGross - FEE_SAFE;
    pos.pnl = pnl;

    const mfe = (typeof pos.mfePct === "number") ? pos.mfePct : 0;
    const tpPct = Number.isFinite(pos.tpPct) ? pos.tpPct : null;

    let win = false;
    let reason = "TIME";

    if(pnl > 0){
      win = true;
      reason = "TIME";
    }else{
      const needByTp = (tpPct !== null) ? (tpPct * TIME_MFE_RATIO_SAFE) : TIME_MFE_MIN_SAFE;
      const need = Math.max(TIME_MFE_MIN_SAFE, needByTp);
      if(mfe >= need){
        win = true;
        reason = "TIME_MFE";
      }else{
        win = false;
        reason = "TIME";
      }
    }

    try{ recordTradeToPatternDB(pos, win); }catch(e){}

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
      pnlPct: pnl,
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

    toast(
      `[${pos.symbol} ${pos.tf}] 시간 종료: ${win ? "성공" : "실패"} (${reason}) / 수익률 ${pnl.toFixed(2)}%${extra} (비용 -${FEE_SAFE.toFixed(2)}%)`,
      win ? "success" : "danger"
    );
  }

  if(changed){
    saveState();
    renderTrackingList();
    renderClosedTrades();
    updateStatsUI();
    updateStrategyCountUI();
    updateCountdownTexts();
  }

  return changed;
}

/* ==========================================================
   Boot
   ========================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  ensureRuntimeState();

  if(!state.lastSignalAt || typeof state.lastSignalAt !== "object"){
    state.lastSignalAt = {};
  }

  try{
    if(!isAuthed()) showAuth();
    else hideAuth();
    document.getElementById("auth-input")?.addEventListener("keydown", (e)=>{
      if(e.key === "Enter") tryAuth();
    });
  }catch(e){}

  try{ ensureToastUI(); }catch(e){}

  try{ ensureExpiryOnAllPositions(); }catch(e){}
  try{ ensureIdsOnAllPositions(); saveState(); }catch(e){}

  try{ initChart(); }catch(e){}
  try{ renderUniverseList(); }catch(e){ console.error("renderUniverseList boot error:", e); }
  try{ renderTrackingList(); }catch(e){}
  try{ renderClosedTrades(); }catch(e){}
  try{ updateStatsUI(); }catch(e){}
  try{ renderScanResults(); }catch(e){}

  try{
    ensureStrategyCountUI();
    updateStrategyCountUI();
  }catch(e){}

  try{ await refreshUniverseAndGlobals(); }catch(e){}
  try{ await marketTick(); }catch(e){}

  /* ✅ FIX: app.api.js 로드 실패/순서 꼬임으로 marketTick/refresh...가 없으면
     기존 setInterval(marketTick, ...)에서 ReferenceError로 부트가 중단되어
     "카운트다운/정산/통계" 루프가 안 걸릴 수 있음 → 반드시 가드 */
  if(typeof marketTick === "function"){
    setInterval(() => {
      try{ marketTick(); }catch(e){ console.error("marketTick interval error:", e); }
    }, 2000);
  }else{
    console.warn("marketTick() not found. (app.api.js 로드/순서 문제 가능) — 가격추적은 꺼지지만, 카운트다운/정산은 유지됩니다.");
  }

  if(typeof refreshUniverseAndGlobals === "function"){
    setInterval(() => {
      try{ refreshUniverseAndGlobals(); }catch(e){ console.error("refreshUniverseAndGlobals interval error:", e); }
    }, 60000);
  }else{
    console.warn("refreshUniverseAndGlobals() not found. (app.api.js 로드/순서 문제 가능)");
  }

  // ✅ 이 루프는 어떤 상황에서도 반드시 살아 있어야 함
  setInterval(() => {
    try{ ensureRuntimeState(); }catch(e){}
    try{ updateCountdownTexts(); }catch(e){}
    try{ settleExpiredPositions(); }catch(e){}
  }, 1000);
});

/* ==========================================================
   UI 기본 (TF/코인)
   ========================================================== */
function setTF(tf, btn){
  ensureRuntimeState();

  state.tf = tf;

  const btns = Array.from(document.querySelectorAll(".tf-btn"));
  btns.forEach(b => b.classList.remove("active"));

  if(btn && btn.classList){
    btn.classList.add("active");
  }else{
    const found = btns.find(b => String(b.dataset?.tf || "") === String(tf));
    if(found) found.classList.add("active");
  }

  saveState();
  initChart();
}

function switchCoin(symbol){
  ensureRuntimeState();

  state.symbol = symbol;
  document.querySelectorAll(".coin-row").forEach(r => r.classList.remove("active"));
  const row = document.getElementById(`row-${symbol}`);
  if(row) row.classList.add("active");
  saveState();
  initChart();
}

/* ==========================================================
   Chart
   ========================================================== */
function initChart(){
  const wrap = document.getElementById("chart-wrap");
  if(!wrap) return;

  wrap.innerHTML = "";
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

/* ==========================================================
   Universe list + price row
   ========================================================== */
function renderUniverseList(){
  ensureRuntimeState();

  const container = document.getElementById("market-list-container");
  if(!container) return;

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

    const cached = state.lastPrices?.[coin.s];
    if(cached?.price){
      updateCoinRow(coin.s, cached.price, cached.chg ?? 0, true);
    }
  });
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

/* ==========================================================
   ✅ MULTI MODAL helpers
   ========================================================== */
function _hideMultiArea(){
  const multiWrap = document.getElementById("multi-results");
  const chooseBtn = document.getElementById("multi-choose");
  const selectedEl = document.getElementById("multi-selected");
  const cards = document.getElementById("multi-cards");
  const confirmBtn = document.getElementById("modal-confirm");

  if(multiWrap) multiWrap.style.display = "none";
  if(cards) cards.innerHTML = "";
  if(selectedEl) selectedEl.textContent = "선택: 없음";
  if(chooseBtn){
    chooseBtn.disabled = true;
    chooseBtn.style.opacity = "0.65";
    chooseBtn.textContent = "선택한 전략으로 추적 등록";
  }
  if(confirmBtn) confirmBtn.style.display = "";
}

function _showMultiArea(){
  const multiWrap = document.getElementById("multi-results");
  const chooseBtn = document.getElementById("multi-choose");
  if(multiWrap) multiWrap.style.display = "block";
  if(chooseBtn){
    chooseBtn.disabled = true;
    chooseBtn.style.opacity = "0.65";
  }
  const confirmBtn = document.getElementById("modal-confirm");
  if(confirmBtn) confirmBtn.style.display = "none";
}

/* ==========================================================
   ✅ 통합 예측 (단/중/장 한번에) + 선택/등록
   ========================================================== */
async function executeAnalysisAll(){
  ensureRuntimeState();

  const opToken = beginOperation("ANALYSIS_ALL");

  const btn = document.getElementById("predict-all-btn");
  if(btn){
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 통합 예측 중...';
  }

  try{
    checkCanceled(opToken);

    const symbol = state.symbol;
    const tfSet = getMTFSet3(); // ["60","240","D"]
    const candlesByTf = {};

    for(const tfRaw of tfSet){
      checkCanceled(opToken);
      const candles = await fetchCandles(symbol, tfRaw, EXTENDED_LIMIT);
      candlesByTf[tfRaw] = candles;
    }

    // 3개 다 한 번에 계산
    const out = {};
    for(const baseTfRaw of ["60","240","D"]){
      const baseCandles = candlesByTf[baseTfRaw] || [];
      if(baseCandles.length < (SIM_WINDOW + FUTURE_H + 80)){
        out[baseTfRaw] = null;
        continue;
      }
      const pos = buildSignalFromCandles_MTF(symbol, baseTfRaw, candlesByTf, "3TF");
      out[baseTfRaw] = pos;

      // 쿨다운은 "통합 예측 실행 시점" 기준으로 동일하게 걸어둠(단일과 일관성)
      const key = `${symbol}|${baseTfRaw}`;
      state.lastSignalAt[key] = Date.now();
    }

    saveState();
    showResultModalAll(symbol, out);
  }catch(e){
    if(String(e?.message || "").includes("CANCELLED")){
      toast("진행 중 작업이 취소되었습니다.", "warn");
      return;
    }
    console.error(e);
    toast("통합 예측 중 오류가 발생했습니다. (API 지연/제한 가능)", "danger");
  }finally{
    endOperation(opToken);
    if(btn){
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 통합 예측(단·중·장) 실행';
    }
  }
}

/* ✅ 추천 클릭 → 통합 예측 모달 */
async function quickAnalyzeAllAndShow(symbol){
  ensureRuntimeState();

  const opToken = beginOperation("ANALYSIS_ALL");

  try{
    switchCoin(symbol);
    saveState();
    initChart();

    checkCanceled(opToken);

    const tfSet = getMTFSet3();
    const candlesByTf = {};
    for(const tfRaw of tfSet){
      checkCanceled(opToken);
      const candles = await fetchCandles(symbol, tfRaw, EXTENDED_LIMIT);
      candlesByTf[tfRaw] = candles;
    }

    const out = {};
    for(const baseTfRaw of ["60","240","D"]){
      const baseCandles = candlesByTf[baseTfRaw] || [];
      if(baseCandles.length < (SIM_WINDOW + FUTURE_H + 80)){
        out[baseTfRaw] = null;
        continue;
      }
      out[baseTfRaw] = buildSignalFromCandles_MTF(symbol, baseTfRaw, candlesByTf, "3TF");
    }

    showResultModalAll(symbol, out);
  }catch(e){
    if(String(e?.message || "").includes("CANCELLED")){
      toast("진행 중 작업이 취소되었습니다.", "warn");
      return;
    }
    console.error(e);
    toast("통합 추천 분석 중 오류가 발생했습니다.", "danger");
  }finally{
    endOperation(opToken);
  }
}

/* ==========================================================
   Modal (단일)
   ========================================================== */
function showResultModal(pos){
  ensureRuntimeState();

  // 단일 모드 진입 시 멀티 영역 숨김(잔상 방지)
  _hideMultiArea();
  tempMulti = null;
  selectedMultiPos = null;

  let forcePos = null;
  const blockedByPattern = isPatternBlockedHold(pos);
  if(blockedByPattern){
    forcePos = buildForcedTrackFromHold(pos);
  }

  tempPos = pos;

  const modal = document.getElementById("result-modal");
  const icon = document.getElementById("modal-icon");
  const title = document.getElementById("modal-title");
  const subtitle = document.getElementById("modal-subtitle");
  const grid = document.getElementById("modal-grid");
  const content = document.getElementById("modal-content");
  const confirmBtn = document.getElementById("modal-confirm");

  if(!modal || !icon || !title || !subtitle || !grid || !content || !confirmBtn) return;

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

  const calibLine = `최근승률 ${(ex.recentWinRate*100).toFixed(0)}% → winProb ${(ex.winProb*100).toFixed(1)}% (α ${RECENT_CALIB_ALPHA})`;
  const regimeLine = `추세강도 ${Number(ex.trendStrength||0).toFixed(2)} / ATR ${Number(ex.atrPct||0).toFixed(2)}%`;

  if(isHold){
    const reasons = (ex.holdReasons || []).map(r => `- ${r}`).join("<br/>");

    if(blockedByPattern && forcePos){
      const inferredType = forcePos.type;
      const tpLine = `$${forcePos.tp.toLocaleString(undefined,{maximumFractionDigits:6})} (+${forcePos.tpPct.toFixed(2)}%)`;
      const slLine = `$${forcePos.sl.toLocaleString(undefined,{maximumFractionDigits:6})} (-${forcePos.slPct.toFixed(2)}%)`;

      icon.textContent = "⚠️";
      title.textContent = "RISK (패턴경고 감지)";
      title.style.color = "var(--danger)";

      grid.innerHTML = `
        <div class="mini-box"><small>판정</small><div>리스크 경고 (그래도 가능)</div></div>
        <div class="mini-box"><small>예상 방향</small><div>${inferredType}</div></div>
        <div class="mini-box"><small>성공확률(추정)</small><div>${(ex.winProb*100).toFixed(1)}%</div></div>
        <div class="mini-box"><small>MTF</small><div>${mtfLine}</div></div>
      `;

      content.innerHTML = `
        <b>현재는 “자주 실패한 패턴” 경고가 있어서 기본은 HOLD입니다.</b><br/>
        하지만 너 요청대로 <b>예측을 줄이지 않기 위해</b> 아래 버튼으로 “위험 감안 추적”을 허용합니다.<br/><br/>
        <b>복원된 TP/SL(강제추적 기준):</b><br/>
        - TP ${tpLine}<br/>
        - SL ${slLine}<br/><br/>
        <b>HOLD 사유:</b><br/>
        ${reasons}<br/><br/>
        <b>추가 정보:</b><br/>
        - ${calibLine}<br/>
        - ${regimeLine}<br/><br/>
        <b>정리:</b> “완전 차단” 대신 “경고 + 감점”으로 운영합니다.
      `;

      confirmBtn.disabled = false;
      confirmBtn.textContent = "위험 감안하고 추적 등록";
      confirmBtn.onclick = () => confirmTrack(forcePos);
    }else{
      grid.innerHTML = `
        <div class="mini-box"><small>판정</small><div>이번에는 예측 안 함</div></div>
        <div class="mini-box"><small>MTF</small><div>${mtfLine}</div></div>
        <div class="mini-box"><small>유사도 평균</small><div>${ex.simAvg.toFixed(1)}%</div></div>
        <div class="mini-box"><small>표본 수</small><div>${ex.simCount}개</div></div>
      `;
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
      confirmBtn.onclick = () => {};
    }
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
    confirmBtn.onclick = () => confirmTrack();
  }

  modal.style.display = "flex";
}

/* ==========================================================
   ✅ 통합 모달: 전략 카드(6개) 보여주고 선택 → 등록
   ========================================================== */
function showResultModalAll(symbol, posMap){
  ensureRuntimeState();

  tempMulti = posMap || null;
  selectedMultiPos = null;

  const modal = document.getElementById("result-modal");
  const icon = document.getElementById("modal-icon");
  const title = document.getElementById("modal-title");
  const subtitle = document.getElementById("modal-subtitle");
  const grid = document.getElementById("modal-grid");
  const content = document.getElementById("modal-content");
  const cards = document.getElementById("multi-cards");
  const selectedEl = document.getElementById("multi-selected");
  const chooseBtn = document.getElementById("multi-choose");

  if(!modal || !icon || !title || !subtitle || !grid || !content || !cards || !selectedEl || !chooseBtn) return;

  _showMultiArea();

  icon.textContent = "🧠";
  title.textContent = "통합 예측 결과 (6전략)";
  title.style.color = "var(--primary)";
  subtitle.textContent = `${symbol} | 15m / 30m / 1H / 4H / 1D / 1W`;

  // 초기 안내
  grid.innerHTML = `
    <div class="mini-box"><small>안내</small><div>위 전략 카드에서 하나를 선택하세요</div></div>
    <div class="mini-box"><small>등록</small><div>선택 후 “추적 등록” 버튼을 누르세요</div></div>
    <div class="mini-box"><small>주의</small><div>HOLD는 원칙상 등록 불가</div></div>
    <div class="mini-box"><small>예외</small><div>패턴 경고 HOLD 또는 “고확신 HOLD”는 RISK로 허용</div></div>
  `;
  content.innerHTML = `
    <b>설명:</b> 단기/중기/장기 결과를 한 번에 보여주고, 너가 원하는 전략을 <b>선택해서</b> 추적 등록하는 방식입니다.
  `;

  selectedEl.textContent = "선택: 없음";
  chooseBtn.disabled = true;
  chooseBtn.style.opacity = "0.65";
  chooseBtn.textContent = "선택한 전략으로 추적 등록";

  const tfOrder = (typeof STRATEGY_TFS !== "undefined" && Array.isArray(STRATEGY_TFS)) ? STRATEGY_TFS : ["15","30","60","240","D","W"];

  const scoreFromPos = (p) => {
    const ex = p?.explain || {};
    return computeScanScore({
      winProb: ex.winProb,
      edge: ex.edge,
      simAvg: ex.simAvg,
      adx: ex.adx,
      atrPct: ex.atrPct,
      trendStrength: ex.trendStrength,
      srPenalty: ex.srPenalty,
      isRisk: isPatternBlockedHold(p)
    });
  };

  const bestTf = (()=>{
    let best = null;
    let bestScore = -1e9;
    for(const tfRaw of tfOrder){
      const p = posMap?.[tfRaw];
      if(!p) continue;
      const sc = scoreFromPos(p);
      if(sc > bestScore){ bestScore = sc; best = tfRaw; }
    }
    return best;
  })();

  cards.innerHTML = tfOrder.map(tfRaw => {
    const p = posMap?.[tfRaw] || null;
    const label = (typeof tfName === "function") ? tfName(tfRaw) : tfRaw;

    if(!p){
      return `
        <div class="mini-box" data-tf="${tfRaw}" style="opacity:.6;">
          <small>${label}</small>
          <div>데이터 부족</div>
          <div style="margin-top:6px; font-size:11px; color:var(--text-sub); font-weight:900;">
            캔들 부족/제한
          </div>
        </div>
      `;
    }

    const ex = p.explain || {};
    const wp = Number.isFinite(ex.winProb) ? (ex.winProb*100).toFixed(1) : "-";
    const edge = Number.isFinite(ex.edge) ? (ex.edge*100).toFixed(1) : "-";
    const sim = Number.isFinite(ex.simAvg) ? ex.simAvg.toFixed(1) : "-";
    const mtf = ex?.mtf ? `${ex.mtf.agree}/${(ex.mtf.votes||[]).length}(${(ex.mtf.votes||[]).join("/")})` : "-";
    const conf = ex?.conf?.tier ?? "-";
    const adx = Number.isFinite(ex.adx) ? ex.adx.toFixed(0) : "-";
    const bb = Number.isFinite(ex.bbPos) ? `${(ex.bbPos*100).toFixed(0)}%` : "-";
    const st = Number.isFinite(ex.stochRsi) ? `${(ex.stochRsi*100).toFixed(0)}%` : "-";
    const vwp = Number.isFinite(ex.vwapDistPct) ? `${ex.vwapDistPct.toFixed(2)}%` : "-";

    const isHold = (p.type === "HOLD");
    const isLong = (p.type === "LONG");
    const color = isHold ? "var(--text-sub)" : (isLong ? "var(--success)" : "var(--danger)");
    const dup = hasActivePosition(p.symbol, p.tfRaw);

    const riskHold = isPatternBlockedHold(p);
    const highHold = isHighConfidenceHold(p);
    const riskTag = (isHold && (riskHold || highHold)) ? "RISK 가능" : (isHold ? "HOLD" : p.type);
    const bestTag = (bestTf && tfRaw === bestTf) ? " · AI BEST" : "";

    return `
      <div class="mini-box" data-tf="${tfRaw}"
           style="cursor:${dup ? "not-allowed" : "pointer"}; opacity:${dup ? .45 : 1}; border:2px solid transparent;"
           onclick="selectMultiTf('${tfRaw}')">
        <small>${label}</small>
        <div style="color:${color}; font-weight:950;">
          ${riskTag}${bestTag}${dup ? " (이미 추적중)" : ""}
        </div>
        <div style="margin-top:6px; font-size:11px; color:var(--text-sub); font-weight:900; line-height:1.35;">
          성공확률 ${wp}% · 엣지 ${edge}%<br/>
          유사도 ${sim}% · ADX ${adx} · BB ${bb} · StochRSI ${st}<br/>
          VWAP ${vwp} · MTF ${mtf} · CONF ${conf}
        </div>
      </div>
    `;
  }).join("");

  modal.style.display = "flex";
}

// ✅ HOLD라도 "충분히 높은" 경우엔 기회 제공(과도한 HOLD 방지)
function isHighConfidenceHold(pos){
  const ex = (pos && pos.explain) ? pos.explain : {};
  const wp = Number(ex.winProb || 0);
  const ed = Number(ex.edge || 0);
  const sim = Number(ex.simAvg || 0);
  const tp = Number(ex.tpPct || 0);
  return (wp >= 0.62) && (ed >= 0.09) && (sim >= 58) && (tp >= 0.75);
}

/* 카드 선택 */
function selectMultiTf(tfRaw){
  ensureRuntimeState();

  if(!tempMulti) return;
  const p = tempMulti[tfRaw];
  if(!p){
    toast("이 전략은 데이터가 부족합니다.", "warn");
    return;
  }

  // 중복 추적이면 선택 불가
  if(hasActivePosition(p.symbol, p.tfRaw)){
    toast("이미 같은 코인/같은 기간의 추적 포지션이 있습니다.", "warn");
    return;
  }

  // HOLD 처리 (패턴 리스크 HOLD만 예외적으로 허용)
  let chosen = p;
  if(p.type === "HOLD"){
    const riskHold = isPatternBlockedHold(p);
    const softHold = isHighConfidenceHold(p);

    if(riskHold || softHold){
      const forced = buildForcedTrackFromHold(p);
      if(forced){
        chosen = forced;
        chosen._forceTrack = true;
        chosen._forceReason = riskHold ? "RISK_HOLD" : "SOFT_HOLD";
      }else{
        toast("RISK HOLD인데 TP/SL 복원이 실패했습니다.", "warn");
        return;
      }
    }else{
      toast("이 전략은 HOLD라서 등록할 수 없습니다.", "warn");
      // 그래도 상세는 보여주기 위해 단일 모달 렌더를 호출하지는 않음
      return;
    }
  }

  selectedMultiPos = chosen;

  // 카드 하이라이트
  const cards = document.getElementById("multi-cards");
  if(cards){
    const kids = Array.from(cards.querySelectorAll("[data-tf]"));
    for(const el of kids){
      el.style.border = "2px solid transparent";
    }
    const sel = cards.querySelector(`[data-tf="${tfRaw}"]`);
    if(sel) sel.style.border = "2px solid var(--primary)";
  }

  // 선택 표시
  const selectedEl = document.getElementById("multi-selected");
  if(selectedEl){
    selectedEl.textContent = `선택: ${p.tf} → ${chosen.type}${chosen._forceTrack ? " (RISK)" : ""}`;
  }

  // 버튼 활성화
  const chooseBtn = document.getElementById("multi-choose");
  if(chooseBtn){
    chooseBtn.disabled = false;
    chooseBtn.style.opacity = "1";
    chooseBtn.textContent = chosen._forceTrack ? "위험 감안하고 추적 등록" : "선택한 전략으로 추적 등록";
  }

  // 아래 단일 영역에 상세 표시(간단)
  const grid = document.getElementById("modal-grid");
  const content = document.getElementById("modal-content");
  if(grid && content){
    const ex = chosen.explain || {};
    const wp = Number.isFinite(ex.winProb) ? (ex.winProb*100).toFixed(1) : "-";
    const edge = Number.isFinite(ex.edge) ? (ex.edge*100).toFixed(1) : "-";
    const sim = Number.isFinite(ex.simAvg) ? ex.simAvg.toFixed(1) : "-";
    const mtfLine = ex?.mtf ? `MTF 합의: ${ex.mtf.agree}/${(ex.mtf.votes||[]).length} (${(ex.mtf.votes||[]).join("/")})` : "MTF: -";
    const confLine = ex?.conf ? `확신도: ${ex.conf.tier} (RR ${Number(ex.conf.rrUsed||RR).toFixed(2)})` : "확신도: -";

    grid.innerHTML = `
      <div class="mini-box"><small>진입가</small><div>$${chosen.entry.toLocaleString(undefined,{maximumFractionDigits:6})}</div></div>
      <div class="mini-box"><small>성공확률</small><div>${wp}%</div></div>
      <div class="mini-box"><small>TP</small><div style="color:var(--success)">$${chosen.tp.toLocaleString(undefined,{maximumFractionDigits:6})} (+${chosen.tpPct.toFixed(2)}%)</div></div>
      <div class="mini-box"><small>SL</small><div style="color:var(--danger)">$${chosen.sl.toLocaleString(undefined,{maximumFractionDigits:6})} (-${chosen.slPct.toFixed(2)}%)</div></div>
    `;

    content.innerHTML = `
      <b>선택한 전략 상세:</b><br/>
      - ${mtfLine}<br/>
      - ${confLine}<br/>
      - 유사도 ${sim}% · 엣지 ${edge}%<br/>
      ${chosen._forceTrack ? `<br/><b style="color:var(--danger);">RISK:</b> 패턴 경고 HOLD를 “감안 추적”으로 허용했습니다.` : ""}
    `;
  }
}

function confirmTrackSelected(){
  ensureRuntimeState();

  if(!selectedMultiPos){
    toast("먼저 전략을 선택하세요.", "warn");
    return;
  }
  confirmTrack(selectedMultiPos);
}

/* ==========================================================
   closeModal / confirmTrack
   ========================================================== */
function closeModal(){
  const modal = document.getElementById("result-modal");
  if(modal) modal.style.display = "none";

  tempPos = null;
  tempMulti = null;
  selectedMultiPos = null;

  // 멀티 잔상 제거
  try{ _hideMultiArea(); }catch(e){}
}

function confirmTrack(forcedPos=null){
  ensureRuntimeState();

  const posToUse = forcedPos || tempPos;
  if(!posToUse) return;

  ensurePosId(posToUse);

  if(posToUse.type === "HOLD" && !posToUse._forceTrack){
    return;
  }

  if(hasActivePosition(posToUse.symbol, posToUse.tfRaw)){
    toast("이미 같은 코인/같은 기간의 추적 포지션이 있습니다.", "warn");
    return;
  }

  const createdAt = Date.now();
  const expiryAt = createdAt + tfToMs(posToUse.tfRaw);

  state.activePositions.unshift({
    ...posToUse,
    id: posToUse.id,
    status: "ACTIVE",
    lastPrice: posToUse.entry,
    pnl: 0,
    mfePct: 0,
    createdAt,
    expiryAt
  });

  saveState();
  closeModal();
  renderTrackingList();
  updateStatsUI();
  updateCountdownTexts();

  if(posToUse._forceTrack){
    toast(`[${posToUse.symbol} ${posToUse.tf}] RISK 추적 등록 완료 (패턴경고 override)`, "warn");
  }
}

/* ==========================================================
   Tracking
   ========================================================== */
function trackPositions(symbol, currentPrice){
  ensureRuntimeState();

  let changed = false;
  const FEE_SAFE = (typeof FEE_PCT === "number" && Number.isFinite(FEE_PCT)) ? FEE_PCT : 0;

  for(let i = state.activePositions.length - 1; i >= 0; i--){
    const pos = state.activePositions[i];
    ensurePosId(pos);

    if(pos.symbol !== symbol) continue;

    pos.lastPrice = currentPrice;

    let pnlGross = 0;
    if(pos.type === "LONG"){
      pnlGross = ((currentPrice - pos.entry) / pos.entry) * 100;
    }else{
      pnlGross = ((pos.entry - currentPrice) / pos.entry) * 100;
    }
    const pnl = pnlGross - FEE_SAFE;
    pos.pnl = pnl;

    const favorable = (pos.type === "LONG")
      ? ((currentPrice - pos.entry) / pos.entry) * 100
      : ((pos.entry - currentPrice) / pos.entry) * 100;

    if(Number.isFinite(favorable)){
      if(typeof pos.mfePct !== "number") pos.mfePct = 0;
      if(favorable > pos.mfePct) pos.mfePct = favorable;
    }

    if(Number.isFinite(pos.mfePct) && pos.status === "ACTIVE"){
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
      try{ recordTradeToPatternDB(pos, win); }catch(e){}

      state.history.total++;
      if(win) state.history.win++;

      let pnlExitGross = 0;
      const px = (exitPrice ?? currentPrice);
      if(pos.type === "LONG"){
        pnlExitGross = ((px - pos.entry) / pos.entry) * 100;
      }else{
        pnlExitGross = ((pos.entry - px) / pos.entry) * 100;
      }
      const pnlExit = pnlExitGross - FEE_SAFE;

      const record = {
        id: Date.now(),
        symbol: pos.symbol,
        tf: pos.tf,
        tfRaw: pos.tfRaw,
        type: pos.type,
        entry: pos.entry,
        exit: px,
        pnlPct: pnlExit,
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
        `[${pos.symbol} ${pos.tf}] 종료: ${win ? "성공" : "실패"} (${exitReason}) / 수익률 ${pnlExit.toFixed(2)}% / MFE ${record.mfePct.toFixed(2)}% (비용 -${FEE_SAFE.toFixed(2)}%)`,
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
  ensureRuntimeState();

  const container = document.getElementById("tracking-container");
  if(!container) return;

  ensureStrategyCountUI();
  updateStrategyCountUI();

  if(!state.activePositions.length){
    container.innerHTML = `
      <div style="text-align:center; padding:50px; color:var(--text-sub); font-weight:950;">
        <i class="fa-solid fa-radar" style="font-size:44px; opacity:.18;"></i><br><br>
        현재 추적 중인 포지션이 없습니다.<br/>
        왼쪽에서 코인을 고르고 “통합 예측(단·중·장)”을 눌러보세요.
      </div>
    `;
    return;
  }

  ensureExpiryOnAllPositions();
  ensureIdsOnAllPositions();

  container.innerHTML = state.activePositions.map(pos => {
    ensurePosId(pos);

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

    const riskTag = pos._forceTrack ? ` <span style="font-size:11px; font-weight:950; color:var(--danger);">(RISK)</span>` : "";

    return `
      <div class="position-card">
        <div class="card-header">
          <div class="card-symbol">
            ${pos.symbol} <span style="font-size:12px; color:var(--text-sub); font-weight:950;">${pos.tf}</span>${riskTag}
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

/* ==========================================================
   Closed trades + stats
   ========================================================== */
function renderClosedTrades(){
  ensureRuntimeState();

  const container = document.getElementById("history-container");
  const countEl = document.getElementById("history-count");
  if(!container || !countEl) return;

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
  ensureRuntimeState();

  const totalEl = document.getElementById("total-stat");
  const winEl = document.getElementById("win-stat");
  const activeEl = document.getElementById("active-stat");
  if(!totalEl || !winEl || !activeEl) return;

  totalEl.innerText = state.history.total;
  const rate = state.history.total > 0 ? (state.history.win / state.history.total) * 100 : 0;
  winEl.innerText = `${rate.toFixed(1)}%`;
  activeEl.innerText = state.activePositions.length;

  ensureStrategyCountUI();
  updateStrategyCountUI();
}

/* ==========================================================
   ✅ 통합 자동 스캔 (단/중/장 한 번에)
   - 결과 클릭 시: 통합 예측 모달(선택형)으로 연결
   ========================================================== */
async function autoScanUniverseAll(){
  ensureRuntimeState();

  // 모달 열어두면 진행률이 바로 보임
  try{ openScanModal && openScanModal(); }catch(e){}

  const opToken = beginOperation("SCAN_ALL");

  const startBtn = document.getElementById("scan-start-btn");
  if(startBtn) startBtn.disabled = true;

  const tfs = (typeof STRATEGY_TFS !== "undefined" && Array.isArray(STRATEGY_TFS)) ? STRATEGY_TFS : ["15","30","60","240","D","W"];

  // 진행률 상태 (모달에서 표시)
  scanProgress = {
    running: true,
    startedAt: Date.now(),
    totalSteps: (state.universe || []).length * tfs.length,
    doneSteps: 0,
    currentSymbol: "-",
    currentTf: "-",
    percent: 0
  };

  try{
    const allMap = {}; // symbol -> { bestTf, best, all:{tf:summary} }
    const bestList = [];

    for(let i=0;i<(state.universe||[]).length;i++){
      checkCanceled(opToken);

      const coin = state.universe[i];
      const sym = coin.s;
      scanProgress.currentSymbol = sym;

      // 1) 심볼별 6TF 캔들 확보(최소화)
      const candlesAll = {};
      for(const tfRaw of tfs){
        checkCanceled(opToken);
        scanProgress.currentTf = tfRaw;

        // TF별 적절한 limit (짧은 TF는 조금 더 길게)
        const limit = (tfRaw === "15") ? 520 : (tfRaw === "30") ? 480 : (tfRaw === "60") ? 420 : (tfRaw === "240") ? 380 : (tfRaw === "D") ? 360 : 260;
        try{
          candlesAll[tfRaw] = await fetchCandles(sym, tfRaw, limit);
        }catch(e){
          candlesAll[tfRaw] = [];
        }

        // 진행률 갱신
        scanProgress.doneSteps++;
        scanProgress.percent = Math.min(100, Math.floor((scanProgress.doneSteps / Math.max(1, scanProgress.totalSteps)) * 100));
        renderScanModal();

        // 취소 가능 딜레이
        await sleepCancelable(Math.max(180, SCAN_DELAY_MS - 420), opToken);
      }

      // 2) TF별 시그널 계산
      const perTf = {};
      let best = null;
      let bestTf = null;

      for(const baseTfRaw of tfs){
        const set = (typeof getMTFSet2 === "function") ? getMTFSet2(baseTfRaw) : [baseTfRaw];
        const candlesByTf = {};
        let ok = true;
        for(const k of set){
          const arr = candlesAll[k] || [];
          candlesByTf[k] = arr;
          if(arr.length < (SIM_WINDOW + FUTURE_H + 50)) ok = false;
        }
        if(!ok){
          continue;
        }

        let pos = null;
        try{
          pos = buildSignalFromCandles_MTF(sym, baseTfRaw, candlesByTf, "2TF");
        }catch(e){
          continue;
        }

        const ex = pos.explain || {};
        const inferredType = (Number(ex.longP ?? 0.5) >= Number(ex.shortP ?? 0.5)) ? "LONG" : "SHORT";
        const riskHold = isPatternBlockedHold(pos);
        const softHold = isHighConfidenceHold(pos);
        const displayType = (pos.type === "HOLD") ? inferredType : pos.type;

        const summary = {
          symbol: sym,
          tfRaw: baseTfRaw,
          tf: pos.tf,
          type: displayType,
          holdOriginal: (pos.type === "HOLD"),
          isRisk: !!riskHold,
          isSoft: (!!softHold && !riskHold),
          winProb: Number(ex.winProb || 0),
          edge: Number(ex.edge || 0),
          simAvg: Number(ex.simAvg || 0),
          adx: Number(ex.adx || 0),
          atrPct: Number(ex.atrPct || 0),
          trendStrength: Number(ex.trendStrength || 0),
          srPenalty: Number(ex.srPenalty || 0),
          tpPct: Number(ex.tpPct || 0),
          slPct: Number(ex.slPct || 0)
        };

        summary._score = computeScanScore(summary);
        perTf[baseTfRaw] = summary;

        // BEST 선택
        if(!best || summary._score > best._score){
          best = summary;
          bestTf = baseTfRaw;
        }
      }

      if(best){
        bestList.push(best);
        allMap[sym] = { bestTf, best, all: perTf };
      }
    }

    // 저장 (BEST 60개)
    bestList.sort((a,b)=> (b._score||0) - (a._score||0));
    state.lastScanFull = {
      createdAt: Date.now(),
      viewMode: scanViewMode,
      bestList: bestList.map(x => {
        const { _score, ...rest } = x;
        return { ...rest, score: _score };
      }),
      allMap
    };

    // 사이드바 추천은 상위 10개
    state.lastScanResults = (state.lastScanFull.bestList || []).slice(0, 10).map(x => ({
      symbol: x.symbol,
      tf: x.tf,
      tfRaw: x.tfRaw,
      type: x.type,
      winProb: x.winProb,
      edge: x.edge,
      mtfAgree: 1,
      mtfVotes: "",
      confTier: "",
      isRisk: !!x.isRisk,
      multi: true,
      score: x.score
    }));
    state.lastScanAt = Date.now();
    saveState();

    scanProgress.running = false;
    renderScanResults();
    renderScanModal();
    toast("통합 자동 스캔 완료", "success");
  }catch(e){
    if(String(e?.message || "").includes("CANCELLED")){
      toast("통합 자동 스캔이 취소되었습니다.", "warn");
      scanProgress && (scanProgress.running = false);
      renderScanModal();
      return;
    }
    console.error(e);
    toast("통합 자동 스캔 중 오류가 발생했습니다.", "danger");
  }finally{
    scanProgress && (scanProgress.running = false);
    endOperation(opToken);
    if(startBtn) startBtn.disabled = false;
    renderScanModal();
  }
}

function renderScanResults(){
  ensureRuntimeState();

  const container = document.getElementById("rec-container");
  if(!container) return;

  const list = state.lastScanResults || [];
  if(!list.length){
    container.innerHTML = `
      <div style="font-size:11px; color:var(--text-sub); font-weight:900; padding:6px 2px;">
        아직 추천 결과가 없습니다. “통합 자동 스캔”을 눌러주세요.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(item => {
    const pillClass = item.type === "LONG" ? "long" : "short";
    const prob = (item.winProb*100).toFixed(1);
    const edge = (item.edge*100).toFixed(1);
    const mtf = item.mtfVotes ? ` · MTF ${item.mtfAgree}/${item.mtfVotes.split("/").length}(${item.mtfVotes})` : "";
    const conf = item.confTier ? ` · ${item.confTier}` : "";
    const risk = item.isRisk ? ` · <span style="color:var(--danger); font-weight:950;">RISK</span>` : "";
    const tfTag = item.tf ? ` · ${item.tf}` : "";

    const click = `quickAnalyzeAllAndShow('${item.symbol}')`;

    return `
      <div class="rec-item" onclick="${click}">
        <div class="rec-left">
          ${item.symbol.replace("USDT","")}
          <span class="pill ${pillClass}">${item.type}</span>
        </div>
        <div class="rec-right">
          성공확률 ${prob}%<br/>
          엣지 ${edge}%${tfTag}${mtf}${conf}${risk}
        </div>
      </div>
    `;
  }).join("");
}

/* ==========================================================
   ✅ Scan Modal (BEST/ALL + 진행률 표시)
   ========================================================== */
let scanViewMode = "BEST";
let scanProgress = null; // {running,totalSteps,doneSteps,currentSymbol,currentTf,startedAt}

function openScanModal(){
  const modal = document.getElementById("scan-modal");
  if(!modal) return;
  modal.style.display = "flex";
  renderScanModal();
}

function closeScanModal(){
  const modal = document.getElementById("scan-modal");
  if(!modal) return;
  modal.style.display = "none";
}

function setScanView(mode){
  scanViewMode = (mode === "ALL") ? "ALL" : "BEST";
  if(state.lastScanFull) state.lastScanFull.view = scanViewMode;
  renderScanModal();
}

function refreshScanModal(){
  renderScanModal();
}

/* ==========================================================
   ✅ Backtest Modal (60코인×6전략) + 65% 목표 필터
   ========================================================== */
let backtestViewMode = "BEST";
let backtestProgress = null; // {running,totalSteps,doneSteps,currentSymbol,currentTf,startedAt}

function openBacktestModal(){
  const el = document.getElementById("backtest-modal");
  if(el) el.style.display = "flex";
  renderBacktestModal();
}

function closeBacktestModal(){
  const el = document.getElementById("backtest-modal");
  if(el) el.style.display = "none";
}

function setBacktestViewMode(mode){
  backtestViewMode = (mode === "ALL") ? "ALL" : "BEST";
  if(state.lastBacktestFull) state.lastBacktestFull.view = backtestViewMode;
  renderBacktestModal();
}

function refreshBacktestModal(){
  renderBacktestModal();
}

function renderBacktestModal(){
  const status = document.getElementById("backtest-status");
  const perc = document.getElementById("backtest-perc");
  const cur = document.getElementById("backtest-current");
  const barFill = document.getElementById("backtest-bar-fill");
  const ts = document.getElementById("backtest-ts");
  const summary = document.getElementById("backtest-summary");
  const table = document.getElementById("backtest-table");

  const full = state.lastBacktestFull || null;
  const view = (full && full.view) ? full.view : backtestViewMode;

  // 진행률
  if(backtestProgress && backtestProgress.running){
    const p = backtestProgress.totalSteps ? Math.min(100, Math.floor((backtestProgress.doneSteps/backtestProgress.totalSteps)*100)) : 0;
    if(status) status.textContent = "백테스트 중...";
    if(perc) perc.textContent = `${p}%`;
    if(cur) cur.textContent = `${backtestProgress.currentSymbol || ""} ${backtestProgress.currentTf || ""}`.trim();
    if(barFill) barFill.style.width = `${p}%`;
  }else{
    if(status) status.textContent = full ? "완료" : "대기";
    if(perc) perc.textContent = full ? "100%" : "0%";
    if(cur) cur.textContent = "";
    if(barFill) barFill.style.width = full ? "100%" : "0%";
  }

  if(ts) ts.textContent = full ? `완료: ${fmtKST(full.createdAt)}` : "완료: --";

  // 요약
  if(summary){
    if(!full){
      summary.textContent = "아직 결과가 없습니다. '백테스트 시작'을 눌러주세요.";
    }else{
      const sel = full.selected || null;
      if(sel){
        summary.innerHTML = `
          <div><b>AI 최적화 필터</b>: 상위 신호만 선택하여 승률을 끌어올립니다.</div>
          <div>선택 승률: <b>${(sel.winRate*100).toFixed(1)}%</b> (선택 트레이드 ${sel.trades}개)</div>
          <div>컷오프 점수(대략): <b>${sel.cutoff.toFixed(3)}</b> 이상</div>
        `;
      }else{
        summary.textContent = "요약 정보를 만들지 못했습니다.";
      }
    }
  }

  // 테이블
  if(!table) return;
  if(!full){
    table.innerHTML = "";
    return;
  }

  const rows = (view === "ALL") ? (full.allList || []) : (full.bestList || []);
  const header = `
    <table>
      <thead>
        <tr>
          <th>코인</th>
          <th>전략</th>
          <th>트레이드</th>
          <th>승률</th>
          <th>평균 PnL</th>
          <th>보기</th>
        </tr>
      </thead>
      <tbody>
  `;

  const body = rows.map(r => {
    const winPct = (Number(r.winRate || 0)*100).toFixed(1);
    const pnl = Number(r.avgPnlPct || 0).toFixed(2);
    const tfLabel = (typeof tfName === "function") ? tfName(r.tfRaw) : String(r.tfRaw);
    const bestTag = r.isBestTf ? '<span class="badge best">AI BEST</span>' : "";
    return `
      <tr>
        <td><b>${r.symbol}</b></td>
        <td>${tfLabel} ${bestTag}</td>
        <td>${r.trades || 0}</td>
        <td><b>${winPct}%</b></td>
        <td>${pnl}%</td>
        <td><button class="btn sm" onclick="quickAnalyzeAllAndShow('${r.symbol}')">보기</button></td>
      </tr>
    `;
  }).join("");

  const footer = `</tbody></table>`;
  table.innerHTML = header + body + footer;

  // 버튼 active 표시
  try{
    const b1 = document.getElementById("backtest-view-best");
    const b2 = document.getElementById("backtest-view-all");
    if(b1 && b2){
      b1.classList.toggle("active", view === "BEST");
      b2.classList.toggle("active", view === "ALL");
    }
  }catch(e){}
}

async function runBacktestAll(){
  ensureRuntimeState();
  const opToken = beginOperation("BT_ALL");

  openBacktestModal();

  const startBtn = document.getElementById("backtest-start-btn");
  if(startBtn) startBtn.disabled = true;

  const universe = (state.universe && state.universe.length) ? state.universe.slice(0, 60) : [];
  const tfs = (typeof STRATEGY_TFS !== "undefined" && Array.isArray(STRATEGY_TFS)) ? STRATEGY_TFS : ["15","30","60","240","D","W"];
  const futureH = (typeof FUTURE_H !== "undefined") ? FUTURE_H : 8;
  const simWin = (typeof SIM_WINDOW !== "undefined") ? SIM_WINDOW : 80;

  const limitByTf = (tfRaw)=>{
    if(tfRaw === "15") return 900;
    if(tfRaw === "30") return 850;
    if(tfRaw === "60") return 700;
    if(tfRaw === "240") return 520;
    if(tfRaw === "D") return 420;
    return 260; // W
  };

  const strideByTf = (tfRaw)=>{
    if(tfRaw === "15") return 6;
    if(tfRaw === "30") return 5;
    if(tfRaw === "60") return 4;
    if(tfRaw === "240") return 3;
    return 2; // D/W
  };

  const samplesPerTf = 10;

  backtestProgress = {
    running:true,
    totalSteps: universe.length * tfs.length,
    doneSteps: 0,
    currentSymbol: "",
    currentTf: "",
    startedAt: Date.now()
  };
  renderBacktestModal();

  const allList = [];
  const bestList = [];
  const tradePool = []; // {score, win}

  try{
    for(const symbol of universe){
      if(isOperationCancelled(opToken)) throw new Error("CANCELLED");

      // 6개 TF 캔들 선 로딩(코인별 6회)
      const candlesAll = {};
      for(const tfRaw of tfs){
        if(isOperationCancelled(opToken)) throw new Error("CANCELLED");
        try{
          candlesAll[tfRaw] = await fetchCandles(symbol, tfRaw, limitByTf(tfRaw));
        }catch(e){
          candlesAll[tfRaw] = [];
        }
        await sleep(30);
      }

      const perTf = [];
      for(const tfRaw of tfs){
        backtestProgress.currentSymbol = symbol;
        backtestProgress.currentTf = tfRaw;

        backtestProgress.doneSteps += 1;
        renderBacktestModal();

        const baseFull = candlesAll[tfRaw] || [];
        if(baseFull.length < (simWin + futureH + 60)){
          perTf.push({ symbol, tfRaw, trades:0, wins:0, winRate:0, avgPnlPct:0 });
          continue;
        }

        // MTF 페어 준비
        const set2 = (typeof getMTFSet2 === "function") ? getMTFSet2(tfRaw) : [tfRaw];
        const baseKey = set2[0];
        const confKey = set2[1] || null;
        const confFull = confKey ? (candlesAll[confKey] || []) : [];

        let trades = 0;
        let wins = 0;
        let pnlSum = 0;
        let scoreSum = 0;

        const stride = strideByTf(tfRaw);
        for(let k=1; k<=samplesPerTf; k++){
          const idx = baseFull.length - futureH - 1 - (k*stride);
          if(idx < (simWin + 40)) break;

          const entryCandle = baseFull[idx];
          const baseSlice = baseFull.slice(0, idx+1);
          const byTf = {};
          byTf[baseKey] = baseSlice;
          if(confKey && confFull.length){
            const confSlice = sliceCandlesUpToTime(confFull, entryCandle.t);
            byTf[confKey] = confSlice;
          }

          let pos;
          try{
            pos = buildSignalFromCandles_MTF(symbol, tfRaw, byTf, "2TF");
          }catch(e){
            continue;
          }

          // HOLD는 원칙적으로 제외, 단 risk/soft HOLD는 forced로 평가
          let tradePos = pos;
          if(pos.type === "HOLD"){
            if(isPatternBlockedHold(pos) || isHighConfidenceHold(pos)){
              const forced = buildForcedTrackFromHold(pos);
              if(forced) tradePos = forced;
              else continue;
            }else{
              continue;
            }
          }

          const fut = baseFull.slice(idx+1, idx+1+futureH);
          const out = simulateOutcome(tradePos, fut);

          if(out && out.resolved){
            trades += 1;
            if(out.win) wins += 1;
            pnlSum += Number(out.pnlPct || 0);

            const ex = tradePos.explain || {};
            const s = computeScanScore({
              winProb: ex.winProb,
              edge: ex.edge,
              simAvg: ex.simAvg,
              adx: ex.adx,
              atrPct: ex.atrPct,
              srPenalty: ex.srPenalty,
              trendStrength: ex.trendStrength,
              isRisk: (isPatternBlockedHold(pos) || tradePos._forceTrack)
            });
            scoreSum += s;
            tradePool.push({ score:s, win:!!out.win });
          }
        }

        const winRate = trades ? (wins / trades) : 0;
        const avgPnlPct = trades ? (pnlSum / trades) : 0;
        const avgScore = trades ? (scoreSum / trades) : 0;

        perTf.push({ symbol, tfRaw, trades, wins, winRate, avgPnlPct, avgScore });
      }

      // 코인별 BEST 선택(트레이드가 있는 전략 우선)
      let best = null;
      for(const r of perTf){
        if(!best) best = r;
        else{
          // 우선순위: 승률 → 트레이드 수 → avgScore
          const a = Number(r.winRate || 0);
          const b = Number(best.winRate || 0);
          if(a > b + 1e-9) best = r;
          else if(Math.abs(a-b) < 1e-9){
            const ta = Number(r.trades || 0);
            const tb = Number(best.trades || 0);
            if(ta > tb) best = r;
            else if(ta === tb && Number(r.avgScore||0) > Number(best.avgScore||0)) best = r;
          }
        }
      }

      for(const r of perTf){
        allList.push({ ...r, isBestTf: (best && r.tfRaw === best.tfRaw) });
      }
      if(best) bestList.push({ ...best, isBestTf:true });

      await sleep(60);
    }

    // 65% 목표 필터 (tradePool 점수 상위부터 누적 승률 계산)
    let selected = null;
    if(tradePool.length){
      const sorted = tradePool.slice().sort((a,b)=>b.score-a.score);
      let w = 0;
      for(let k=1; k<=sorted.length; k++){
        if(sorted[k-1].win) w += 1;
        const wr = w/k;
        if(k >= 25 && wr >= 0.65){
          selected = { trades:k, winRate:wr, cutoff:sorted[k-1].score };
        }
      }
      // 조건 만족이 없으면 최고 승률 구간을 선택
      if(!selected){
        let bestWr = 0;
        let bestK = 0;
        let bestCut = sorted[sorted.length-1].score;
        w = 0;
        for(let k=1; k<=sorted.length; k++){
          if(sorted[k-1].win) w += 1;
          const wr = w/k;
          if(k >= 20 && wr > bestWr){
            bestWr = wr;
            bestK = k;
            bestCut = sorted[k-1].score;
          }
        }
        selected = { trades: bestK || Math.min(sorted.length, 20), winRate: bestWr || (w/sorted.length), cutoff: bestCut };
      }
    }

    state.lastBacktestFull = {
      createdAt: Date.now(),
      view: backtestViewMode,
      bestList: bestList.sort((a,b)=> (b.winRate-a.winRate) || (b.trades-a.trades)),
      allList: allList.sort((a,b)=> (b.winRate-a.winRate) || (b.trades-a.trades)),
      selected
    };

    saveState();
    renderBacktestModal();

  }catch(err){
    if(String(err && err.message) === "CANCELLED"){
      toast("백테스트가 취소되었습니다.", "warn");
    }else{
      console.error(err);
      toast("백테스트 중 오류가 발생했습니다.", "danger");
    }
  }finally{
    backtestProgress = null;
    renderBacktestModal();
    if(startBtn) startBtn.disabled = false;
    endOperation();
  }
}

function renderScanModal(){
  ensureRuntimeState();

  const tsEl = document.getElementById("scan-ts");
  const tableEl = document.getElementById("scan-table");
  const barEl = document.getElementById("scan-bar-fill");
  const curEl = document.getElementById("scan-current");
  const progEl = document.getElementById("scan-progress");

  // 진행률
  if(scanProgress && scanProgress.running){
    const pct = scanProgress.totalSteps ? Math.min(100, Math.floor((scanProgress.doneSteps/scanProgress.totalSteps)*100)) : 0;
    if(barEl) barEl.style.width = `${pct}%`;
    if(curEl) curEl.textContent = `${scanProgress.currentSymbol || ""} ${scanProgress.currentTf || ""}`.trim();
    if(progEl) progEl.textContent = `${scanProgress.doneSteps}/${scanProgress.totalSteps} (${pct}%)`;
  }else{
    if(barEl) barEl.style.width = "0%";
    if(curEl) curEl.textContent = "-";
    if(progEl) progEl.textContent = "0/0 (0%)";
  }

  const full = state.lastScanFull || null;
  if(tsEl){
    tsEl.textContent = full && full.createdAt ? `업데이트: ${new Date(full.createdAt).toLocaleString()}` : "업데이트: --";
  }

  if(!tableEl) return;
  if(!full || !Array.isArray(full.bestList) || !full.bestList.length){
    tableEl.innerHTML = `<div style="font-size:12px; color:var(--text-sub); font-weight:900; padding:12px 6px;">아직 스캔 결과가 없습니다. 상단의 “60코인 전체 스캔시작”을 눌러주세요.</div>`;
    return;
  }

  const view = full.view || scanViewMode;
  const rows = (view === "ALL" && Array.isArray(full.allList) && full.allList.length) ? full.allList : full.bestList;

  tableEl.innerHTML = `
    <table class="scan-table">
      <thead>
        <tr>
          <th>코인</th>
          <th>전략</th>
          <th>방향</th>
          <th>점수</th>
          <th>확률</th>
          <th>엣지</th>
          <th>보기</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const sym = r.symbol;
          const tf = r.tf || r.tfRaw || "-";
          const typ = r.type || "HOLD";
          const score = Number(r.score || 0);
          const wp = Number(r.winProb || 0);
          const ed = Number(r.edge || 0);

          const pillClass = (typ === "LONG") ? "long" : (typ === "SHORT") ? "short" : "hold";
          const riskTag = r.isRisk ? ` <span style="color:var(--danger); font-weight:950;">RISK</span>` : "";
          const click = `quickAnalyzeAllAndShow('${sym}')`;

          return `
            <tr>
              <td><b>${sym.replace("USDT","")}</b></td>
              <td>${tf}${(r.isBestTf ? " <span class=\"tag-best\">AI BEST</span>" : "")}</td>
              <td><span class="pill ${pillClass}">${typ}</span>${riskTag}</td>
              <td>${score.toFixed(1)}</td>
              <td>${(wp*100).toFixed(1)}%</td>
              <td>${(ed*100).toFixed(1)}%</td>
              <td><button class="btn small" onclick="${click}">보기</button></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

/* ==========================================================
   Backtest (원본 유지)
   ========================================================== */
function sliceCandlesUpToTime(candles, t){
  if(!Array.isArray(candles) || !candles.length) return [];
  if(candles[candles.length-1].t <= t) return candles.slice();
  let j = candles.length - 1;
  while(j >= 0 && candles[j].t > t) j--;
  return candles.slice(0, Math.max(0, j+1));
}

function shiftPosEntryTo(pos, newEntry){
  if(!pos || !Number.isFinite(newEntry)) return pos;
  const oldEntry = pos.entry;
  if(!Number.isFinite(oldEntry) || oldEntry <= 0) return pos;

  const d = newEntry - oldEntry;
  pos.entry = newEntry;

  if(pos.type !== "HOLD"){
    if(Number.isFinite(pos.tp)) pos.tp += d;
    if(Number.isFinite(pos.sl)) pos.sl += d;

    if(Number.isFinite(pos.tp)){
      pos.tpPct = Math.abs((pos.tp - pos.entry) / pos.entry) * 100;
    }
    if(Number.isFinite(pos.sl)){
      pos.slPct = Math.abs((pos.sl - pos.entry) / pos.entry) * 100;
    }
  }
  return pos;
}

async function runBacktest(){
  ensureRuntimeState();

  const opToken = beginOperation("BACKTEST");

  const btBtn = document.getElementById("bt-btn");
  if(btBtn){
    btBtn.disabled = true;
    btBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 백테스트...';
  }

  const box = document.getElementById("bt-box");
  if(box) box.classList.remove("show");

  try{
    checkCanceled(opToken);

    const tfSet = getMTFSet2(state.tf);
    const baseTf = tfSet[0];
    const otherTf = tfSet[1];

    const candlesBase = await fetchCandles(state.symbol, baseTf, EXTENDED_LIMIT);
    if(candlesBase.length < (SIM_WINDOW + FUTURE_H + 120)) throw new Error("캔들 데이터가 부족합니다.");

    let candlesOther = null;
    try{
      candlesOther = await fetchCandles(state.symbol, otherTf, EXTENDED_LIMIT);
    }catch(e){}

    let wins=0, total=0;
    let pnlSum=0;

    const end = candlesBase.length - (FUTURE_H + 20);
    const start = Math.max(SIM_WINDOW + 80, end - (BACKTEST_TRADES * 7));

    for(let idx = start; idx < end; idx += 7){
      checkCanceled(opToken);

      const sliceBase = candlesBase.slice(0, idx+1);
      if(sliceBase.length < (SIM_WINDOW + FUTURE_H + 80)) continue;

      const byTf = { [baseTf]: sliceBase };

      if(Array.isArray(candlesOther) && candlesOther.length > 120){
        const tRef = sliceBase[sliceBase.length-1].t;
        const sliceOther = sliceCandlesUpToTime(candlesOther, tRef);
        if(sliceOther.length >= (SIM_WINDOW + FUTURE_H + 80)){
          byTf[otherTf] = sliceOther;
        }
      }

      const pos = buildSignalFromCandles_MTF(state.symbol, baseTf, byTf, "2TF");
      if(pos.type === "HOLD") continue;

      const ex = pos.explain || {};
      if((ex.winProb ?? 0) < BT_MIN_PROB) continue;
      if((ex.edge ?? 0) < BT_MIN_EDGE) continue;
      if((ex.simAvg ?? 0) < BT_MIN_SIM) continue;

      const entryCandle = candlesBase[idx+1];
      if(!entryCandle || !Number.isFinite(entryCandle.o)) continue;
      shiftPosEntryTo(pos, entryCandle.o);

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

    const nEl = document.getElementById("bt-n");
    const wEl = document.getElementById("bt-win");
    const aEl = document.getElementById("bt-avg");
    const rEl = document.getElementById("bt-range");
    if(nEl) nEl.textContent = `${total}회`;
    if(wEl) wEl.textContent = `${winRate.toFixed(1)}%`;
    if(aEl) aEl.textContent = `${avgPnl.toFixed(2)}%`;

    const tfNameShow = baseTf === "60" ? "1H" : baseTf === "240" ? "4H" : "1D";
    if(rEl){
      rEl.textContent =
        `${state.symbol} · ${tfNameShow} · 최근 ${EXTENDED_LIMIT}캔들 (필터: 확률≥${Math.round(BT_MIN_PROB*100)}%, 엣지≥${Math.round(BT_MIN_EDGE*100)}%, 유사도≥${BT_MIN_SIM}%) · MTF(2TF) · ✅otherTF누수방지 · ✅다음시가진입 · ✅동봉캔들보수판정 · 비용 -${FEE_PCT.toFixed(2)}% 반영`;
    }

    if(box) box.classList.add("show");
  }catch(e){
    if(String(e?.message || "").includes("CANCELLED")){
      toast("백테스트가 취소되었습니다.", "warn");
      return;
    }
    console.error(e);
    toast("백테스트 중 오류가 발생했습니다.", "danger");
  }finally{
    endOperation(opToken);
    if(btBtn){
      btBtn.disabled = false;
      btBtn.innerHTML = '<i class="fa-solid fa-flask"></i> 백테스트';
    }
  }
}

function simulateOutcome(pos, futureCandles){
  for(const c of futureCandles){
    const hi = c.h, lo = c.l;

    if(pos.type === "LONG"){
      const hitTP = (hi >= pos.tp);
      const hitSL = (lo <= pos.sl);

      if(hitTP && hitSL){
        const pnl = ((pos.sl - pos.entry)/pos.entry)*100 - FEE_PCT;
        return { resolved:true, win:false, pnlPct:pnl, reason:"BOTH_SL" };
      }
      if(hitTP){
        const pnl = ((pos.tp - pos.entry)/pos.entry)*100 - FEE_PCT;
        return { resolved:true, win:true, pnlPct:pnl, reason:"TP" };
      }
      if(hitSL){
        const pnl = ((pos.sl - pos.entry)/pos.entry)*100 - FEE_PCT;
        return { resolved:true, win:false, pnlPct:pnl, reason:"SL" };
      }
    }else{
      const hitTP = (lo <= pos.tp);
      const hitSL = (hi >= pos.sl);

      if(hitTP && hitSL){
        const pnl = ((pos.entry - pos.sl)/pos.entry)*100 - FEE_PCT;
        return { resolved:true, win:false, pnlPct:pnl, reason:"BOTH_SL" };
      }
      if(hitTP){
        const pnl = ((pos.entry - pos.tp)/pos.entry)*100 - FEE_PCT;
        return { resolved:true, win:true, pnlPct:pnl, reason:"TP" };
      }
      if(hitSL){
        const pnl = ((pos.entry - pos.sl)/pos.entry)*100 - FEE_PCT;
        return { resolved:true, win:false, pnlPct:pnl, reason:"SL" };
      }
    }
  }
  return { resolved:false, win:false, pnlPct:0, reason:"NO_HIT" };
}

/* ==========================================================
   window 바인딩 (index.html onclick 호환)
   ========================================================== */
window.tryAuth = tryAuth;
window.setTF = setTF;


// 통합(단/중/장)
window.executeAnalysisAll = executeAnalysisAll;
window.quickAnalyzeAllAndShow = quickAnalyzeAllAndShow;
window.selectMultiTf = selectMultiTf;
window.confirmTrackSelected = confirmTrackSelected;

// 스캔
window.autoScanUniverseAll = autoScanUniverseAll;

// 백테스트/모달
window.runBacktest = runBacktest;
window.confirmTrack = confirmTrack;
window.closeModal = closeModal;

// 진행취소
window.cancelOperation = cancelOperation;

// 운영 버튼
window.resetStatsUIAndData = resetStatsUIAndData;
window.cancelAllTracking = cancelAllTracking;
window.resetAll = resetAll;



/* =====================================================================
   ✅ YOPO AI PRO — v3 + predboost "FULL MERGE" OVERRIDES (2026-01-24)
   - Scan/Backtest 모달 DOM id 불일치 수정(버튼 '무반응' 근본 원인)
   - 스캔 진행상황(60코인×6전략) 모달 안에서 실시간 표시
   - 새로고침은 "재실행"이 아니라 "표시 갱신"만 수행
   - 보기(예측 모달) z-index 충돌 방지(스타일에서 scan/bt < result)
   - 6전략 통합 예측(15m/30m/1H/4H/1D/1W) + predboost 지표 기반 점수 사용
   - 전체 초기화 시 스캔/백테스트 결과까지 함께 초기화
   - PC↔모바일 동기화(내보내기/가져오기 코드)
===================================================================== */
(function(){
  const $ = (id)=>document.getElementById(id);

  function safeText(el, text){
    if(!el) return;
    el.textContent = text;
  }

  function fmtTs(ts){
    try{
      if(!ts) return "없음";
      const d = new Date(ts);
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,"0");
      const da = String(d.getDate()).padStart(2,"0");
      const hh = String(d.getHours()).padStart(2,"0");
      const mm = String(d.getMinutes()).padStart(2,"0");
      return `${y}-${m}-${da} ${hh}:${mm}`;
    }catch(e){
      return "없음";
    }
  }

  function tfLabelSafe(tfRaw){
    try{
      if(typeof tfToLabel === "function") return tfToLabel(tfRaw);
    }catch(e){}
    return String(tfRaw);
  }

  /* -----------------------------
     Scan Modal (DOM 정합)
  ----------------------------- */
  window.openScanModal = function(){
    const m = $("scan-modal");
    if(!m) return;
    m.style.display = "flex";
    try{ window.refreshScanModal(); }catch(e){}
  };

  window.closeScanModal = function(){
    const m = $("scan-modal");
    if(!m) return;
    m.style.display = "none";
  };

  window.refreshScanModal = function(){
    try{ renderScanModal(); }catch(e){ console.error("refreshScanModal error:", e); }
  };

  window.toggleScanView = function(){
    try{
      const next = (typeof scanViewMode === "string" && scanViewMode === "BEST") ? "ALL" : "BEST";
      window.setScanView(next);
    }catch(e){}
  };

  window.setScanView = function(mode){
    try{
      if(mode !== "BEST" && mode !== "ALL") mode = "BEST";
      scanViewMode = mode; // 기존 전역 변수 사용
      if(state && typeof state === "object"){
        state.lastScanFull = state.lastScanFull || {};
        state.lastScanFull.viewMode = mode;
        try{ saveState(); }catch(e){}
      }
      renderScanModal();
    }catch(e){ console.error("setScanView error:", e); }
  };

  function renderScanModal(){
    const sub = $("scan-modal-sub");
    if(sub){
      const ts = state?.lastScanFull?.ts || state?.lastScanAt || 0;
      sub.textContent = `최근 스캔: ${fmtTs(ts)}`;
    }

    // 진행상황
    const txt = $("scan-progress-text");
    const fill = $("scan-bar-fill");
    const p = (scanProgress && Number.isFinite(scanProgress.percent)) ? scanProgress.percent : 0;
    if(fill) fill.style.width = `${Math.max(0, Math.min(100, Math.round(p*100)))}%`;

    if(txt){
      const running = !!scanProgress?.running;
      const step = Number(scanProgress?.step || 0);
      const total = Number(scanProgress?.total || 0);
      const now = String(scanProgress?.current || "");
      if(running){
        txt.textContent = `진행중: ${step}/${total} • ${now}`;
      }else{
        const has = (state?.lastScanFull?.bestRows?.length || 0) + (state?.lastScanFull?.allRows?.length || 0) > 0;
        txt.textContent = has ? "완료" : "대기";
      }
    }

    // 보기 토글 버튼 라벨
    const toggleBtn = $("scan-toggle-view");
    if(toggleBtn){
      toggleBtn.textContent = (scanViewMode === "ALL") ? "ALL 보기" : "BEST 보기";
    }

    const wrap = $("scan-table");
    if(!wrap) return;

    const view = (scanViewMode === "ALL") ? "ALL" : "BEST";
    const full = state?.lastScanFull || null;
    const rows = (view === "ALL") ? (full?.allRows || []) : (full?.bestRows || []);
    const hasRows = Array.isArray(rows) && rows.length > 0;

    if(!hasRows){
      wrap.innerHTML = `<div style="padding:14px; font-weight:950; color:var(--text-sub);">스캔 결과가 없습니다. (60코인 전체 스캔 시작을 눌러주세요)</div>`;
      return;
    }

    const head = `
      <div class="table-wrap">
      <table class="scan-table">
        <thead>
          <tr>
            <th>코인</th>
            <th>전략</th>
            <th>예측</th>
            <th>Score</th>
            <th>성공률(추정)</th>
            <th>TP/SL</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
    `;

    const body = rows.map(r=>{
      const sym = r.symbol;
      const tf = r.tfRaw;
      const type = r.type || "HOLD";
      const score = Number.isFinite(r.score) ? r.score.toFixed(3) : "0.000";
      const win = Number.isFinite(r.winProb) ? `${Math.round(r.winProb*100)}%` : "-";
      const tpsl = (Number.isFinite(r.tpPct) && Number.isFinite(r.slPct))
        ? `+${r.tpPct.toFixed(2)}% / -${r.slPct.toFixed(2)}%`
        : "-";

      const bestTag = r.isBest ? `<span class="tag-best">BEST</span>` : "";

      return `
        <tr>
          <td style="font-weight:950;">${sym}</td>
          <td>${tfLabelSafe(tf)}${bestTag}</td>
          <td style="font-weight:950;">${type}</td>
          <td>${score}</td>
          <td>${win}</td>
          <td>${tpsl}</td>
          <td>
            <button class="btn small" onclick="openPredictionFromScan('${sym}','${tf}')">보기</button>
            <button class="btn small" style="margin-left:6px;" onclick="trackFromScan('${sym}','${tf}')">추적</button>
          </td>
        </tr>
      `;
    }).join("");

    const tail = `</tbody></table></div>`;
    wrap.innerHTML = head + body + tail;
  }

  // 스캔 테이블: 보기(예측 모달) / 추적
  window.openPredictionFromScan = function(symbol, tfRaw){
    try{
      const full = state?.lastScanFull;
      const all = full?.allRows || [];
      const row = all.find(x => x.symbol === symbol && String(x.tfRaw) === String(tfRaw));
      if(!row){
        toast("해당 스캔 결과를 찾지 못했습니다.", "warn");
        return;
      }
      // 결과 모달은 scan/bt보다 z-index가 높게 설정됨(styles.css)
      if(typeof showResultModal === "function"){
        showResultModal(symbol, row);
      }else{
        toast("예측 모달 함수(showResultModal)가 없습니다.", "danger");
      }
    }catch(e){
      console.error(e);
      toast("보기 실행 중 오류", "danger");
    }
  };

  window.trackFromScan = async function(symbol, tfRaw){
    try{
      const full = state?.lastScanFull;
      const all = full?.allRows || [];
      const row = all.find(x => x.symbol === symbol && String(x.tfRaw) === String(tfRaw));
      if(!row){
        toast("해당 스캔 결과를 찾지 못했습니다.", "warn");
        return;
      }
      // 스캔결과가 HOLD라도 기회를 '완전 차단'하지 않기 위해:
      // - HOLD인 경우에도 확률이 존재하면 forced track로 변환(기회 유지)
      let pos = row;
      if(row.type === "HOLD" && typeof buildForcedTrackFromHold === "function"){
        const forced = buildForcedTrackFromHold(row);
        if(forced) pos = forced;
      }
      if(typeof startTrackingPosition === "function"){
        startTrackingPosition(pos);
        toast(`추적 시작: ${symbol} (${tfLabelSafe(tfRaw)})`, "success");
      }else{
        toast("추적 함수(startTrackingPosition)가 없습니다.", "danger");
      }
    }catch(e){
      console.error(e);
      toast("추적 실행 중 오류", "danger");
    }
  };

  /* -----------------------------
     Backtest Modal (DOM 정합)
  ----------------------------- */
  window.openBacktestModal = function(){
    const m = $("bt-modal");
    if(!m) return;
    m.style.display = "flex";
    try{ window.refreshBacktestModal(); }catch(e){}
  };

  window.closeBacktestModal = function(){
    const m = $("bt-modal");
    if(!m) return;
    m.style.display = "none";
  };

  window.refreshBacktestModal = function(){
    try{ renderBacktestModal(); }catch(e){ console.error("refreshBacktestModal error:", e); }
  };

  window.toggleBacktestView = function(){
    try{
      const next = (typeof backtestViewMode === "string" && backtestViewMode === "BEST") ? "ALL" : "BEST";
      window.setBacktestView(next);
    }catch(e){}
  };

  window.setBacktestView = function(mode){
    try{
      if(mode !== "BEST" && mode !== "ALL") mode = "BEST";
      backtestViewMode = mode;
      if(state && typeof state === "object"){
        state.lastBacktestFull = state.lastBacktestFull || {};
        state.lastBacktestFull.viewMode = mode;
        try{ saveState(); }catch(e){}
      }
      renderBacktestModal();
    }catch(e){ console.error("setBacktestView error:", e); }
  };

  function renderBacktestModal(){
    const sub = $("bt-modal-sub");
    if(sub){
      const ts = state?.lastBacktestFull?.ts || state?.lastBacktestAt || 0;
      sub.textContent = `최근 백테스트: ${fmtTs(ts)}`;
    }

    const txt = $("bt-progress-text");
    const fill = $("bt-bar-fill");
    const p = (backtestProgress && Number.isFinite(backtestProgress.percent)) ? backtestProgress.percent : 0;
    if(fill) fill.style.width = `${Math.max(0, Math.min(100, Math.round(p*100)))}%`;

    if(txt){
      const running = !!backtestProgress?.running;
      const step = Number(backtestProgress?.step || 0);
      const total = Number(backtestProgress?.total || 0);
      const now = String(backtestProgress?.current || "");
      if(running){
        txt.textContent = `진행중: ${step}/${total} • ${now}`;
      }else{
        const has = (state?.lastBacktestFull?.rows?.length || 0) > 0;
        txt.textContent = has ? "완료" : "대기";
      }
    }

    const toggleBtn = $("bt-toggle-view");
    if(toggleBtn){
      toggleBtn.textContent = (backtestViewMode === "ALL") ? "ALL 보기" : "BEST 보기";
    }

    const sum = $("bt-summary");
    const tbl = $("bt-table");
    if(!sum || !tbl) return;

    const view = (backtestViewMode === "ALL") ? "ALL" : "BEST";
    const full = state?.lastBacktestFull || null;
    const rowsAll = full?.rows || [];
    const rows = (view === "ALL") ? rowsAll : rowsAll.filter(x=>x.isBest);

    // 요약
    if(full?.summary){
      const s = full.summary;
      sum.innerHTML = `
        <div class="bt-box">
          <div class="bt-k">선택 구간(확신 높은 구간)</div>
          <div class="bt-v">${Math.round((s.selectedWinRate || 0)*100)}% <span class="badge best">목표 65%</span></div>
          <div class="bt-sub">거래수: ${s.selectedTrades || 0} / 전체 후보: ${s.rawTrades || 0}</div>
        </div>
        <div class="bt-box">
          <div class="bt-k">전체(참고)</div>
          <div class="bt-v">${Math.round((s.rawWinRate || 0)*100)}%</div>
          <div class="bt-sub">확신 필터 없이 계산한 원본 결과</div>
        </div>
        <div class="bt-box">
          <div class="bt-k">BEST 전략 개수</div>
          <div class="bt-v">${s.bestCount || 0}개</div>
          <div class="bt-sub">코인별 가장 좋은 전략(6개 중)</div>
        </div>
      `;
    }else{
      sum.innerHTML = `<div class="bt-box"><div class="bt-k">요약</div><div class="bt-v">-</div><div class="bt-sub">백테스트를 실행하세요.</div></div>`;
    }

    // 테이블
    if(!Array.isArray(rows) || rows.length === 0){
      tbl.innerHTML = `<div style="padding:14px; font-weight:950; color:var(--text-sub);">표시할 결과가 없습니다.</div>`;
      return;
    }

    tbl.innerHTML = `
      <div class="table-wrap">
      <table class="bt-table">
        <thead>
          <tr>
            <th>코인</th>
            <th>전략</th>
            <th>Score</th>
            <th>예측</th>
            <th>승률(추정)</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r=>{
            const best = r.isBest ? `<span class="badge best">BEST</span>` : "";
            const score = Number.isFinite(r.score) ? r.score.toFixed(3) : "0.000";
            const win = Number.isFinite(r.winProb) ? `${Math.round(r.winProb*100)}%` : "-";
            return `
              <tr>
                <td style="font-weight:950;">${r.symbol}</td>
                <td>${tfLabelSafe(r.tfRaw)}${best}</td>
                <td>${score}</td>
                <td style="font-weight:950;">${r.type || "HOLD"}</td>
                <td>${win}</td>
                <td>
                  <button class="btn small" onclick="openPredictionFromBacktest('${r.symbol}','${r.tfRaw}')">보기</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      </div>
    `;
  }

  window.openPredictionFromBacktest = function(symbol, tfRaw){
    try{
      const full = state?.lastBacktestFull;
      const rows = full?.rows || [];
      const row = rows.find(x => x.symbol === symbol && String(x.tfRaw) === String(tfRaw));
      if(!row){
        toast("해당 백테스트 결과를 찾지 못했습니다.", "warn");
        return;
      }
      if(typeof showResultModal === "function"){
        showResultModal(symbol, row);
      }else{
        toast("예측 모달 함수(showResultModal)가 없습니다.", "danger");
      }
    }catch(e){
      console.error(e);
      toast("보기 실행 중 오류", "danger");
    }
  };

  /* -----------------------------
     ✅ 통합 예측(6전략) — predboost 포함
     - 60코인 전체 자동스캔은 autoScanUniverseAll
     - 여기 버튼(통합 예측)은 '현재 선택된 코인 1개'를 6전략으로 동시에 평가
  ----------------------------- */
  window.executeAnalysisAll = async function(){
    ensureRuntimeState();

    const btn = $("analyze-btn");
    if(btn){
      btn.disabled = true;
      btn.textContent = "통합 예측중...";
    }

    try{
      const symbol = state.symbol || "BTCUSDT";
      const tfs = (Array.isArray(window.STRATEGY_TFS) && window.STRATEGY_TFS.length) ? window.STRATEGY_TFS : ["15","30","60","240","D","W"];

      // 필요한 TF들 한번에 모아서 fetch (중복 제거)
      const need = new Set();
      // 60은 3TF(60/240/D)로 강화
      tfs.forEach(tf=>{
        const t = String(tf);
        if(t === "60"){
          ["60","240","D"].forEach(x=>need.add(x));
        }else if(t === "240"){
          ["240","D"].forEach(x=>need.add(x));
        }else if(t === "D"){
          ["D","W"].forEach(x=>need.add(x));
        }else if(t === "W"){
          ["W","D"].forEach(x=>need.add(x));
        }else if(t === "15"){
          ["15","30"].forEach(x=>need.add(x));
        }else if(t === "30"){
          ["30","60"].forEach(x=>need.add(x));
        }else{
          need.add(t);
        }
      });

      const limitFor = (tfRaw)=>{
        const t = String(tfRaw);
        if(t === "15") return 520;
        if(t === "30") return 520;
        if(t === "60") return 420;
        if(t === "240") return 360;
        if(t === "D") return 260;
        if(t === "W") return 260;
        return 320;
      };

      const candlesAll = {};
      for(const tf of Array.from(need)){
        candlesAll[tf] = await fetchCandles(symbol, tf, limitFor(tf));
      }

      const posMap = {};
      for(const tfRaw of tfs){
        const t = String(tfRaw);
        let byTf = {};
        let mode = "2TF";
        if(t === "60"){
          mode = "3TF";
          byTf = { "60": candlesAll["60"], "240": candlesAll["240"], "D": candlesAll["D"] };
        }else if(t === "240"){
          byTf = { "240": candlesAll["240"], "D": candlesAll["D"] };
        }else if(t === "D"){
          byTf = { "D": candlesAll["D"], "W": candlesAll["W"] };
        }else if(t === "W"){
          byTf = { "W": candlesAll["W"], "D": candlesAll["D"] };
        }else if(t === "15"){
          byTf = { "15": candlesAll["15"], "30": candlesAll["30"] };
        }else if(t === "30"){
          byTf = { "30": candlesAll["30"], "60": candlesAll["60"] };
        }else{
          byTf = { [t]: candlesAll[t] };
        }

        let sig = null;
        try{
          sig = buildSignalFromCandles_MTF(symbol, t, byTf, mode);
        }catch(e){
          console.error("buildSignalFromCandles_MTF error:", e);
        }
        if(sig) posMap[t] = sig;
      }

      if(typeof showResultModalAll === "function"){
        showResultModalAll(symbol, posMap);
      }else{
        toast("통합 예측 모달(showResultModalAll)이 없습니다.", "danger");
      }

    }catch(e){
      console.error(e);
      toast("통합 예측 중 오류가 발생했습니다.", "danger");
    }finally{
      if(btn){
        btn.disabled = false;
        btn.textContent = "통합 예측(6전략) 실행";
      }
    }
  };

  // "AI 추천 60 (즉시 스캔)" 버튼은 실사용상 autoScanUniverseAll로 통일
  window.quickAnalyzeAllAndShow = async function(){
    try{
      if(typeof refreshUniverseAndGlobals === "function"){
        await refreshUniverseAndGlobals();
      }
      openScanModal();
      await autoScanUniverseAll();
    }catch(e){
      console.error(e);
      toast("즉시 스캔 중 오류", "danger");
    }
  };

  /* -----------------------------
     ✅ Backtest 실행 (60코인×6전략) — 오류 없는 버전으로 재정의
     - 진행상황은 bt-modal 내부에 표시
     - 승률은 "확신 점수 상위 구간 자동 선택"으로 65% 목표 설계
  ----------------------------- */
  window.runBacktestAll = async function(){
    ensureRuntimeState();

    openBacktestModal();

    const startBtn = $("bt-start-btn");
    if(startBtn){
      startBtn.disabled = true;
      startBtn.textContent = "백테스트 진행중...";
    }

    const opToken = beginOperation();

    try{
      const tfs = (Array.isArray(window.STRATEGY_TFS) && window.STRATEGY_TFS.length) ? window.STRATEGY_TFS : ["15","30","60","240","D","W"];
      const symbols = (state.universe || []).map(x=>x.s).slice(0,60);

      backtestProgress = { running:true, percent:0, step:0, total: symbols.length * tfs.length, current:"시작..." };
      renderBacktestModal();

      const limitFor = (tfRaw)=>{
        const t = String(tfRaw);
        if(t === "15") return 520;
        if(t === "30") return 520;
        if(t === "60") return 420;
        if(t === "240") return 360;
        if(t === "D") return 260;
        if(t === "W") return 260;
        return 320;
      };

      const allRows = [];
      const bestByCoin = {};

      let step = 0;
      const total = symbols.length * tfs.length;

      for(const sym of symbols){
        const candlesCache = {};
        for(const tfRaw of tfs){
          checkCanceled(opToken);
          step += 1;

          backtestProgress.step = step;
          backtestProgress.total = total;
          backtestProgress.percent = step / total;
          backtestProgress.current = `${sym} • ${tfLabelSafe(tfRaw)}`;
          renderBacktestModal();

          try{
            // 필요한 TF 확보(각 coin별 캐시)
            const t = String(tfRaw);
            const need = new Set();
            if(t === "60"){ ["60","240","D"].forEach(x=>need.add(x)); }
            else if(t === "240"){ ["240","D"].forEach(x=>need.add(x)); }
            else if(t === "D"){ ["D","W"].forEach(x=>need.add(x)); }
            else if(t === "W"){ ["W","D"].forEach(x=>need.add(x)); }
            else if(t === "15"){ ["15","30"].forEach(x=>need.add(x)); }
            else if(t === "30"){ ["30","60"].forEach(x=>need.add(x)); }
            else need.add(t);

            for(const tf of Array.from(need)){
              if(!candlesCache[tf]){
                candlesCache[tf] = await fetchCandles(sym, tf, limitFor(tf));
                await sleepCancelable(20, opToken);
              }
            }

            let byTf = {};
            let mode = "2TF";
            if(t === "60"){
              mode = "3TF";
              byTf = { "60": candlesCache["60"], "240": candlesCache["240"], "D": candlesCache["D"] };
            }else if(t === "240"){
              byTf = { "240": candlesCache["240"], "D": candlesCache["D"] };
            }else if(t === "D"){
              byTf = { "D": candlesCache["D"], "W": candlesCache["W"] };
            }else if(t === "W"){
              byTf = { "W": candlesCache["W"], "D": candlesCache["D"] };
            }else if(t === "15"){
              byTf = { "15": candlesCache["15"], "30": candlesCache["30"] };
            }else if(t === "30"){
              byTf = { "30": candlesCache["30"], "60": candlesCache["60"] };
            }

            const sig = buildSignalFromCandles_MTF(sym, t, byTf, mode);
            const score = Number(sig?.explain?.score ?? sig?.score ?? 0);
            const winProb = Number(sig?.explain?.winProb ?? sig?.winProb ?? 0);
            const type = sig?.type || "HOLD";

            const row = {
              symbol: sym,
              tfRaw: t,
              type,
              score,
              winProb,
              isBest:false,
              entry: sig?.entry ?? null,
              tp: sig?.tp ?? null,
              sl: sig?.sl ?? null,
              tpPct: sig?.tpPct ?? null,
              slPct: sig?.slPct ?? null,
              explain: sig?.explain || {}
            };

            allRows.push(row);

            // BEST 선정: winProb 우선, 동률이면 score
            const cur = bestByCoin[sym];
            if(!cur){
              bestByCoin[sym] = row;
            }else{
              const a = Number(cur.winProb || 0);
              const b = Number(row.winProb || 0);
              if(b > a + 1e-9) bestByCoin[sym] = row;
              else if(Math.abs(b - a) < 1e-9 && Number(row.score||0) > Number(cur.score||0)) bestByCoin[sym] = row;
            }

          }catch(e){
            console.error("backtest step error:", e);
          }
        }
      }

      // BEST 플래그 반영
      Object.keys(bestByCoin).forEach(sym=>{
        const best = bestByCoin[sym];
        if(best) best.isBest = true;
      });

      // ✅ 65% 목표: "확신 점수 상위 구간" 자동 선택
      const rawCandidates = allRows.filter(r => (r.type === "LONG" || r.type === "SHORT") && Number.isFinite(r.winProb));
      rawCandidates.sort((a,b)=>{
        const aw = Number(a.winProb||0), bw = Number(b.winProb||0);
        if(bw !== aw) return bw - aw;
        return Number(b.score||0) - Number(a.score||0);
      });

      // 선택 개수를 늘리며 목표 승률(추정) 도달하려고 시도
      const TARGET = 0.65;
      let selected = [];
      let selWin = 0;
      for(let n=10; n<=rawCandidates.length; n+=5){
        const slice = rawCandidates.slice(0,n);
        const avg = slice.reduce((s,x)=>s+Number(x.winProb||0),0) / Math.max(1, slice.length);
        selected = slice;
        selWin = avg;
        if(avg >= TARGET) break;
      }

      const rawWin = rawCandidates.reduce((s,x)=>s+Number(x.winProb||0),0) / Math.max(1, rawCandidates.length);

      state.lastBacktestFull = {
        ts: Date.now(),
        viewMode: backtestViewMode || "BEST",
        rows: allRows,
        summary: {
          target: TARGET,
          selectedWinRate: selWin,
          selectedTrades: selected.length,
          rawWinRate: rawWin,
          rawTrades: rawCandidates.length,
          bestCount: Object.keys(bestByCoin).length
        }
      };
      state.lastBacktestAt = state.lastBacktestFull.ts;

      saveState();
      renderBacktestModal();
      toast("통합 백테스트 완료", "success");

    }catch(e){
      if(String(e?.message || "").includes("cancelled")){
        toast("백테스트가 취소되었습니다.", "warn");
      }else{
        console.error(e);
        toast("백테스트 중 오류가 발생했습니다.", "danger");
      }
    }finally{
      backtestProgress = { running:false, percent:0, step:0, total:0, current:"" };
      try{ endOperation(opToken); }catch(e){}
      try{ renderBacktestModal(); }catch(e){}
      if(startBtn){
        startBtn.disabled = false;
        startBtn.textContent = "60코인 전체 백테스트 시작";
      }
    }
  };

  /* -----------------------------
     ✅ 전체 초기화: 스캔/백테스트 포함 (DOM/키 정합)
  ----------------------------- */
  window.resetAll = async function(){
    ensureRuntimeState();
    if(!requirePin("전체 초기화")) return;

    try{ cancelOperation(); }catch(e){}
    try{ closeModal(); }catch(e){}
    try{ closeScanModal(); }catch(e){}
    try{ closeBacktestModal(); }catch(e){}
    try{ closeSyncModal(); }catch(e){}

    state.history = { total: 0, win: 0 };
    state.closedTrades = [];
    state.activePositions = [];
    state.lastSignalAt = {};
    state.lastScanResults = [];
    state.lastScanAt = 0;
    state.lastScanFull = { ts:0, viewMode:"BEST", bestRows:[], allRows:[] };
    state.lastBacktestAt = 0;
    state.lastBacktestFull = { ts:0, viewMode:"BEST", rows:[], summary:null };

    saveState();

    try{ renderTrackingList(); }catch(e){}
    try{ renderClosedTrades(); }catch(e){}
    try{ renderScanResults(); }catch(e){}
    try{ updateStatsUI(); }catch(e){}
    try{ updateStrategyCountUI(); }catch(e){}
    try{ updateCountdownTexts(); }catch(e){}
    try{ renderScanModal(); }catch(e){}
    try{ renderBacktestModal(); }catch(e){}

    toast("전체 초기화 완료 (누적/추적/스캔/백테스트)", "success");
  };

  /* -----------------------------
     ✅ PC↔모바일 동기화 (내보내기/가져오기)
  ----------------------------- */
  window.openSyncModal = function(){
    const m = $("sync-modal");
    if(!m) return;
    m.style.display = "flex";
    try{ exportSyncCode(); }catch(e){}
  };

  window.closeSyncModal = function(){
    const m = $("sync-modal");
    if(!m) return;
    m.style.display = "none";
  };

  function b64EncodeUnicode(str){
    try{
      return btoa(unescape(encodeURIComponent(str)));
    }catch(e){
      // fallback
      return btoa(str);
    }
  }
  function b64DecodeUnicode(str){
    try{
      return decodeURIComponent(escape(atob(str)));
    }catch(e){
      return atob(str);
    }
  }

  window.exportSyncCode = function(){
    ensureRuntimeState();
    const ta = $("sync-export");
    if(!ta) return;

    const payload = {
      v: 1,
      ts: Date.now(),
      state: state
    };
    const json = JSON.stringify(payload);
    const code = b64EncodeUnicode(json);
    ta.value = code;
    toast("내보내기 코드 생성 완료", "success");
  };

  window.copySyncCode = async function(){
    const ta = $("sync-export");
    if(!ta) return;
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    try{
      await navigator.clipboard.writeText(ta.value);
      toast("복사 완료", "success");
    }catch(e){
      // 일부 브라우저 fallback
      try{
        document.execCommand("copy");
        toast("복사 완료", "success");
      }catch(err){
        toast("복사 실패(수동으로 복사해주세요)", "warn");
      }
    }
  };

  window.clearSyncImport = function(){
    const ta = $("sync-import");
    if(ta) ta.value = "";
  };

  window.importSyncCode = function(){
    ensureRuntimeState();

    const ta = $("sync-import");
    if(!ta) return;

    const code = String(ta.value || "").trim();
    if(!code){
      toast("가져오기 코드가 비었습니다.", "warn");
      return;
    }

    try{
      const json = b64DecodeUnicode(code);
      const payload = JSON.parse(json);

      if(!payload || typeof payload !== "object" || !payload.state){
        toast("코드 형식이 올바르지 않습니다.", "danger");
        return;
      }

      // 주의: 상태 구조는 core에서 보정함
      state = payload.state;

      try{
        if(typeof ensureCoreStateShape === "function") ensureCoreStateShape();
      }catch(e){}

      try{ saveState(); }catch(e){}

      try{ initChart(); }catch(e){}
      try{ renderUniverseList(); }catch(e){}
      try{ renderTrackingList(); }catch(e){}
      try{ renderClosedTrades(); }catch(e){}
      try{ renderScanResults(); }catch(e){}
      try{ updateStatsUI(); }catch(e){}
      try{ updateCountdownTexts(); }catch(e){}
      try{ renderScanModal(); }catch(e){}
      try{ renderBacktestModal(); }catch(e){}

      toast("동기화 적용 완료", "success");
      closeSyncModal();

    }catch(e){
      console.error(e);
      toast("가져오기 중 오류(코드 확인 필요)", "danger");
    }
  };

  /* -----------------------------
     DOM 바인딩 (버튼 무반응 방지)
  ----------------------------- */
  // expose renderers so existing code paths (autoScan/backtest) always hit the fixed DOM mapping
  window.renderScanModal = renderScanModal;
  window.renderBacktestModal = renderBacktestModal;

  document.addEventListener("DOMContentLoaded", ()=>{
    try{
      const st = $("scan-toggle-view");
      if(st) st.addEventListener("click", window.toggleScanView);

      const bt = $("bt-toggle-view");
      if(bt) bt.addEventListener("click", window.toggleBacktestView);
    }catch(e){}
  });

  // HTML에서 직접 호출되는 함수들을 확실히 window에 바인딩
  window.setTF = window.setTF || setTF;
  window.switchCoin = window.switchCoin || switchCoin;
  window.tryAuth = window.tryAuth || tryAuth;
  window.confirmTrack = window.confirmTrack || confirmTrack;
  window.confirmTrackSelected = window.confirmTrackSelected || confirmTrackSelected;
  window.closeModal = window.closeModal || closeModal;

  window.autoScanUniverseAll = window.autoScanUniverseAll || autoScanUniverseAll;
  window.cancelOperation = window.cancelOperation || cancelOperation;

  window.resetStatsUIAndData = window.resetStatsUIAndData || resetStatsUIAndData;
  window.cancelAllTracking = window.cancelAllTracking || cancelAllTracking;

})();
