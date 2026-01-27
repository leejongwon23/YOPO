/*************************************************************
 * YOPO AI PRO — app.api.js (분할 v1)  ✅ UPDATED (FIXED+)
 * 역할: 외부 API 통신 + 데이터 로딩(유니버스/도미넌스/티커/캔들)
 * 주의:
 * - UI 업데이트 함수(updateCoinRow/renderUniverseList/trackPositions/switchCoin 등)는
 *   app.features.js에 있어도 OK. (호출 시점에 정의돼 있으면 동작)
 *************************************************************/

/* =========================
   ✅ Core cancel wrappers (core와 연결)
   - core(app.core.js)에 requestCancelOperation/isOperationCancelled 등이 있으면 사용
   - 없으면 "취소 없음"으로 동작(안전)
========================= */
function _getOpToken(){
  try{
    if(state && state.op && Number.isFinite(state.op.token)) return state.op.token;
  }catch(e){}
  return 0;
}
function _isCancelled(token){
  try{
    if(typeof isOperationCancelled === "function") return isOperationCancelled(token);
  }catch(e){}
  // fallback: 취소 없음
  return false;
}
function _ensureApiStateShape(){
  try{
    if(!state || typeof state !== "object") return;
    if(!state.op || typeof state.op !== "object") state.op = { cancel:false, token:0 };
    if(typeof state.op.cancel !== "boolean") state.op.cancel = false;
    if(!Number.isFinite(state.op.token)) state.op.token = 0;

    if(!state.lastPrices || typeof state.lastPrices !== "object") state.lastPrices = {};
    if(!Array.isArray(state.universe)) state.universe = [];
    if(!Array.isArray(state.activePositions)) state.activePositions = [];
    if(!state.history || typeof state.history !== "object") state.history = { total:0, win:0 };
    if(!Number.isFinite(state.history.total)) state.history.total = 0;
    if(!Number.isFinite(state.history.win)) state.history.win = 0;
  }catch(e){}
}

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
  if(s.includes("USDC") || s.includes("TUSD") || s.includes("BUSD") || s.includes("DAI")) return true;
  if(s.includes("3L") || s.includes("3S") || s.includes("5L") || s.includes("5S")) return true;
  if(s.includes("BULL") || s.includes("BEAR")) return true;
  return false;
}

/* =========================
   ✅ Symbol mapping helper
   - CoinGecko 심볼(예: pepe) ↔ Bybit 심볼(예: 1000PEPEUSDT) 불일치 보완
========================= */
function _mapCgToBybitSymbol(cgSymUpper, bybitSet){
  if(!cgSymUpper) return null;

  const direct = `${cgSymUpper}USDT`;
  if(bybitSet.has(direct) && !_isBadUniverseSymbol(direct)) return direct;

  // 자주 쓰는 접두 변형(밈/저가 코인)
  const p1000 = `1000${cgSymUpper}USDT`;
  if(bybitSet.has(p1000) && !_isBadUniverseSymbol(p1000)) return p1000;

  const p100 = `100${cgSymUpper}USDT`;
  if(bybitSet.has(p100) && !_isBadUniverseSymbol(p100)) return p100;

  const p10 = `10${cgSymUpper}USDT`;
  if(bybitSet.has(p10) && !_isBadUniverseSymbol(p10)) return p10;

  return null;
}

/* =========================
   ✅ Universe sizing (자동 + AI 추천)
   - 기본 자동 선정 30 + AI 추천 30 = 총 60
========================= */
// =========================
// ✅ 고정 유니버스 (20개)
// - 통합예측 / 자동스캔 / 백테스트가 '같은 코인 목록'을 사용하게 강제
// - Bybit 불안정/CORS/레이트리밋이면 내부 API 로직에서 Binance로 자동 폴백
// - (요청 폭증) 원인 최소화를 위해 기본 20개로 제한
// =========================
const UNIVERSE_TOTAL_LIMIT = 20;

