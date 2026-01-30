
// app.api.js — HARDENED FIX (non-breaking)

function _serverBase(){
  const base = (window.YOPO_SERVER_BASE || "").replace(/\/$/, "");
  if(!base){
    throw new Error("YOPO_SERVER_BASE_NOT_SET");
  }
  return base;
}

function _withTimeout(promise, ms=15000){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), ms);
  return promise(ctrl).finally(()=>clearTimeout(t));
}

async function _post(path, body, timeoutMs=15000){
  return _withTimeout(async (ctrl)=>{
    const res = await fetch(_serverBase()+path, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(body||{}),
      signal: ctrl.signal
    });
    if(!res.ok){
      const txt = await res.text().catch(()=>"");
      throw new Error(`SERVER_${res.status}:${txt}`);
    }
    const json = await res.json();
    if(json && json.ok === false){
      throw new Error(json.message || "SERVER_RESPONSE_NOT_OK");
    }
    return json;
  }, timeoutMs);
}

async function _get(path, timeoutMs=15000){
  return _withTimeout(async (ctrl)=>{
    const res = await fetch(_serverBase()+path, { signal: ctrl.signal });
    if(!res.ok){
      const txt = await res.text().catch(()=>"");
      throw new Error(`SERVER_${res.status}:${txt}`);
    }
    return await res.json();
  }, timeoutMs);
}

// ===== Engine APIs (used by UI) =====
async function serverPredict6tf(payload){
  return _post("/api/engine/predict6tf", payload);
}
async function serverScanAll(payload){
  return _post("/api/engine/scan_all", payload);
}
async function serverBacktest(payload){
  return _post("/api/engine/backtest", payload);
}

// ===== Evolve APIs =====
async function serverEvolveFeedback(payload){
  return _post("/api/evolve/feedback", payload);
}
async function serverEvolveStats(){
  return _get("/api/evolve/stats");
}

// ===== Bind to window =====
window.serverPredict6tf = serverPredict6tf;
window.serverScanAll = serverScanAll;
window.serverBacktest = serverBacktest;
window.serverEvolveFeedback = serverEvolveFeedback;
window.serverEvolveStats = serverEvolveStats;
