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
   - 기본 자동 선정 30 (고정)
========================= */
const UNIVERSE_BASE_LIMIT  = 30;
const UNIVERSE_AI_EXTRA    = 0;
// ✅ Fallback Universe(30) — CoinGecko/네트워크 실패 시에도 앱이 멈추지 않게 고정 30종 사용
const FALLBACK_UNIVERSE_30 = [
  { s:"BTCUSDT", n:"Bitcoin" },
  { s:"ETHUSDT", n:"Ethereum" },
  { s:"BNBUSDT", n:"BNB" },
  { s:"SOLUSDT", n:"Solana" },
  { s:"XRPUSDT", n:"XRP" },
  { s:"ADAUSDT", n:"Cardano" },
  { s:"DOGEUSDT", n:"Dogecoin" },
  { s:"TRXUSDT", n:"TRON" },
  { s:"TONUSDT", n:"Toncoin" },
  { s:"AVAXUSDT", n:"Avalanche" },
  { s:"LINKUSDT", n:"Chainlink" },
  { s:"DOTUSDT", n:"Polkadot" },
  { s:"MATICUSDT", n:"Polygon" },
  { s:"LTCUSDT", n:"Litecoin" },
  { s:"BCHUSDT", n:"Bitcoin Cash" },
  { s:"UNIUSDT", n:"Uniswap" },
  { s:"ATOMUSDT", n:"Cosmos" },
  { s:"ETCUSDT", n:"Ethereum Classic" },
  { s:"XLMUSDT", n:"Stellar" },
  { s:"FILUSDT", n:"Filecoin" },
  { s:"APTUSDT", n:"Aptos" },
  { s:"NEARUSDT", n:"NEAR" },
  { s:"OPUSDT", n:"Optimism" },
  { s:"ARBUSDT", n:"Arbitrum" },
  { s:"SUIUSDT", n:"Sui" },
  { s:"ICPUSDT", n:"Internet Computer" },
  { s:"INJUSDT", n:"Injective" },
  { s:"RNDRUSDT", n:"Render" },
  { s:"SHIBUSDT", n:"Shiba Inu" },
  { s:"PEPEUSDT", n:"Pepe" }
];

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

  // ✅ 이 함수는 "절대" 전체를 죽이지 않는다.
  //   - CoinGecko/외부 API가 막혀도(지연/제한) 최소 유니버스(30)를 구성해
  //     통합예측/스캔/백테스트가 계속 돌아가게 한다.
  try{
    if(_isCancelled(token)) return;

    // 0) Bybit 티커는 가장 기본 데이터(유니버스/가격)라서 먼저 시도
    let tickers = [];
    try{
      const by = await fetchJSON(BYBIT_TICKERS, { timeoutMs: 7000, retry: 1 });
      if(_isCancelled(token)) return;
      tickers = by?.result?.list || [];
    }catch(e){
      tickers = [];
    }

    // Bybit 심볼 셋(검증/필터)
    const bybitSet = new Set(
      (Array.isArray(tickers) ? tickers : [])
        .map(t => String(t.symbol || "").toUpperCase())
        .filter(s => s && s.endsWith("USDT") && !_isBadUniverseSymbol(s))
    );

    // 1) (옵션) BTC 도미넌스: 실패해도 치명상 아님
    try{
      const g = await fetchJSON(CG_GLOBAL, { timeoutMs: 6000, retry: 0 });
      if(_isCancelled(token)) return;
      const dom = g?.data?.market_cap_percentage?.btc;
      if(typeof dom === "number"){
        state.btcDomPrev = (typeof state.btcDom === "number") ? state.btcDom : null;
        state.btcDom = dom;

        const pill = document.getElementById("btc-dom-pill");
        if(pill) pill.innerText = `BTC DOM: ${dom.toFixed(1)}%`;
      }
    }catch(e){
      // ignore
    }

    // 2) 기본 유니버스(최소 보장): Bybit 티커만으로 30개 만들기
    //    - CoinGecko가 막혀도 "스캔/예측/백테스트"가 동작해야 한다.
    const baseBybit = (Array.isArray(tickers) ? tickers : [])
      .map(t=>{
        const s = String(t.symbol || "").toUpperCase();
        if(!s || !s.endsWith("USDT") || _isBadUniverseSymbol(s)) return null;
        // Bybit v5: turnover24h / volume24h
        const turn = Number(t.turnover24h ?? t.turnover_24h ?? t.quoteVolume ?? 0) || 0;
        const vol  = Number(t.volume24h   ?? t.volume_24h   ?? t.volume      ?? 0) || 0;
        const chg  = Number(t.price24hPcnt ?? t.price24hPcnt ?? t.priceChangePercent ?? 0) || 0;
        const score = safeLog10(Math.max(turn,1))*0.65 + safeLog10(Math.max(vol,1))*0.30 + Math.min(Math.abs(chg)*100, 20)*0.05;
        return { s, n: s.replace("USDT",""), turn, vol, score };
      })
      .filter(Boolean)
      .sort((a,b)=> (b.score - a.score));

    let basePicked = baseBybit.slice(0, UNIVERSE_TOTAL_LIMIT).map(x=>({ s:x.s, n:x.n, turn:x.turn }));

    // 3) (가능하면) CoinGecko로 이름/모멘텀 보강해서 "더 좋은 60"으로 업데이트
    //    - 실패해도 basePicked 유지
    try{
      const marketsUrl = _buildCgMarketsUrl();
      const markets = await fetchJSON(marketsUrl, { timeoutMs: 7000, retry: 0 });
      if(_isCancelled(token)) return;

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

      const pickedBase = scored.slice(0, UNIVERSE_BASE_LIMIT);
      const exclude = new Set(pickedBase.map(x => x.s));

      const aiCandidates = (Array.isArray(markets) ? markets : [])
        .map(m => {
          const vol = m?.total_volume ?? 0;
          const cgSym = String(m?.symbol || "").toUpperCase();
          const sym = _mapCgToBybitSymbol(cgSym, bybitSet);

          if(!sym) return null;
          if(_isBadUniverseSymbol(sym)) return null;
          if(exclude.has(sym)) return null;
          if(!(vol > 5_000_000)) return null;

          const aiScore = _momentumScore(m);
          if(!(aiScore > 0)) return null;

          return {
            s: sym,
            n: m?.name || cgSym || sym.replace("USDT",""),
            cg: m?.id || null,
            vol,
            aiScore
          };
        })
        .filter(Boolean)
        .sort((a,b)=> b.aiScore - a.aiScore);

      const pickedAI = aiCandidates.slice(0, UNIVERSE_AI_EXTRA);

      const merged = [...pickedBase, ...pickedAI]
        .slice(0, UNIVERSE_TOTAL_LIMIT)
        .map(x=>({ s:x.s, n:x.n, cg:x.cg || null, turn: x.turn ?? x.vol ?? 0 }));

      // CG가 성공하면 merged로 교체 (단, 너무 적으면 base 유지)
      if(Array.isArray(merged) && merged.length >= 20){
        basePicked = merged;
      }
    }catch(e){
      // ignore
    }

    // 4) 최종 유니버스 확정
    //    - 빈 배열이면 최소 하드코딩 TOP(안전장치)
    if(!Array.isArray(basePicked) || basePicked.length === 0){
      basePicked = [
        {s:"BTCUSDT", n:"Bitcoin"},
        {s:"ETHUSDT", n:"Ethereum"},
        {s:"BNBUSDT", n:"BNB"},
        {s:"SOLUSDT", n:"Solana"},
        {s:"XRPUSDT", n:"XRP"},
        {s:"ADAUSDT", n:"Cardano"},
        {s:"DOGEUSDT", n:"Dogecoin"},
        {s:"AVAXUSDT", n:"Avalanche"},
        {s:"LINKUSDT", n:"Chainlink"},
        {s:"MATICUSDT", n:"Polygon"},
      ];
    }

    // 중복 제거 + 길이 제한
    const seen = new Set();
    const finalUni = [];
    for(const x of basePicked){
      const s = String(x?.s || "").toUpperCase();
      if(!s || seen.has(s)) continue;
      if(_isBadUniverseSymbol(s)) continue;
      seen.add(s);
      finalUni.push({ s, n: x?.n || s.replace("USDT",""), cg: x?.cg || null, turn: x?.turn || 0 });
      if(finalUni.length >= UNIVERSE_TOTAL_LIMIT) break;
    }

    state.universe = finalUni;
    saveState();

    if(apiDot){
      apiDot.classList.remove("bad");
      apiDot.classList.add("ok");
    }
  }catch(e){
    // ✅ 마지막 방어: 어떤 예외가 나도 "빈 유니버스"로 끝내지 않는다.
    console.error("refreshUniverseAndGlobals fatal:", e);

    try{
      if(!Array.isArray(state.universe) || state.universe.length === 0){
        state.universe = FALLBACK_UNIVERSE_30.map(x=>({s:x.s,n:x.n}));
      saveState();
      }
    }catch(_e){}

    if(apiDot){
      apiDot.classList.remove("ok");
      apiDot.classList.add("bad");
    }
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
const BINANCE_FUT_KLINE = (symbol, interval, limit)=>`https://data-api.binance.vision/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${Number(limit)||500}`;
const BINANCE_SPOT_KLINE = (symbol, interval, limit)=>`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${Number(limit)||500}`;

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
