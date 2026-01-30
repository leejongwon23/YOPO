
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
