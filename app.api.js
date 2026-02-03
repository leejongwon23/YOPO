
// FIXED app.api.js — server function bindings

function _serverBase(){
  return (window.YOPO_SERVER_BASE || "").replace(/\/$/, "");
}

async function _post(path, body){
  const res = await fetch(_serverBase()+path, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body||{})
  });
  if(!res.ok) throw new Error("SERVER_"+res.status);
  return await res.json();
}

// 🔥 핵심 수정: 버튼에서 호출하는 함수 정의
async function serverPredict6tf(payload){
  return _post("/api/engine/predict6tf", payload);
}
// window 바인딩 (중요)
window.serverPredict6tf = serverPredict6tf;

/* =========================
   YOPO API PATCH (AUTO)
   - ensure required window.server* functions exist
========================= */
function _yopoServerBase(){
  const base = (window.YOPO_SERVER_BASE || "").replace(/\/$/, "");
  if(!base) throw new Error("YOPO_SERVER_BASE_NOT_SET");
  return base;
}
async function _yopoPost(path, body, timeoutMs=15000){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(_yopoServerBase()+path, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(body||{}),
      signal: ctrl.signal
    });
    if(!res.ok){
      const txt = await res.text().catch(()=>"");
      throw new Error("SERVER_"+res.status+":"+txt);
    }
    return await res.json();
  } finally { clearTimeout(t); }
}
async function _yopoGet(path, timeoutMs=15000){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(_yopoServerBase()+path, { signal: ctrl.signal });
    if(!res.ok){
      const txt = await res.text().catch(()=>"");
      throw new Error("SERVER_"+res.status+":"+txt);
    }
    return await res.json();
  } finally { clearTimeout(t); }
}
window.serverPredict6tf = window.serverPredict6tf || ((payload)=>_yopoPost("/api/engine/predict6tf", payload));
window.serverBacktest  = window.serverBacktest  || ((payload)=>_yopoPost("/api/engine/backtest", payload));
window.serverEvolveFeedback = window.serverEvolveFeedback || ((payload)=>_yopoPost("/api/evolve/feedback", payload));
window.serverEvolveStats    = window.serverEvolveStats    || (()=>_yopoGet("/api/evolve/stats"));

// ✅ 호환용 함수 (UI가 기대하지만 없어도 동작은 가능)
// - 경고 제거 + 가능하면 서버에서 값 받아오고, 실패해도 절대 throw 하지 않음
window.marketTick = window.marketTick || (async function marketTick(symbol){
  try{
    // 서버에 해당 엔드포인트가 있으면 사용, 없으면 null 반환
    return await _yopoGet("/api/market/tick?symbol=" + encodeURIComponent(symbol||""));
  }catch(e){
    return null;
  }
});

window.refreshUniverseAndGlobals = window.refreshUniverseAndGlobals || (async function refreshUniverseAndGlobals(){
  try{
    const out = await _yopoGet("/api/universe/top20");
    // Backward compatible: keep out.symbols, but also provide out.universe for UI renderers.
    if(out && out.ok && Array.isArray(out.symbols)){
      const now = Date.now();
      out.universe = out.symbols.map(s=>({ s:String(s).toUpperCase(), p:null, chg:null, ts:now }));
    }
    return out;
  }catch(e){
    return null;
  }
});

// ✅ 추가 안정화: 서버 tick 실패 시 UI 콘솔/네트워크 스팸 방지
// - 실패하면 잠깐 쉬었다가 다시 시도 (쿨다운)
// - 마지막 정상 tick이 있으면 그걸 재사용
(function(){
  const _tickCache = new Map(); // symbol -> {data, ts}
  let _cooldownUntil = 0;

  async function _safeGet(path, timeoutMs=8000){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), timeoutMs);
    try{
      const res = await fetch(_yopoServerBase()+path, { signal: ctrl.signal });
      // 200이 아니면 null 처리 (throw 금지)
      if(!res.ok) return null;
      return await res.json();
    }catch(_e){
      return null;
    }finally{ clearTimeout(t); }
  }

  window.marketTick = async function marketTick(symbol){
    const sym = String(symbol||"").toUpperCase();
    const now = Date.now();

    // 쿨다운 중이면 캐시만 반환
    if(now < _cooldownUntil){
      return _tickCache.get(sym)?.data || null;
    }

    // 3초 이내면 캐시 재사용
    const cached = _tickCache.get(sym);
    if(cached && (now - cached.ts) < 3000){
      return cached.data;
    }

    const data = await _safeGet("/api/market/tick?symbol="+encodeURIComponent(sym));
    if(data && data.ok){
      _tickCache.set(sym, { data, ts: now });
      return data;
    }

    // 실패하면 10초 쿨다운
    _cooldownUntil = now + 10_000;
    return cached?.data || null;
  };
})();