// 15개 유지 + 5개 추가(추천): ATOM, OP, ARB, SUI, NEAR
// Bybit 선물(USDT Perp)에서 흔히 거래되는 메이저 위주
const FIXED_UNIVERSE_SYMBOLS = [
  "BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","ADAUSDT",
  "BNBUSDT","DOGEUSDT","TRXUSDT","TONUSDT","AVAXUSDT",
  "DOTUSDT","LINKUSDT","MATICUSDT","LTCUSDT","BCHUSDT",
  "ATOMUSDT","OPUSDT","ARBUSDT","SUIUSDT","NEARUSDT"
];

// 유니버스 고정 강제 스위치
const FORCE_FIXED_UNIVERSE = true;

// CoinGecko: 24h + 7d + 30d 변동률까지 받아서 “AI 추천(모멘텀)” 스코어를 만든다.
function _buildCgMarketsUrl(){
  try{
    if(typeof CG_MARKETS === "string" && CG_MARKETS.includes("price_change_percentage=")){
      if(CG_MARKETS.includes("price_change_percentage=24h,7d,30d")) return CG_MARKETS;
      if(CG_MARKETS.includes("price_change_percentage=24h")){
        return CG_MARKETS.replace("price_change_percentage=24h", "price_change_percentage=24h,7d,30d");
      }
      return CG_MARKETS + (CG_MARKETS.includes("?") ? "&" : "?") + "price_change_percentage=24h,7d,30d";
    }
  }catch(e){}
  return "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h,7d,30d";
}

function _getCgPct(m, key){
  const v = m?.[key];
  return (typeof v === "number" && Number.isFinite(v)) ? v : 0;
}

function _momentumScore(m){
  const chg24 = _getCgPct(m, "price_change_percentage_24h");
  const chg7  = _getCgPct(m, "price_change_percentage_7d_in_currency") || _getCgPct(m, "price_change_percentage_7d");
  const chg30 = _getCgPct(m, "price_change_percentage_30d_in_currency") || _getCgPct(m, "price_change_percentage_30d");
  const vol = (m?.total_volume ?? 0);

  const vScore = safeLog10(Math.max(vol, 1));
  const p24 = Math.max(0, Math.min(chg24, 30));
  const p7  = Math.max(0, Math.min(chg7,  50));
  const p30 = Math.max(0, Math.min(chg30, 80));

  // “수익” 확정은 불가 → 여기서는 유동성 + 상승 모멘텀 기준 정렬만 한다.
  return vScore * 0.55 + p7 * 0.25 + p30 * 0.15 + p24 * 0.05;
}

