/*************************************************************
 * YOPO AI PRO — app.api.js (분할 v1)  ✅ UPDATED (FIXED+)
 * 역할: 외부 API 통신 + 데이터 로딩(유니버스/도미넌스/티커/캔들)
 * 주의:
 * - UI 업데이트 함수(updateCoinRow/renderUniverseList/trackPositions/switchCoin 등)는
 *   app.features.js에 있어도 OK. (호출 시점에 정의돼 있으면 동작)
 *************************************************************/

/* =========================
   ✅ Render Server Base (Hybrid)
   - 브라우저 과부하 방지용 서버(캐시/벌크/계산 엔진)
   - window.YOPO_SERVER_BASE 로 덮어쓸 수 있음
========================= */
(function(){
  try{
    if(!window.YOPO_SERVER_BASE){
      // ✅ 기본값: Render 배포 도메인 (필요 시 index.html에서 window.YOPO_SERVER_BASE로 교체)
      window.YOPO_SERVER_BASE = "https://yopo-api-cache.onrender.com";
    }
  }catch(e){}
})();

function _serverBase(){
  try{ return String(window.YOPO_SERVER_BASE||"").replace(/\/$/,""); }catch(e){ return ""; }
}

async function fetchServerJSON(path, opts={}){
  const base = _serverBase();
  if(!base) throw new Error("NO_SERVER_BASE");
  const url = base + path;
  const r = await fetch(url, {
    method: opts.method || "GET",
    headers: Object.assign({"content-type":"application/json"}, (opts.headers||{})),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if(!r.ok) throw new Error("SERVER_"+r.status);
  return await r.json();
}

/* =========================
   ✅ Binance klines via Render server (CORS-safe)
========================= */
async function fetchServerKlines(symbol, tfRaw, limit=500){
  const s = String(symbol||"").toUpperCase().trim();
  const tf = String(tfRaw||"").trim();
  const lim = Math.max(10, Math.min(1500, Number(limit)||500));
  const q = `?symbol=${encodeURIComponent(s)}&tf=${encodeURIComponent(tf)}&limit=${encodeURIComponent(String(lim))}`;
  const j = await fetchServerJSON(`/api/bn/klines${q}`);
  if(j && j.ok && Array.isArray(j.candles)) return j.candles;
  throw new Error(j?.error || "BN_KLINES_BAD_RESPONSE");
}


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
const UNIVERSE_BASE_LIMIT  = 30;
const UNIVERSE_AI_EXTRA    = 30;
const UNIVERSE_TOTAL_LIMIT = UNIVERSE_BASE_LIMIT + UNIVERSE_AI_EXTRA;

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
  const token = _getOpToken();
  const apiDot = document.getElementById("api-dot");

  try{
    if(_isCancelled(token)) return;

    // ✅ 1) (선택) BTC 도미넌스는 CoinGecko global로 표시 (시장상황 참고용)
    //   - “거래 데이터/예측 데이터”는 Binance Futures로 통일
    try{
      const g = await fetchJSON(CG_GLOBAL, { timeoutMs: 6000, retry: 1 });
      if(_isCancelled(token)) return;
      const dom = g?.data?.market_cap_percentage?.btc;
      if(typeof dom === "number"){
        state.btcDomPrev = (typeof state.btcDom === "number") ? state.btcDom : null;
        state.btcDom = dom;
        const pill = document.getElementById("btc-dom-pill");
        if(pill) pill.innerText = `BTC DOM: ${dom.toFixed(1)}%`;
      }
    }catch(e){
      // global은 실패해도 유니버스 구축은 계속 진행
    }

    // ✅ 2) Binance Futures(USDT) TOP20 유니버스 구축
    const limit = 20;

    const [info, tickers] = await Promise.all([
      fetchJSON(BINANCE_FUT_EXCHANGEINFO_PROXY, { timeoutMs: 9000, retry: 1 }),
      fetchJSON(BINANCE_FUT_TICKER24H_PROXY, { timeoutMs: 9000, retry: 1 }),
    ]);
    if(_isCancelled(token)) return;

    const okSymbols = new Set();
    const syms = info?.symbols || [];
    for(const s of syms){
      const sym = String(s?.symbol||"").toUpperCase();
      if(!sym.endsWith("USDT")) continue;
      if(String(s?.status||"") !== "TRADING") continue;
      if(String(s?.contractType||"") !== "PERPETUAL") continue;
      if(String(s?.quoteAsset||"") !== "USDT") continue;
      okSymbols.add(sym);
    }

    const rows = Array.isArray(tickers) ? tickers : [];
    const ranked = rows
      .map(r => {
        const sym = String(r?.symbol||"").toUpperCase();
        if(!okSymbols.has(sym)) return null;
        if(_isBadUniverseSymbol(sym)) return null;
        const qv = Number(r?.quoteVolume);
        const lp = Number(r?.lastPrice);
        const chg = Number(r?.priceChangePercent);
        return {
          symbol: sym,
          quoteVolume: Number.isFinite(qv)?qv:0,
          lastPrice: Number.isFinite(lp)?lp:null,
          chg24: Number.isFinite(chg)?chg:0,
        };
      })
      .filter(Boolean)
      .sort((a,b)=> (b.quoteVolume - a.quoteVolume));

    const picked = ranked.slice(0, limit);

    state.universe = picked.map((x,i)=>({
      symbol: x.symbol,
      name: x.symbol,
      rank: i+1,
      exchange: "BINANCEFUT",
      score: x.quoteVolume
    }));

    state.lastPrices = state.lastPrices || {};
    for(const x of picked){
      state.lastPrices[x.symbol] = { price: x.lastPrice, chg: x.chg24, ts: Date.now() };
    }

    state.lastUniverseAt = Date.now();
    saveState();

    try{ if(typeof renderUniverseList === "function") renderUniverseList(); }catch(e){}

    if(apiDot) apiDot.className = "status-dot ok";
  }catch(e){
    console.error("refreshUniverseAndGlobals error:", e);
    if(apiDot) apiDot.className = "status-dot warn";
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
    if(_isCancelled(token)) return;

    const tickers = await fetchJSON(BINANCE_FUT_TICKER24H_PROXY, { timeoutMs: 9000, retry: 1 });
    if(_isCancelled(token)) return;

    const rows = Array.isArray(tickers) ? tickers : [];
    const map = new Map();
    for(const r of rows){
      const sym = String(r?.symbol||"").toUpperCase();
      if(!sym) continue;
      const lp = Number(r?.lastPrice);
      const chg = Number(r?.priceChangePercent);
      if(Number.isFinite(lp)) map.set(sym, { price: lp, chg: Number.isFinite(chg)?chg:0, ts: Date.now() });
    }

    state.lastPrices = state.lastPrices || {};
    for(const u of (state.universe||[])){
      const sym = String(u?.symbol||"").toUpperCase();
      const v = map.get(sym);
      if(v){
        state.lastPrices[sym] = v;
        try{ if(typeof updateCoinRow === "function") updateCoinRow(sym); }catch(e){}
      }
    }

    saveState();
  }catch(e){
    console.error("marketTick error:", e);
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
  // ✅ 1) 서버(렌더)로 먼저 캔들 요청 (CORS 문제 해결)
  try{
    return await fetchServerKlines(symbol, tfRaw, limit);
  }catch(e){
    // 서버가 죽었거나 네트워크 문제면, 아래 기존 폴백(직호출)로 내려감
  }

  _ensureApiStateShape();
  const token = _getOpToken();
  if(_isCancelled(token)) throw new Error("cancelled");

  const key = `${symbol}|${tf}|${limit}`;
  const now = Date.now();
  const cached = CANDLE_CACHE.get(key);
  if(cached && (now - cached.ts) < 60_000){
    // 60초 내 캐시는 그대로 사용 (폭주 방지)
    return cached.data;
  }

  const trySetCache = (arr)=>{
    if(Array.isArray(arr) && arr.length){
      CANDLE_CACHE.set(key, { ts: Date.now(), data: arr });
      // 캐시 크기 제한(메모리 폭주 방지)
      if(CANDLE_CACHE.size > 300){
        const firstKey = CANDLE_CACHE.keys().next().value;
        CANDLE_CACHE.delete(firstKey);
      }
    }
    return arr;
  };

  // ✅ 핵심: "실패해도 앱 전체가 멈추지 않게"
  // - 순서: Binance(futures→spot)만 사용 (Binance Futures 기준 통일)
  // - 실패하면: (1) 오래된 캐시라도 있으면 그거 반환, (2) 없으면 [] 반환
  let lastErr = null;

  try{
    if(_isCancelled(token)) throw new Error("cancelled");
    const bFut = await fetchBinanceKlines(symbol, tf, limit, { futures: true });
    if(Array.isArray(bFut) && bFut.length) return trySetCache(bFut);
  }catch(e){ lastErr = e; }

  try{
    if(_isCancelled(token)) throw new Error("cancelled");
    const bSpot = await fetchBinanceKlines(symbol, tf, limit, { futures: false });
    if(Array.isArray(bSpot) && bSpot.length) return trySetCache(bSpot);
  }catch(e){ lastErr = e; }


  // 오래된 캐시라도 있으면 반환(네트워크 불안정 시 "돌아가게" 우선)
  if(cached && Array.isArray(cached.data) && cached.data.length){
    console.warn("[fetchCandles] fallback to stale cache:", key, lastErr);
    return cached.data;
  }

  console.warn("[fetchCandles] failed (return empty):", key, lastErr);
  return [];
}


/* === Binance Klines (ADD) === */
// ✅ Binance candles: use CORS-friendly mirror first (GitHub Pages friendly)
const BINANCE_FUT_KLINE = "https://data-api.binance.vision/fapi/v1/klines";
const BINANCE_SPOT_KLINE = "https://data-api.binance.vision/api/v3/klines";

// (Fallbacks are still available for non-browser / relaxed CORS environments)
const BINANCE_FUT_KLINE_FALLBACK = "https://fapi.binance.com/fapi/v1/klines";
const BINANCE_SPOT_KLINE_FALLBACK = "https://api.binance.com/api/v3/klines";

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
/* =========================
   Binance Klines (CORS-friendly)
   - GitHub Pages 같은 브라우저 환경에서 "binance.com"은 CORS로 자주 막힘
   - 그래서 data-api.binance.vision(미러) → 막히면 공식 도메인 순서로 시도
========================= */
async function fetchBinanceKlines(symbol, tf, limit=500, futures=true){
  const interval = _tfToBinanceInterval(tf);
  const s = String(symbol||"").toUpperCase();
  const lim = Math.max(10, Math.min(1500, Number(limit)||500));

  const urls = futures ? [
    // ✅ Render 서버 우선(캐시/스로틀)
    (_serverBase() ? (_serverBase()+`/api/binance/fapi/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`) : null),
    `https://data-api.binance.vision/fapi/v1/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`,
    `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`
  ] : [
    // ✅ Render 서버 우선(캐시/스로틀)
    (_serverBase() ? (_serverBase()+`/api/binance/spot/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`) : null),
    `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`,
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`
  ];

  let lastErr = null;
  for(const url of urls){
    if(!url) continue;
    try{
      const raw = await fetchJSON(url, { timeoutMs: 9000, retry: 1 });
      if(!Array.isArray(raw) || raw.length===0) throw new Error("EMPTY_KLINES");
      // normalize
      return raw.map(k=>({
        t: Number(k?.[0]),
        o: Number(k?.[1]),
        h: Number(k?.[2]),
        l: Number(k?.[3]),
        c: Number(k?.[4]),
        v: Number(k?.[5])
      })).filter(x=>Number.isFinite(x.t) && Number.isFinite(x.c));
    }catch(e){
      lastErr = e;
    }
  }
  throw lastErr || new Error("BINANCE_KLINES_FAILED");
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
