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
   - 정산/통계가 "조용히" 멈추는 대부분의 원인:
     state.history / state.closedTrades / state.activePositions가 undefined,
     혹은 숫자가 아닌 값으로 들어간 케이스.
   - interval try/catch가 삼켜버리면 UI만 멀쩡하고 통계만 안 바뀜.
   ========================================================== */
function ensureRuntimeState(){
  if(typeof state !== "object" || !state) return;

  if(!Array.isArray(state.activePositions)) state.activePositions = [];
  if(!Array.isArray(state.closedTrades)) state.closedTrades = [];

  if(typeof state.history !== "object" || !state.history){
    state.history = { total: 0, win: 0 };
  }

  // 숫자 방어
  if(!Number.isFinite(state.history.total)) state.history.total = 0;
  if(!Number.isFinite(state.history.win)) state.history.win = 0;

  // universe / lastPrices도 안전망(부트 타이밍에 가끔 undefined)
  if(!Array.isArray(state.universe)) state.universe = [];
  if(typeof state.lastPrices !== "object" || !state.lastPrices) state.lastPrices = {};
}

/* ==========================================================
   ✅ BUGFIX HELPERS
   - pos.id 누락 방지: 카운트다운/부분업데이트가 id 기반이라
     activePositions에 들어가는 순간 id가 반드시 필요함.
   ========================================================== */
function genPosId(){
  // 충분히 유니크한 id (시간 + 랜덤)
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
  // closedTrades는 id가 있긴 하지만, 안전하게
  if(Array.isArray(state.closedTrades)){
    for(const r of state.closedTrades){
      if(!r.id) r.id = Date.now() + Math.floor(Math.random() * 1000);
    }
  }
}

/* ==========================================================
   ✅ NEW (예측 줄이지 않기용)
   - "실패패턴 차단" 때문에 HOLD가 된 경우:
     -> 완전 금지(HOLD) 대신 "RISK"로 보여주고,
        사용자가 원하면 "위험 감안하고 추적 등록" 허용
   ========================================================== */

// ✅ FIX: core가 문구를 "패턴 감점 적용" / "실패패턴 극악(강제 HOLD)"로 쓰므로
// 기존 "실패패턴 차단"만 찾으면 거의 안 걸림 → RISK 로직이 죽음
function isPatternBlockedHold(pos){
  if(!pos || pos.type !== "HOLD") return false;
  const reasons = pos?.explain?.holdReasons || [];
  const text = reasons.map(x=>String(x)).join(" | ");
  return (
    text.includes("실패패턴") ||          // "실패패턴 극악(강제 HOLD)" 등
    text.includes("패턴 감점 적용") ||     // "(패턴 감점 적용: -x%p ...)"
    text.includes("강제 HOLD")            // "강제 HOLD" 직접
  );
}

function buildForcedTrackFromHold(pos){
  // core가 HOLD로 만들어 tp/sl이 null이어도, explain 기반으로 복원해서 "추적 등록"을 가능하게 한다.
  if(!pos || pos.type !== "HOLD") return null;

  const ex = pos.explain || {};
  const symbol = pos.symbol;
  const tfRaw = pos.tfRaw;

  // 방향 추정(코어에서 LONG/SHORT였던 방향)
  const longP = Number(ex.longP ?? 0.5);
  const shortP = Number(ex.shortP ?? 0.5);
  const inferredType = (longP >= shortP) ? "LONG" : "SHORT";

  const entry = Number.isFinite(pos.entry) ? pos.entry : null;
  if(!Number.isFinite(entry) || entry <= 0) return null;

  // ✅ core 상수/테이블이 없을 수 있으니 방어
  const TF_MULT_SAFE = (typeof TF_MULT === "object" && TF_MULT) ? TF_MULT : { "60":1.0, "240":1.15, "D":1.3 };
  const RR_SAFE = (typeof RR === "number" && Number.isFinite(RR)) ? RR : 1.6;
  const TP_MAX_PCT_SAFE = (typeof TP_MAX_PCT === "number" && Number.isFinite(TP_MAX_PCT)) ? TP_MAX_PCT : 6.0;

  // core와 동일한 방식으로 tp/sl 산출(가능한 한 동일)
  const atrUsed = Number(ex.atr ?? 0);
  const tfMult = TF_MULT_SAFE[tfRaw] || 1.2;

  const tpScale = Number(ex?.conf?.tpScale ?? 1.0);
  const rrUsed = Number(ex?.conf?.rrUsed ?? RR_SAFE);

  let tpDist = atrUsed * tfMult * tpScale;
  if(!Number.isFinite(tpDist) || tpDist <= 0){
    // atr 정보가 부족하면 강제추적 불가
    return null;
  }

  // TP 최대 제한(TP_MAX_PCT)도 core와 동일 적용
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

  // sig 생성 (패턴DB 기록 가능하게)
  let sig = null;
  try{
    if(typeof buildPatternSignature === "function"){
      sig = buildPatternSignature(symbol, tfRaw, inferredType, ex);
    }
  }catch(e){}

  // ✅ id 보장 (카운트다운/부분업데이트 필수)
  ensurePosId(pos);

  // 원본 pos를 "강제추적" 가능한 형태로 반환
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
  // "예측을 줄이지 않기" 때문에: 패턴 차단은 제외가 아니라 "감점"으로 후순위
  // 점수 = winProb + edge - penalty
  const w = Number(item.winProb ?? 0);
  const e = Number(item.edge ?? 0);
  const penalty = item.isRisk ? 0.06 : 0.0; // 과격하게 빼지 않음(빈도 유지)
  return (w * 1.0) + (e * 0.7) - penalty;
}

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