/* =========================
   Universe + Dominance
========================= */
async function refreshUniverseAndGlobals(){
  _ensureApiStateShape();
  const token = _getOpToken(); // ✅ 이 작업 시작 시점 토큰
  const apiDot = document.getElementById("api-dot");

  try{
    if(_isCancelled(token)) return;

    // 1) BTC 도미넌스
    const g = await fetchJSON(CG_GLOBAL, { timeoutMs: 6000, retry: 1 });
    if(_isCancelled(token)) return;

    const dom = g?.data?.market_cap_percentage?.btc;
    if(typeof dom === "number"){
      state.btcDomPrev = (typeof state.btcDom === "number") ? state.btcDom : null;
      state.btcDom = dom;

      const pill = document.getElementById("btc-dom-pill");
      if(pill) pill.innerText = `BTC DOM: ${dom.toFixed(1)}%`;
    }

    // ✅ 고정 유니버스 모드: 외부 API(시장목록) 호출을 최소화해서 안정성 우선
    //    (통합예측/스캔/백테스트 모두 동일한 20개 코인만 사용)
    if(FORCE_FIXED_UNIVERSE){
      const fixed = FIXED_UNIVERSE_SYMBOLS.slice(0, UNIVERSE_TOTAL_LIMIT).map(sym => {
        const base = sym.replace("USDT", "");
        return { s: sym, n: base, cg: null, mc: null, vol: null, chg: 0, turn: 0, score: 0 };
      });

      state.universe = fixed;
      state._universeMode = "FIXED";
      state._universeUpdatedAt = Date.now();
      saveState();

      if(typeof renderUniverseList === "function") renderUniverseList();
      if(apiDot){ apiDot.style.background = "#00c076"; }
      return;
    }

    // 2) Bybit 심볼 목록(교차 검증용)
    const by = await fetchJSON(BYBIT_TICKERS, { timeoutMs: 7000, retry: 1 });
    if(_isCancelled(token)) return;

    const tickers = by?.result?.list || [];
    const bybitSet = new Set(
      tickers
        .map(t => String(t.symbol || "").toUpperCase())
        .filter(s => s && s.endsWith("USDT") && !_isBadUniverseSymbol(s))
    );

    // 3) CoinGecko 마켓(상위 200)
    //    ✅ 24h + 7d + 30d 변동률까지 받아서 “AI 추천 30종”을 추가 선정
    const marketsUrl = _buildCgMarketsUrl();
    const markets = await fetchJSON(marketsUrl, { timeoutMs: 7000, retry: 1 });
    if(_isCancelled(token)) return;

    // (A) 기본 30개: 시총 + 거래량 + 변동성(24h) 가중치
    const scored = (Array.isArray(markets) ? markets : [])
      .map(m => {
        const mc = m?.market_cap ?? 0;
        const vol = m?.total_volume ?? 0;
        const chg = m?.price_change_percentage_24h ?? 0;

        const cgSym = String(m?.symbol || "").toUpperCase();
        const sym = _mapCgToBybitSymbol(cgSym, bybitSet);

        if(!sym) return null;
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
          turn: vol,
          score
        };
      })
      .filter(Boolean)
      .sort((a,b)=> b.score - a.score);

    const basePicked = scored.slice(0, UNIVERSE_BASE_LIMIT);
    const exclude = new Set(basePicked.map(x => x.s));

    // (B) AI 추천 30개: 유동성 + 상승 모멘텀(24h/7d/30d) 기준
    const aiCandidates = (Array.isArray(markets) ? markets : [])
      .map(m => {
        const vol = m?.total_volume ?? 0;
        const cgSym = String(m?.symbol || "").toUpperCase();
        const sym = _mapCgToBybitSymbol(cgSym, bybitSet);

        if(!sym) return null;
        if(_isBadUniverseSymbol(sym)) return null;
        if(exclude.has(sym)) return null;

        // 최소 유동성(USD) 필터: 너무 작은 코인 잡음 방지
        if(!(vol > 5_000_000)) return null;

        const aiScore = _momentumScore(m);
        if(!(aiScore > 0)) return null;

        return {
          s: sym,
          n: m?.name || cgSym || sym.replace("USDT",""),
          cg: m?.id || null,
          mc: m?.market_cap ?? 0,
          vol,
          chg: (typeof m?.price_change_percentage_24h === "number") ? m.price_change_percentage_24h : 0,
          chg7: _getCgPct(m, "price_change_percentage_7d_in_currency") || _getCgPct(m, "price_change_percentage_7d"),
          chg30: _getCgPct(m, "price_change_percentage_30d_in_currency") || _getCgPct(m, "price_change_percentage_30d"),
          turn: vol,
          ai: true,
          aiScore
        };
      })
      .filter(Boolean)
      .sort((a,b)=> b.aiScore - a.aiScore);

    let aiPicked = [];
    for(const c of aiCandidates){
      if(_isCancelled(token)) return;
      if(aiPicked.length >= UNIVERSE_AI_EXTRA) break;
      if(exclude.has(c.s)) continue;
      exclude.add(c.s);
      aiPicked.push(c);
    }

    // (C) AI 30개가 부족하면: scored(남은 후보)로 채우기
    if(aiPicked.length < UNIVERSE_AI_EXTRA){
      for(const c of scored){
        if(_isCancelled(token)) return;
        if(aiPicked.length >= UNIVERSE_AI_EXTRA) break;
        if(exclude.has(c.s)) continue;
        exclude.add(c.s);
        aiPicked.push({ ...c, ai: true, aiScore: null });
      }
    }

    // (D) 그래도 부족하면: Bybit 거래대금 상위로 마지막 보강
    if(aiPicked.length < UNIVERSE_AI_EXTRA){
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
        .filter(x => x.symbol && x.symbol.endsWith("USDT") && x.last > 0 && !_isBadUniverseSymbol(x.symbol))
        .sort((a,b)=> (b.turn - a.turn));

      for(const r of rows){
        if(_isCancelled(token)) return;
        if(aiPicked.length >= UNIVERSE_AI_EXTRA) break;
        if(exclude.has(r.symbol)) continue;
        exclude.add(r.symbol);
        aiPicked.push({
          s: r.symbol,
          n: r.symbol.replace("USDT",""),
          cg: null,
          chg: r.chg,
          turn: r.turn,
          mc: null,
          vol: null,
          ai: true,
          aiScore: safeLog10(r.turn)
        });
      }
    }

    const picked = basePicked.concat(aiPicked).slice(0, UNIVERSE_TOTAL_LIMIT);

    // 예외: 너무 적으면(제한/장애) fallback로 완전 대체
    if(picked.length < 18){
      console.warn("CG/Bybit cross universe too small -> full fallback");
      await fallbackUniverseFromBybit(token);
      if(apiDot) apiDot.className = "status-dot warn";
      return;
    }

    if(_isCancelled(token)) return;

    // 정상 반영
    state.universe = picked.slice(0, UNIVERSE_TOTAL_LIMIT);
    state.lastUniverseAt = Date.now();
    state.lastApiHealth = "ok";
    saveState();

    const tsEl = document.getElementById("universe-ts");
    if(tsEl) tsEl.innerText = `업데이트: ${new Date(state.lastUniverseAt).toLocaleTimeString()}`;

    if(apiDot) apiDot.className = "status-dot ok";

    if(typeof renderUniverseList === "function") renderUniverseList();
  }catch(e){
    console.warn("CoinGecko unavailable -> fallback to Bybit universe", e);
    if(apiDot) apiDot.className = "status-dot warn";
    state.lastApiHealth = "warn";
    saveState();
    await fallbackUniverseFromBybit(token);
  }
}

