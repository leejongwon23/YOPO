/*************************************************************
 * YOPO AI PRO — app.api.js (분할 v1)
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

/* =========================
   Universe + Dominance
========================= */
async function refreshUniverseAndGlobals(){
  const apiDot = document.getElementById("api-dot");
  try{
    const g = await fetchJSON(CG_GLOBAL, { timeoutMs: 6000, retry: 1 });
    const dom = g?.data?.market_cap_percentage?.btc;
    if(typeof dom === "number"){
      state.btcDomPrev = (typeof state.btcDom === "number") ? state.btcDom : null;
      state.btcDom = dom;

      const pill = document.getElementById("btc-dom-pill");
      if(pill) pill.innerText = `BTC DOM: ${dom.toFixed(1)}%`;
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

    const tsEl = document.getElementById("universe-ts");
    if(tsEl) tsEl.innerText = `업데이트: ${new Date(state.lastUniverseAt).toLocaleTimeString()}`;

    if(apiDot) apiDot.className = "status-dot ok";

    // UI 렌더는 features에 있을 수 있음(호출 시점에 존재하면 OK)
    if(typeof renderUniverseList === "function") renderUniverseList();
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
      if(!symbols.has(t.symbol)) continue;

      const price = parseFloat(t.lastPrice || "0");
      const chg = parseFloat(t.price24hPcnt || "0") * 100;

      if(price > 0){
        // updateCoinRow / trackPositions는 features에 있어도 OK
        if(typeof updateCoinRow === "function") updateCoinRow(t.symbol, price, chg);
        state.lastPrices[t.symbol] = { price, chg, ts: Date.now() };
      }

      // ✅ 유니버스 전체가 아니라 "활성 추적 심볼"만 추적 업데이트
      if(price > 0 && activeSymbols.has(t.symbol) && typeof trackPositions === "function"){
        trackPositions(t.symbol, price);
      }
    }

    // ✅ 핵심 안정장치:
    // - 카운트다운이 0이 되어도 TIME 정산이 안 돌면 통계/히스토리/추적수가 갱신 안 됨
    // - marketTick은 "확실한 주기"이므로 여기서 한 번 더 정산/통계 갱신을 보장
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
