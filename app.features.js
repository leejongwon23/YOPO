
// FIXED app.features.js — safe call guards
async function executeAnalysisAll(){
  if(!window.serverPredict6tf) throw new Error("API_NOT_READY");
  return serverPredict6tf({ symbol: state?.activeSymbol || "BTCUSDT" });
}
async function autoScanUniverseAll(){
  if(!window.serverScanAll) throw new Error("API_NOT_READY");
  return serverScanAll({});
}
async function runBacktest(){
  if(!window.serverBacktest) throw new Error("API_NOT_READY");
  return serverBacktest({});
}