async function fallbackUniverseFromBybit(token = _getOpToken()){
  _ensureApiStateShape();
  const apiDot = document.getElementById("api-dot");
  try{
    if(_isCancelled(token)) return;

    const json = await fetchJSON(BYBIT_TICKERS, { timeoutMs: 7000, retry: 1 });
    if(_isCancelled(token)) return;

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
    const top = rows.slice(0, 240);

    // ✅ 총 60개로 확대(자동 30 + AI 추천 30과 동일 규모)
    const picked = [];
    for(const r of top){
      if(_isCancelled(token)) return;
      if(picked.length >= UNIVERSE_TOTAL_LIMIT) break;
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

    if(_isCancelled(token)) return;

    state.universe = picked.slice(0, UNIVERSE_TOTAL_LIMIT);
    state.lastUniverseAt = Date.now();
    state.lastApiHealth = "warn"; // fallback이니 warn 유지
    saveState();

    const tsEl = document.getElementById("universe-ts");
    if(tsEl) tsEl.innerText = `업데이트: ${new Date(state.lastUniverseAt).toLocaleTimeString()}`;

    if(apiDot) apiDot.className = "status-dot warn";

    if(typeof renderUniverseList === "function") renderUniverseList();
  }catch(e){
    console.error("Bybit fallback universe failed:", e);
    if(apiDot) apiDot.className = "status-dot bad";
  }
}

/* =========================
   Market tick + tracking
========================= */
async function marketTick(){
  _ensureApiStateShape();
  const token = _getOpToken();

  try{
    // ✅ 취소/초기화 직후엔 “지금 tick”을 즉시 종료
    if(_isCancelled(token)) return;

    const json = await fetchJSON(BYBIT_TICKERS, { timeoutMs: 7000, retry: 1 });
    if(_isCancelled(token)) return;

    const tickers = json?.result?.list || [];

    const uni = Array.isArray(state.universe) ? state.universe : [];
    const symbols = new Set(uni.map(x => x.s));

    // ✅ 핵심 최적화: "실제로 추적 중인 심볼"만 trackPositions 호출
    const active = Array.isArray(state.activePositions) ? state.activePositions : [];
    const activeSymbols = new Set(active.map(p => p?.symbol).filter(Boolean));

    for(const t of tickers){
      if(_isCancelled(token)) return;

      const sym = String(t.symbol || "").toUpperCase();
      if(!symbols.has(sym)) continue;

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

    // ✅ 안정장치: TIME 정산/통계 갱신 보장(정밀추적 종료→기록/성공률 반영)
    if(!_isCancelled(token)){
      if(typeof settleExpiredPositions === "function") settleExpiredPositions();
      if(typeof updateStatsUI === "function") updateStatsUI();
    }

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
async function _fetchCandlesBybit(symbol, tf, limit){
  _ensureApiStateShape();
  const token = _getOpToken();
  if(_isCancelled(token)) return [];

  const res = await fetchJSON(BYBIT_KLINE(symbol, tf, limit), { timeoutMs: 9000, retry: 1 });
  if(_isCancelled(token)) return [];

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

async function fetchCandles(symbol, tf, limit){
  _ensureApiStateShape();
  const token = _getOpToken();
  if(_isCancelled(token)) return [];
  const lim = Number(limit)||380;
  const key = _cKey(symbol, tf, lim);
  const now = Date.now();
  const cached = __CANDLE_CACHE.get(key);
  if(cached && (now - cached.t) < 25000 && Array.isArray(cached.v) && cached.v.length){
    return cached.v;
  }
  if(__CANDLE_INFLIGHT.has(key)) return __CANDLE_INFLIGHT.get(key);

  const p = (async ()=>{
    try{
      const iv = _tfToBinanceInterval(tf);
      const url = BINANCE_FUT_KLINE(symbol, iv, lim);
      const r = await fetchJSON(url, {timeoutMs: 9000, retry: 1});
      if(Array.isArray(r) && r.length){
        const c = _fixCandles(r.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]})));
        if(c.length){ __CANDLE_CACHE.set(key,{t:Date.now(),v:c}); return c; }
      }
    }catch(e){}
    if(_isCancelled(token)) return [];
    try{
      const iv = _tfToBinanceInterval(tf);
      const url = BINANCE_SPOT_KLINE(symbol, iv, lim);
      const r = await fetchJSON(url, {timeoutMs: 9000, retry: 1});
      if(Array.isArray(r) && r.length){
        const c = _fixCandles(r.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]})));
        if(c.length){ __CANDLE_CACHE.set(key,{t:Date.now(),v:c}); return c; }
      }
    }catch(e){}
    if(_isCancelled(token)) return [];
    try{
      const c = _fixCandles(await _fetchCandlesBybit(symbol, tf, lim));
      if(c.length){ __CANDLE_CACHE.set(key,{t:Date.now(),v:c}); return c; }
    }catch(e){}
    return [];
  })().finally(()=>{ __CANDLE_INFLIGHT.delete(key); });

  __CANDLE_INFLIGHT.set(key,p);
  return p;
}


