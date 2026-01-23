/*************************************************************
 * YOPO AI PRO — app.api.js (분할 v1)  ✅ UPDATED
 * 역할: 외부 API 통신 + 데이터 로딩(유니버스/도미넌스/티커/캔들)
 * 주의:
 * - UI 업데이트 함수(updateCoinRow/renderUniverseList/trackPositions/switchCoin 등)는
 *   app.features.js에 있어도 OK. (호출 시점에 정의돼 있으면 동작)
 *************************************************************/

/* =========================
   ✅ Safety helpers (폴백)
   - safeLog10이 없으면 유니버스/스코어 계산이 터짐 → 전체 갱신 멈춤 원인
========================= */
const safeLog10 = (typeof window !== "undefined" && typeof window.safeLog10 === "function")
  ? window.safeLog10
  : function(x){
      const v = Number(x);
      if(!Number.isFinite(v) || v <= 0) return 0;
      return Math.log10(v);
    };

function _isBadUniverseSymbol(sym){
  const s = String(sym || "").toUpperCase();
  // 스테이블/래핑/미러/레버리지 등 잡음 최소 필터(가벼운 수준)
  if(!s.endsWith("USDT")) return true;
  if(s.includes("USD") && !s.endsWith("USDT")) return true;
  if(s.includes("USDC") || s.includes("TUSD") || s.includes("BUSD") || s.includes("DAI")) return true;
  if(s.includes("3L") || s.includes("3S") || s.includes("5L") || s.includes("5S")) return true;
  if(s.includes("BULL") || s.includes("BEAR")) return true;
  return false;
}

/* =========================
   Universe + Dominance
========================= */
async function refreshUniverseAndGlobals(){
  const apiDot = document.getElementById("api-dot");

  try{
    // 1) BTC 도미넌스
    const g = await fetchJSON(CG_GLOBAL, { timeoutMs: 6000, retry: 1 });
    const dom = g?.data?.market_cap_percentage?.btc;
    if(typeof dom === "number"){
      state.btcDomPrev = (typeof state.btcDom === "number") ? state.btcDom : null;
      state.btcDom = dom;

      const pill = document.getElementById("btc-dom-pill");
      if(pill) pill.innerText = `BTC DOM: ${dom.toFixed(1)}%`;
    }

    // 2) Bybit 심볼 목록(교차 검증용)
    const by = await fetchJSON(BYBIT_TICKERS, { timeoutMs: 7000, retry: 1 });
    const tickers = by?.result?.list || [];
    const bybitSet = new Set(
      tickers
        .map(t => String(t.symbol || "").toUpperCase())
        .filter(s => s && s.endsWith("USDT") && !_isBadUniverseSymbol(s))
    );

    // 3) CoinGecko 마켓(상위 200)
    const markets = await fetchJSON(CG_MARKETS, { timeoutMs: 7000, retry: 1 });

    // 점수 산정: 시총 + 거래량 + 변동성(24h) 가벼운 가중치
    const scored = (Array.isArray(markets) ? markets : [])
      .map(m => {
        const mc = m?.market_cap ?? 0;
        const vol = m?.total_volume ?? 0;
        const chg = m?.price_change_percentage_24h ?? 0;

        const cgSym = String(m?.symbol || "").toUpperCase();
        const sym = cgSym ? (cgSym + "USDT") : "";

        // Bybit에서 실제로 거래 가능한 것만
        if(!sym || !bybitSet.has(sym)) return null;
        if(_isBadUniverseSymbol(sym)) return null;

        const score =
          safeLog10(mc) * 0.48 +
          safeLog10(vol) * 0.42 +
          Math.min(Math.abs(chg), 20) * 0.10;

        return {
          s: sym,
          n: m?.name || cgSym || sym.replace("USDT",""),
          cg: m?.id || null,
          mc, vol, chg,
          score
        };
      })
      .filter(Boolean)
      .sort((a,b)=> b.score - a.score);

    // ✅ 30개 자동 선정
    const picked = scored.slice(0, 30);

    // 예외: 교차검증 결과가 너무 적으면(예: 제한/장애) 기존 후보 + Bybit fallback로 보강
    if(picked.length < 18){
      console.warn("CG/Bybit cross universe too small -> fallback merge");
      await fallbackUniverseFromBybit(); // 여기서 state.universe 세팅
    }else{
      state.universe = picked;
      state.lastUniverseAt = Date.now();
      state.lastApiHealth = "ok";
      saveState();

      const tsEl = document.getElementById("universe-ts");
      if(tsEl) tsEl.innerText = `업데이트: ${new Date(state.lastUniverseAt).toLocaleTimeString()}`;

      if(apiDot) apiDot.className = "status-dot ok";

      if(typeof renderUniverseList === "function") renderUniverseList();
    }
  }catch(e){
    console.warn("CoinGecko unavailable -> fallback to Bybit universe", e);
    if(apiDot) apiDot.className = "status-dot warn";
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
        const symbol = String(t.symbol || "").toUpperCase();
        const last = parseFloat(t.lastPrice || "0");
        const chg = parseFloat(t.price24hPcnt || "0") * 100;
        const turn =
          parseFloat(t.turnover24h || "0") ||
          parseFloat(t.turnover || "0") ||
          parseFloat(t.volume24h || "0") ||
          parseFloat(t.volume || "0") || 0;
        return { symbol, last, chg, turn };
      })
      .filter(x => x.symbol && x.symbol.endsWith("USDT") && x.last > 0 && !_isBadUniverseSymbol(x.symbol));

    rows.sort((a,b)=> (b.turn - a.turn));
    const top = rows.slice(0, 120);

    // ✅ 30개로 확대
    const picked = [];
    for(const r of top){
      if(picked.length >= 30) break;
      if(picked.some(x=>x.s===r.symbol)) continue;
      picked.push({
        s: r.symbol,
        n: r.symbol.replace("USDT",""),
        cg: null,
        chg: r.chg,
        turn: r.turn,
        score: safeLog10(r.turn)
      });
    }

    state.universe = picked.slice(0, 30);
    state.lastUniverseAt = Date.now();
    saveState();

    const tsEl = document.getElementById("universe-ts");
    if(tsEl) tsEl.innerText = `업데이트: ${new Date(state.lastUniverseAt).toLocaleTimeString()}`;

    if(typeof renderUniverseList === "function") renderUniverseList();
  }catch(e){
    console.error("Bybit fallback universe failed:", e);
  }
}

