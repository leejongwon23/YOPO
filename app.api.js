
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
async function serverScanAll(payload){
  return _post("/api/engine/scan_all", payload);
}
async function serverBacktest(payload){
  return _post("/api/engine/backtest", payload);
}

// window 바인딩 (중요)
window.serverPredict6tf = serverPredict6tf;
window.serverScanAll = serverScanAll;
window.serverBacktest = serverBacktest;

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
window.serverScanAll   = window.serverScanAll   || ((payload)=>_yopoPost("/api/engine/scan_all", payload));
window.serverBacktest  = window.serverBacktest  || ((payload)=>_yopoPost("/api/engine/backtest", payload));
window.serverEvolveFeedback = window.serverEvolveFeedback || ((payload)=>_yopoPost("/api/evolve/feedback", payload));
window.serverEvolveStats    = window.serverEvolveStats    || (()=>_yopoGet("/api/evolve/stats"));