/* === Binance Klines (ADD) === */
const BINANCE_FUT_KLINE = (symbol, interval, limit)=>`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${Number(limit)||500}`;
const BINANCE_SPOT_KLINE = (symbol, interval, limit)=>`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${Number(limit)||500}`;

function _tfToBinanceInterval(tf){
  if(tf==="15") return "15m";
  if(tf==="30") return "30m";
  if(tf==="60") return "1h";
  if(tf==="240") return "4h";
  if(tf==="D") return "1d";
  if(tf==="W") return "1w";
  const n = Number(tf);
  if(Number.isFinite(n) && n>0) return `${n}m`;
  return "1h";
}

const __CANDLE_CACHE = new Map();
const __CANDLE_INFLIGHT = new Map();
function _cKey(symbol, tf, limit){ return `${String(symbol).toUpperCase()}|${tf}|${limit}`; }

function _fixCandles(arr){
  const out = (Array.isArray(arr)?arr:[]).map(x=>{
    const t = Number(x.t ?? x[0]);
    const o = Number(x.o ?? x[1]);
    const h = Number(x.h ?? x[2]);
    const l = Number(x.l ?? x[3]);
    const c = Number(x.c ?? x[4]);
    const v = Number(x.v ?? x[5] ?? 0);
    return { t, o, h, l, c, v };
  }).filter(x=>Number.isFinite(x.t) && Number.isFinite(x.c) && Number.isFinite(x.h) && Number.isFinite(x.l));
  out.sort((a,b)=>a.t-b.t);
  return out;
}

async function fetchCandlesSafe(symbol, tf, limit){ return await fetchCandles(symbol, tf, limit); }
