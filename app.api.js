/*************************************************************
 * YOPO AI PRO — app.api.js (분할 v1)  ✅ UPDATED (FIXED+)
 * 역할: 외부 API 통신 + 데이터 로딩(유니버스/도미넌스/티커/캔들)
 * 주의:
 * - UI 업데이트 함수(updateCoinRow/renderUniverseList/trackPositions/switchCoin 등)는
 *   app.features.js에 있어도 OK. (호출 시점에 정의돼 있으면 동작)
 *************************************************************/


/* =========================
   ✅ API ENDPOINT CONFIG (Render Hybrid)
   - 목표: "Binance Futures 기준 20코인" + 브라우저 과부하 감소
   - 우선순위: Render 서버(캐시/벌크) → Binance Vision 직호출(폴백)
========================= */

// ✅ Render 서버 베이스 (필요시 index.html에서 window.RENDER_API_BASE 로 덮어쓰기 가능)
const RENDER_BASE = (typeof window !== "undefined" && typeof window.RENDER_API_BASE === "string" && window.RENDER_API_BASE)
  ? window.RENDER_API_BASE.replace(/\/+$/,"")
  : "https://yopo-api-cache.onrender.com";

// ✅ 서버 엔드포인트
const SV_PING            = `${RENDER_BASE}/ping`;
const SV_FUT_TICKERS     = `${RENDER_BASE}/api/binance/fapi/ticker24hr`;     // 24h tickers
const SV_FUT_KLINES      = `${RENDER_BASE}/api/binance/fapi/klines`;         // klines (single)
const SV_FUT_KLINES_BULK = `${RENDER_BASE}/api/binance/fapi/klines/bulk`;    // klines (bulk)

// (CoinGecko는 DOM 같은 보조지표용)
const SV_CG_GLOBAL    = `${RENDER_BASE}/api/cg/global`;
const SV_SV_CG_MARKETS   = `${RENDER_BASE}/api/cg/markets`;

// ✅ 브라우저 직호출 폴백 (서버가 죽거나 막히면 사용)
const VISION_FUT_TICKERS = "https://data-api.binance.vision/fapi/v1/ticker/24hr";
const VISION_FUT_KLINES  = "https://data-api.binance.vision/fapi/v1/klines";
const CG_GLOBAL_FALLBACK = "https://api.coingecko.com/api/v3/global";

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
   ✅ Universe sizing (자동 + AI 추천)
   - 기본 자동 선정 30 + AI 추천 30 = 총 60
========================= */
const UNIVERSE_BASE_LIMIT  = 30;
const UNIVERSE_AI_EXTRA    = 30;
const UNIVERSE_TOTAL_LIMIT = UNIVERSE_BASE_LIMIT + UNIVERSE_AI_EXTRA;