/* ==========================================================
   COUNTDOWN 부분 업데이트 + 만료 정산
   ========================================================== */
function updateCountdownTexts(){
  ensureRuntimeState();

  const list = state.activePositions || [];
  if(!list.length) return;

  for(const pos of list){
    // ✅ id 보장
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

  // ✅ 드리프트 보정(0초인데 정산이 안 되는 케이스 방지)
  const DRIFT_MS = 500;

  // ✅ 상수 미정의 방어(정산이 예외로 죽으면 통계 갱신이 멈춤)
  const FEE_SAFE = (typeof FEE_PCT === "number" && Number.isFinite(FEE_PCT)) ? FEE_PCT : 0;
  const TIME_MFE_MIN_SAFE = (typeof TIME_MFE_MIN_PCT === "number" && Number.isFinite(TIME_MFE_MIN_PCT)) ? TIME_MFE_MIN_PCT : 0;
  const TIME_MFE_RATIO_SAFE = (typeof TIME_MFE_TP_RATIO === "number" && Number.isFinite(TIME_MFE_TP_RATIO)) ? TIME_MFE_TP_RATIO : 0;

  for(let i = list.length - 1; i >= 0; i--){
    const pos = list[i];
    ensurePosId(pos);

    const expiryAt = pos.expiryAt || getPosExpiryAt(pos);

    // expiryAt이 NaN이면 즉시 정산(카운트다운 0인데 안 빠지는 케이스 방지)
    if(Number.isFinite(expiryAt)){
      if(now < (expiryAt - DRIFT_MS)) continue;
    }

    const lastPrice = Number.isFinite(pos.lastPrice) ? pos.lastPrice : pos.entry;

    // 최종 pnl (NET)
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

    // ✅ 결과 확정 시: 실패패턴 DB에 누적 기록
    try{ recordTradeToPatternDB(pos, win); }catch(e){}

    // ✅ history 안전 보장
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

    // ✅ UI 갱신 확실화
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

  // ✅ 안전: lastSignalAt 없으면 생성
  if(!state.lastSignalAt || typeof state.lastSignalAt !== "object"){
    state.lastSignalAt = {};
  }

  // auth gate
  try{
    if(!isAuthed()) showAuth();
    else hideAuth();
    document.getElementById("auth-input")?.addEventListener("keydown", (e)=>{
      if(e.key === "Enter") tryAuth();
    });
  }catch(e){}

  try{ ensureToastUI(); }catch(e){}

  // 마이그레이션(만료/슬tp/mfe)
  try{ ensureExpiryOnAllPositions(); }catch(e){}
  try{ ensureIdsOnAllPositions(); saveState(); }catch(e){}

  // ✅ 부트 중 어떤 렌더가 터져도 "인터벌"은 반드시 걸리게 분리
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

  setInterval(marketTick, 2000);
  setInterval(refreshUniverseAndGlobals, 60000);

  // ✅ 핵심: 이게 살아있어야 "시간 종료 → 통계/히스토리 갱신"이 된다
  setInterval(() => {
    try{ ensureRuntimeState(); }catch(e){}
    try{ updateCountdownTexts(); }catch(e){}
    try{ settleExpiredPositions(); }catch(e){}
  }, 1000);
});

/* ==========================================================
   UI 기본 (TF/코인)
   ========================================================== */

// ✅ 호환 강화: btn이 없어도 동작
function setTF(tf, btn){
  ensureRuntimeState();

  state.tf = tf;

  const btns = Array.from(document.querySelectorAll(".tf-btn"));
  btns.forEach(b => b.classList.remove("active"));

  if(btn && btn.classList){
    btn.classList.add("active");
  }else{
    const mapIdx = (tf === "60") ? 0 : (tf === "240") ? 1 : 2;
    if(btns[mapIdx]) btns[mapIdx].classList.add("active");
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
   Core Analysis
   ========================================================== */
async function executeAnalysis(){
  ensureRuntimeState();

  const btn = document.getElementById("predict-btn");
  if(btn){
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 분석 중...';
  }

  try{
    const dupKey = `${state.symbol}|${state.tf}`;

    if(hasActivePosition(state.symbol, state.tf)){
      toast("이미 같은 코인/같은 기간의 추적 포지션이 있습니다. (중복 방지)", "warn");
      return;
    }

    // ✅ FIX: 쿨다운은 "현재 분석 TF"를 기준으로 해야 함
    if(isInCooldown(dupKey, state.tf)){
      toast("너무 자주 신호를 내면 승률이 내려갈 수 있어요. 지금은 쿨다운입니다.", "warn");
      return;
    }

    const tfSet = getMTFSet3();
    const candlesByTf = {};
    for(const tfRaw of tfSet){
      const candles = await fetchCandles(state.symbol, tfRaw, EXTENDED_LIMIT);
      candlesByTf[tfRaw] = candles;
    }

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
    if(btn){
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-microchip"></i> AI 분석 및 예측 실행';
    }
  }
}

// 추천 클릭 → 즉시 분석
async function quickAnalyzeAndShow(symbol, tfRaw){
  ensureRuntimeState();

  try{
    const btns = document.querySelectorAll(".tf-btn");
    btns.forEach(b => b.classList.remove("active"));
    if(tfRaw === "60") btns[0]?.classList.add("active");
    else if(tfRaw === "240") btns[1]?.classList.add("active");
    else btns[2]?.classList.add("active");
    state.tf = tfRaw;

    switchCoin(symbol);
    saveState();
    initChart();

    if(hasActivePosition(symbol, tfRaw)){
      toast("이미 같은 코인/같은 기간의 추적 포지션이 있습니다. (중복 방지)", "warn");
      return;
    }

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

/* ==========================================================
   Modal
   ========================================================== */
function showResultModal(pos){
  ensureRuntimeState();

  // ✅ 패턴차단 HOLD라면: "강제추적 가능"한 포지션을 함께 준비
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
    // ✅ 패턴차단 HOLD면: "RISK 모드"로 보여주고 강제추적 버튼 활성화
    const reasons = (ex.holdReasons || []).map(r => `- ${r}`).join("<br/>");

    if(blockedByPattern && forcePos){
      // 표시용 수치
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

      // ✅ 강제추적 버튼 활성화
      confirmBtn.disabled = false;
      confirmBtn.textContent = "위험 감안하고 추적 등록";
      confirmBtn.onclick = () => confirmTrack(forcePos); // 강제 포지션으로 등록
    }else{
      // 일반 HOLD는 기존대로: 등록 금지
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
      confirmBtn.onclick = () => {}; // 기본
    }
  }else{
    // 일반 LONG/SHORT
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
    confirmBtn.onclick = () => confirmTrack(); // 기본 tempPos로 등록
  }

  modal.style.display = "flex";
}

function closeModal(){
  const modal = document.getElementById("result-modal");
  if(modal) modal.style.display = "none";
  tempPos = null;

  // confirmBtn onclick을 원복해도 되지만, 다음 showResultModal에서 다시 세팅한다.
}

function confirmTrack(forcedPos=null){
  ensureRuntimeState();

  // forcedPos가 있으면 그걸 우선 사용(패턴차단 HOLD override)
  const posToUse = forcedPos || tempPos;
  if(!posToUse) return;

  // ✅ id 보장
  ensurePosId(posToUse);

  // 일반 HOLD는 금지, 단 패턴차단 override는 허용
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
    id: posToUse.id, // ✅ 확실히 유지
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

  // ✅ 상수 미정의 방어
  const FEE_SAFE = (typeof FEE_PCT === "number" && Number.isFinite(FEE_PCT)) ? FEE_PCT : 0;

  for(let i = state.activePositions.length - 1; i >= 0; i--){
    const pos = state.activePositions[i];
    ensurePosId(pos);

    if(pos.symbol !== symbol) continue;

    pos.lastPrice = currentPrice;

    // pnl (NET)
    let pnlGross = 0;
    if(pos.type === "LONG"){
      pnlGross = ((currentPrice - pos.entry) / pos.entry) * 100;
    }else{
      pnlGross = ((pos.entry - currentPrice) / pos.entry) * 100;
    }
    const pnl = pnlGross - FEE_SAFE;
    pos.pnl = pnl;

    // MFE 업데이트 (GROSS 기준)
    const favorable = (pos.type === "LONG")
      ? ((currentPrice - pos.entry) / pos.entry) * 100
      : ((pos.entry - currentPrice) / pos.entry) * 100;

    if(Number.isFinite(favorable)){
      if(typeof pos.mfePct !== "number") pos.mfePct = 0;
      if(favorable > pos.mfePct) pos.mfePct = favorable;
    }

    // 브레이크이븐 + 트레일링
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
      // ✅ 결과 확정 시: 실패패턴 DB에 누적 기록
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
        왼쪽에서 코인을 고르고 “AI 분석”을 눌러보세요.
      </div>
    `;
    return;
  }

  ensureExpiryOnAllPositions();

  // ✅ BUGFIX: 렌더 전에 id 보장
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
   Auto Scan
   ========================================================== */
async function autoScanUniverse(){
  ensureRuntimeState();

  const scanBtn = document.getElementById("scan-btn");
  const status = document.getElementById("scan-status");
  if(scanBtn) scanBtn.disabled = true;
  if(status) status.textContent = "스캔 중...";

  try{
    const results = [];

    const tfSet = getMTFSet2(state.tf);
    const baseTf = tfSet[0];
    const otherTf = tfSet[1];

    for(let i=0;i<state.universe.length;i++){
      const coin = state.universe[i];
      if(status) status.textContent = `스캔 중... (${i+1}/${state.universe.length})`;

      try{
        const cBase = await fetchCandles(coin.s, baseTf, 380);
        if(cBase.length < (SIM_WINDOW + FUTURE_H + 80)) continue;

        const candlesByTf = { [baseTf]: cBase };

        try{
          const cOther = await fetchCandles(coin.s, otherTf, 380);
          candlesByTf[otherTf] = cOther;
        }catch(e){}

        const pos = buildSignalFromCandles_MTF(coin.s, baseTf, candlesByTf, "2TF");

        // ✅ 변경: HOLD라도 "패턴경고 HOLD"면 제외하지 않고 RISK로 포함
        const riskHold = isPatternBlockedHold(pos);

        if(pos.type === "HOLD" && !riskHold) continue;

        // 표시용 타입(리스크 HOLD면 방향 추정)
        const ex = pos.explain || {};
        const inferredType = (Number(ex.longP ?? 0.5) >= Number(ex.shortP ?? 0.5)) ? "LONG" : "SHORT";

        const item = {
          symbol: pos.symbol,
          tf: pos.tf,
          tfRaw: pos.tfRaw,
          type: (pos.type === "HOLD") ? inferredType : pos.type,
          winProb: ex.winProb,
          edge: ex.edge,
          mtfAgree: ex?.mtf?.agree ?? 1,
          mtfVotes: (ex?.mtf?.votes || []).join("/"),
          confTier: ex?.conf?.tier ?? "-",
          isRisk: !!riskHold
        };

        item._score = computeScanScore(item);
        results.push(item);
      }catch(e){}

      await sleep(SCAN_DELAY_MS);
    }

    // ✅ 변경: score 기반 정렬 (risk는 감점으로 후순위)
    results.sort((a,b)=> (b._score - a._score));
    state.lastScanResults = results.slice(0, 6).map(x => {
      const { _score, ...rest } = x;
      return rest;
    });
    state.lastScanAt = Date.now();
    saveState();

    renderScanResults();
    if(status) status.textContent = state.lastScanResults.length ? "완료" : "추천 없음";
  }finally{
    if(scanBtn) scanBtn.disabled = false;
    setTimeout(()=>{
      const el = document.getElementById("scan-status");
      if(el) el.textContent = "대기";
    }, 1500);
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
    const risk = item.isRisk ? ` · <span style="color:var(--danger); font-weight:950;">RISK</span>` : "";

    return `
      <div class="rec-item" onclick="quickAnalyzeAndShow('${item.symbol}','${item.tfRaw}')">
        <div class="rec-left">
          ${item.symbol.replace("USDT","")}
          <span class="pill ${pillClass}">${item.type}</span>
        </div>
        <div class="rec-right">
          성공확률 ${prob}%<br/>
          엣지 ${edge}% · ${item.tf}${mtf}${conf}${risk}
        </div>
      </div>
    `;
  }).join("");
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

  const btBtn = document.getElementById("bt-btn");
  if(btBtn){
    btBtn.disabled = true;
    btBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 백테스트...';
  }

  const box = document.getElementById("bt-box");
  if(box) box.classList.remove("show");

  try{
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
    console.error(e);
    toast("백테스트 중 오류가 발생했습니다.", "danger");
  }finally{
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
window.executeAnalysis = executeAnalysis;
window.autoScanUniverse = autoScanUniverse;
window.runBacktest = runBacktest;
window.confirmTrack = confirmTrack;
window.closeModal = closeModal;
window.quickAnalyzeAndShow = quickAnalyzeAndShow;