/* =========================================================
   ✅ BROWSER DATA MODE (NO PROXY · NO SERVER EXCHANGE FETCH)
   - If Render egress is blocked by exchanges (e.g., 451),
     the browser fetches public Binance Futures data directly
     and sends candles to the server for calculation.
   - Server stays "calculation-only".
========================================================= */

(function(){
  const FUTURES_BASES = [
    "https://fapi.binance.com",
    "https://fapi.binance.vision",
  ];

  function _sym(s){ return String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,""); }

  async function _fetchJson(url, timeoutMs=12000){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), timeoutMs);
    try{
      const res = await fetch(url, { signal: ctrl.signal, headers:{ "accept":"application/json" } });
      if(!res.ok) return null;
      return await res.json().catch(()=>null);
    }catch(_e){
      return null;
    }finally{ clearTimeout(t); }
  }

  // Simple in-memory cache for browser fetches
  const _cache = new Map(); // key -> {ts,data}
  function _cget(key, ttl){
    const x = _cache.get(key);
    if(!x) return null;
    if(Date.now()-x.ts > ttl) return null;
    return x.data;
  }
  function _cset(key, data){
    _cache.set(key, { ts: Date.now(), data });
  }

  async function browserFetchTicker24h(symbol){
    const sym = _sym(symbol);
    const key = "t24:"+sym;
    const cached = _cget(key, 3000);
    if(cached) return cached;

    for(const base of FUTURES_BASES){
      const url = `${base}/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(sym)}`;
      const j = await _fetchJson(url, 10000);
      const price = Number(j?.lastPrice);
      const chg = Number(j?.priceChangePercent);
      if(Number.isFinite(price)){
        const out = { ok:true, symbol:sym, price, chg: Number.isFinite(chg)?chg:0 };
        _cset(key, out);
        return out;
      }
    }
    return null;
  }

  async function browserFetchKlines(symbol, interval="15m", limit=300){
    const sym = _sym(symbol);
    const key = `kl:${sym}:${interval}:${limit}`;
    const cached = _cget(key, 15000);
    if(cached) return cached;

    for(const base of FUTURES_BASES){
      const url = `${base}/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`;
      const j = await _fetchJson(url, 12000);
      if(Array.isArray(j) && j.length){
        const candles = j.map(k=>({
          ts: k[0],
          open: +k[1],
          high: +k[2],
          low:  +k[3],
          close:+k[4],
          volume:+k[5]
        }));
        if(candles.length){
          _cset(key, candles);
          return candles;
        }
      }
    }
    return null;
  }

  // Override marketTick: prefer browser direct (no server dependence)
  window.marketTick = async function marketTick(symbol){
    const t = await browserFetchTicker24h(symbol);
    if(t && t.ok) return { ok:true, symbol:t.symbol, price:t.price, chg:t.chg };
    return null;
  };

  // Wrap serverPredict6tf: attach candlesByTf so server can calculate without exchange access
  const _origPredict = window.serverPredict6tf;
  window.serverPredict6tf = async function serverPredict6tf(payload){
    const sym = _sym(payload?.symbol || "BTCUSDT");
    const tfs = ["15m","30m","1h","4h","1d","1w"];
    const candlesByTf = {};
    for(const tf of tfs){
      const c = await browserFetchKlines(sym, tf, 300);
      if(c) candlesByTf[tf] = c;
    }
    const body = Object.assign({}, payload||{}, { symbol:sym, candlesByTf });
    if(typeof _origPredict === "function") return _origPredict(body);
    return _yopoPost("/api/engine/predict6tf", body);
  };

  // Wrap serverBacktest: attach candlesByTf for all TFs
  const _origBacktest = window.serverBacktest;
  window.serverBacktest = async function serverBacktest(payload){
    const sym = _sym(payload?.symbol || "BTCUSDT");
    const limit = Math.max(240, Math.min(1500, Number(payload?.limit || 900)));
    const tfs = ["15m","30m","1h","4h","1d","1w"];
    const candlesByTf = {};
    for(const tf of tfs){
      const c = await browserFetchKlines(sym, tf, limit);
      if(c) candlesByTf[tf] = c;
    }
    const body = Object.assign({}, payload||{}, { symbol:sym, limit, candlesByTf });
    if(typeof _origBacktest === "function") return _origBacktest(body);
    return _yopoPost("/api/engine/backtest", body);
  };

  // Expose helpers (optional)
  window.__yopoBrowserData = {
    browserFetchTicker24h,
    browserFetchKlines
  };
})();