// CoinGecko: 24h + 7d + 30d 변동률까지 받아서 “AI 추천(모멘텀)” 스코어를 만든다.
function _buildCgMarketsUrl(){
  // ✅ SV_CG_MARKETS는 (1) CoinGecko 직호출 URL 이거나, (2) Render 서버 프록시(/api/cg/markets)일 수 있다.
  // - 프록시일 때는 CoinGecko의 쿼리를 그대로 붙여서 서버가 대신 호출하게 한다.
  try{
    if(typeof SV_CG_MARKETS === "string" && SV_CG_MARKETS.length){
      // (A) 직호출 URL: 기존 로직 유지 (price_change_percentage 확장)
      if(SV_CG_MARKETS.includes("api.coingecko.com") || SV_CG_MARKETS.includes("price_change_percentage=")){
        if(SV_CG_MARKETS.includes("price_change_percentage=24h,7d,30d")) return SV_CG_MARKETS;
        if(SV_CG_MARKETS.includes("price_change_percentage=24h")){
          return SV_CG_MARKETS.replace("price_change_percentage=24h", "price_change_percentage=24h,7d,30d");
        }
        return SV_CG_MARKETS + (SV_CG_MARKETS.includes("?") ? "&" : "?") + "price_change_percentage=24h,7d,30d";
      }

      // (B) Render 프록시 URL: 쿼리가 없으면 기본 쿼리 붙이기
      const base = SV_CG_MARKETS;
      if(!base.includes("?")){
        return base + "?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h,7d,30d";
      }
      // 쿼리가 있는데 price_change_percentage가 없으면 추가
      if(!base.includes("price_change_percentage=")){
        return base + "&price_change_percentage=24h,7d,30d";
      }
      // 이미 있으면 24h,7d,30d로 보강
      if(base.includes("price_change_percentage=24h") && !base.includes("price_change_percentage=24h,7d,30d")){
        return base.replace("price_change_percentage=24h", "price_change_percentage=24h,7d,30d");
      }
      return base;
    }
  }catch(e){}
  // 최후 폴백: CoinGecko 직호출
  return "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h,7d,30d";
}

      return SV_CG_MARKETS + (SV_CG_MARKETS.includes("?") ? "&" : "?") + "price_change_percentage=24h,7d,30d";
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
  try{ startRenderKeepAlive(); }catch(e){}
  _ensureApiStateShape();
  const token = _getOpToken();
  const apiDot = document.getElementById("api-dot");

  try{
    if(_isCancelled(token)) return;

    // 1) BTC 도미넌스 (CoinGecko)
    let g = null;
    try{
      g = await fetchJSON(SV_CG_GLOBAL, { timeoutMs: 6000, retry: 1 });
    }catch(e){
      g = await fetchJSON("https://api.coingecko.com/api/v3/global", { timeoutMs: 6000, retry: 1 });
    }
    if(_isCancelled(token)) return;

    const dom = g?.data?.market_cap_percentage?.btc;
    if(typeof dom === "number"){
      state.btcDomPrev = (typeof state.btcDom === "number") ? state.btcDom : null;
      state.btcDom = dom;
      const pill = document.getElementById("btc-dom-pill");
      if(pill) pill.innerText = `BTC DOM: ${dom.toFixed(1)}%`;
    }

    // 2) ✅ Binance Futures 24h tickers 기반 TOP 20 유니버스 생성
    // - 혼합 금지: Binance Futures(USDT)로 통일
    // - 서버(Render) → Vision 폴백
    const limit = (typeof UNIVERSE_TARGET_LIMIT === "number" && UNIVERSE_TARGET_LIMIT>0) ? UNIVERSE_TARGET_LIMIT : 20;

    let tickers = null;
    try{
      tickers = await fetchJSON(SV_FUT_TICKERS, { timeoutMs: 8000, retry: 1 });
    }catch(e){
      tickers = await fetchJSON(VISION_FUT_TICKERS, { timeoutMs: 8000, retry: 1 });
    }
    if(_isCancelled(token)) return;

    const arr = Array.isArray(tickers) ? tickers : [];
    const filtered = arr.filter(x => {
      const sym = String(x?.symbol || "");
      return sym.endsWith("USDT") && !sym.includes("_") && !sym.includes("USDC") && !sym.includes("BUSD");
    });

    filtered.sort((a,b) => (Number(b?.quoteVolume)||0) - (Number(a?.quoteVolume)||0));

    const top = filtered.slice(0, limit).map(x => {
      const s = String(x?.symbol||"").toUpperCase();
      const last = Number(x?.lastPrice);
      const chg = Number(x?.priceChangePercent);
      const qv  = Number(x?.quoteVolume);
      return {
        s,
        n: s.replace("USDT",""),
        price: Number.isFinite(last)?last:null,
        chg: Number.isFinite(chg)?chg:null,
        vol: Number.isFinite(qv)?qv:null
      };
    });

    state.universe = top;

    state.lastUniverseAt = Date.now();
    saveState();

    if(apiDot) apiDot.className = "status-dot ok";
  }catch(e){
    console.error("refreshUniverseAndGlobals error:", e);
    if(apiDot) apiDot.className = "status-dot warn";
  }
}