/* =========================
   Market tick + tracking
========================= */
async function marketTick(){
  try{
    // ✅ 방어: lastPrices 없으면 초기화
    if(!state.lastPrices || typeof state.lastPrices !== "object"){
      state.lastPrices = {};
    }

    const json = await fetchJSON(BYBIT_TICKERS, { timeoutMs: 7000, retry: 1 });
    const tickers = json?.result?.list || [];

    const uni = Array.isArray(state.universe) ? state.universe : [];
    const symbols = new Set(uni.map(x => x.s));

    // ✅ 핵심 최적화: "실제로 추적 중인 심볼"만 trackPositions 호출
    const active = Array.isArray(state.activePositions) ? state.activePositions : [];
    const activeSymbols = new Set(active.map(p => p?.symbol).filter(Boolean));

    for(const t of tickers){
      if(!symbols.has(String(t.symbol || "").toUpperCase())) continue;

      const sym = String(t.symbol || "").toUpperCase();
      const price = parseFloat(t.lastPrice || "0");
      const chg = parseFloat(t.price24hPcnt || "0") * 100;

      if(price > 0){
        if(typeof updateCoinRow === "function") updateCoinRow(sym, price, chg);
        state.lastPrices[sym] = { price, chg, ts: Date.now() };
      }

      if(price > 0 && activeSymbols.has(sym) && typeof trackPositions === "function"){
        trackPositions(sym, price);
      }
    }

    // ✅ 안정장치: TIME 정산/통계 갱신 보장
    if(typeof settleExpiredPositions === "function") settleExpiredPositions();
    if(typeof updateStatsUI === "function") updateStatsUI();

    saveState();

    if(!symbols.has(state.symbol) && uni[0]){
      if(typeof switchCoin === "function") switchCoin(uni[0].s);
    }
  }catch(e){
    console.error("Market tick error:", e);
    const dot = document.getElementById("api-dot");
    if(dot) dot.className = "status-dot bad";
  }
}

/* =========================
   Candle Fetch
========================= */
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
