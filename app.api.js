/*************************************************************
 * YOPO AI PRO — app.api.js (FINAL)
 * 역할: 서버(Render) 엔진 호출 전담 (POST only)
 *************************************************************/

(function(){
  try{
    if(!window.YOPO_SERVER_BASE){
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
  const r = await fetch(base + path, {
    method: opts.method || "POST",
    headers: { "content-type":"application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if(!r.ok) throw new Error("SERVER_"+r.status);
  return await r.json();
}

// ===== Engine APIs =====
async function serverPredict6tf(body){
  return fetchServerJSON("/api/engine/predict6tf", { method:"POST", body });
}
async function serverScanAll(body){
  return fetchServerJSON("/api/engine/scan_all", { method:"POST", body });
}
async function serverBacktest(body){
  return fetchServerJSON("/api/engine/backtest", { method:"POST", body });
}