async function marketTick(){
  _ensureApiStateShape();
  const token = _getOpToken();

  try{
    if(_isCancelled(token)) return;

    // ✅ 거래소 제거: CoinGecko(서버 캐시)로 현재가/등락을 가져온다
    // - 서버(Render): /api/cg/markets (캐시)
    // - 서버가 죽으면 fetchJSON이 자동으로 브라우저 직호출로 폴백(코드 내 fetchJSON 로직)
    const qs = "?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h";
    const json = await fetchJSON(SV_CG_MARKETS + qs, { timeoutMs: 9000, retry: 1 });
    if(_isCancelled(token)) return;

    const list = Array.isArray(json) ? json : [];
    const map = new Map(); // SYMBOL(대문자) -> { price, chg }
    for(const row of list){
      const sym = String(row?.symbol || "").toUpperCase();
      if(!sym) continue;
      const price = Number(row?.current_price);
      const chg = Number(row?.price_change_percentage_24h);
      if(Number.isFinite(price)) map.set(sym, { price, chg: Number.isFinite(chg)?chg:0, ts: Date.now() });
    }

    const uni = Array.isArray(state.universe) ? state.universe : [];
    const active = Array.isArray(state.activePositions) ? state.activePositions : [];
    const activeSymbols = new Set(active.map(p => p?.symbol).filter(Boolean));

    for(const u of uni){
      if(_isCancelled(token)) return;
      const sym = String(u?.s || "").toUpperCase();  // e.g. BTCUSDT
      const base = sym.endsWith("USDT") ? sym.slice(0, -4) : sym;
      const info = map.get(base);
      if(!info) continue;

      if(typeof updateCoinRow === "function") updateCoinRow(sym, info.price, info.chg);
      state.lastPrices[sym] = { price: info.price, chg: info.chg, ts: info.ts };

      if(activeSymbols.has(sym) && typeof trackPositions === "function"){
        trackPositions(sym, info.price);
      }
    }

    if(!_isCancelled(token)){
      if(typeof settleExpiredPositions === "function") settleExpiredPositions();
      if(typeof updateStatsUI === "function") updateStatsUI();
    }

    saveState();

    if(uni[0] && !uni.find(x => x?.s === state.symbol)){
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
  // - 순서: Binance(futures→spot)
  // - 전부 실패하면: (1) 오래된 캐시라도 있으면 그거 반환, (2) 없으면 [] 반환
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

  // ✅ 우선순위: Render 서버 캐시(가능하면) → Binance Vision 미러 → 공식 도메인
  // - Render 서버는 "브라우저 과부하/지연"을 줄이기 위한 캐시 레이어
  // - 서버가 죽거나 막히면, 브라우저가 직접 호출로 자동 폴백
  const futProxy  = SV_FUT_KLINES || null;
  const spotProxy = null; // ✅ SPOT 미사용 (Futures 기준 통일)

  const urls = futures ? [
    ...(futProxy ? [
      `${futProxy}?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`
    ] : []),
    `https://data-api.binance.vision/fapi/v1/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`,
    `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`
  ] : [
    ...(spotProxy ? [
      `${spotProxy}?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`
    ] : []),
    `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`,
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${lim}`
  ];

  let lastErr = null;
  for(const url of urls){
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


// ✅ (선택) 벌크 klines: symbols=comma(최대20) 를 한 번에 받아오기 (서버 지원 시)
async function fetchBinanceKlinesBulk(symbols, tf, limit=500){
  const interval = _tfToBinanceInterval(tf);
  const lim = Math.max(10, Math.min(1500, Number(limit)||500));
  const list = Array.isArray(symbols) ? symbols : [];
  const joined = list.map(s=>String(s||"").toUpperCase()).filter(Boolean).slice(0,20).join(",");
  if(!joined) return null;

  const url = `${SV_FUT_KLINES_BULK}?symbols=${encodeURIComponent(joined)}&interval=${encodeURIComponent(interval)}&limit=${lim}`;
  try{
    return await fetchJSON(url, { timeoutMs: 12000, retry: 0 });
  }catch(e){
    return null;
  }
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
