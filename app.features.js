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
   TIME 만료 정산 (MFE 반영) + 비용 반영
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

    const lastPrice = Number.isFinite(pos.lastPrice) ? pos.lastPrice : pos.entry;

    // 최종 pnl (NET)
    let pnlGross = 0;
    if(pos.type === "LONG"){
      pnlGross = ((lastPrice - pos.entry) / pos.entry) * 100;
    }else{
      pnlGross = ((pos.entry - lastPrice) / pos.entry) * 100;
    }
    const pnl = pnlGross - FEE_PCT;
    pos.pnl = pnl;

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
        reason = "TIME_MFE";
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
      `[${pos.symbol} ${pos.tf}] 시간 종료: ${win ? "성공" : "실패"} (${reason}) / 수익률 ${pnl.toFixed(2)}%${extra} (비용 -${FEE_PCT.toFixed(2)}%)`,
      win ? "success" : "danger"
    );
  }

  if(changed){
    saveState();
    renderTrackingList();
    renderClosedTrades();
    updateStatsUI();
  }
}

/* ==========================================================
   Boot
   ========================================================== */
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

  ensureToastUI();

  // 마이그레이션(만료/슬tp/mfe)
  ensureExpiryOnAllPositions();

  initChart();
  renderUniverseList();
  renderTrackingList();
  renderClosedTrades();
  updateStatsUI();
  renderScanResults();

  ensureStrategyCountUI();
  updateStrategyCountUI();

  await refreshUniverseAndGlobals();
  await marketTick();

  setInterval(marketTick, 2000);
  setInterval(refreshUniverseAndGlobals, 60000);

  setInterval(() => {
    if(!state.activePositions?.length) return;
    updateCountdownTexts();
    settleExpiredPositions();
  }, 1000);
});

/* ==========================================================
   UI 기본 (TF/코인)
   ========================================================== */

// ✅ 호환 강화: btn이 없어도 동작
function setTF(tf, btn){
  state.tf = tf;

  const btns = Array.from(document.querySelectorAll(".tf-btn"));
  btns.forEach(b => b.classList.remove("active"));

  if(btn && btn.classList){
    btn.classList.add("active");
  }else{
    // btn이 없을 때: tf 값으로 버튼을 찾아 활성화
    const mapIdx = (tf === "60") ? 0 : (tf === "240") ? 1 : 2;
    if(btns[mapIdx]) btns[mapIdx].classList.add("active");
  }

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

    // 캐시 가격 표시
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
    if(isInCooldown(dupKey)){
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
  try{
    // TF 버튼 반영
    const btns = document.querySelectorAll(".tf-btn");
    btns.forEach(b => b.classList.remove("active"));
    if(tfRaw === "60") btns[0]?.classList.add("active");
    else if(tfRaw === "240") btns[1]?.classList.add("active");
    else btns[2]?.classList.add("active");
    state.tf = tfRaw;

    // 코인 반영
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
  const modal = document.getElementById("result-modal");
  if(modal) modal.style.display = "none";
  tempPos = null;
}

function confirmTrack(){
  if(!tempPos) return;
  if(tempPos.type === "HOLD") return;

  if(hasActivePosition(tempPos.symbol, tempPos.tfRaw)){
    toast("이미 같은 코인/같은 기간의 추적 포지션이 있습니다.", "warn");
    return;
  }

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
  updateCountdownTexts();
}

/* ==========================================================
   Tracking
   ========================================================== */
function trackPositions(symbol, currentPrice){
  let changed = false;

  for(let i = state.activePositions.length - 1; i >= 0; i--){
    const pos = state.activePositions[i];
    if(pos.symbol !== symbol) continue;

    pos.lastPrice = currentPrice;

    // pnl (NET)
    let pnlGross = 0;
    if(pos.type === "LONG"){
      pnlGross = ((currentPrice - pos.entry) / pos.entry) * 100;
    }else{
      pnlGross = ((pos.entry - currentPrice) / pos.entry) * 100;
    }
    const pnl = pnlGross - FEE_PCT;
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
      state.history.total++;
      if(win) state.history.win++;

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

/* ==========================================================
   Closed trades + stats
   ========================================================== */
function renderClosedTrades(){
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
  const scanBtn = document.getElementById("scan-btn");
  const status = document.getElementById("scan-status");
  if(scanBtn) scanBtn.disabled = true;
  if(status) status.textContent = "스캔 중...";

  try{
    const results = [];

    // 속도: 2TF
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

/* ==========================================================
   Backtest
   ========================================================== */
async function runBacktest(){
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
        `${state.symbol} · ${tfNameShow} · 최근 ${EXTENDED_LIMIT}캔들 (필터: 확률≥${Math.round(BT_MIN_PROB*100)}%, 엣지≥${Math.round(BT_MIN_EDGE*100)}%, 유사도≥${BT_MIN_SIM}%) · MTF(2TF) · CONF(TP/SL 조정) · 비용 -${FEE_PCT.toFixed(2)}% 반영`;
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
      if(hi >= pos.tp){
        const pnl = ((pos.tp - pos.entry)/pos.entry)*100 - FEE_PCT;
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
