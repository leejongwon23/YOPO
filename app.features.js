
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

/* =========================
   __YOPO_FEATURES_PATCH__
   - ensure button handlers exist (no silent fail)
========================= */
(function(){
  const _ok = (m)=>{ try{ if(typeof toast==='function') toast(m,'success'); }catch(e){} };
  const _er = (m)=>{ try{ if(typeof toast==='function') toast(m,'error'); }catch(e){} };

  async function _call(fnName, payload, okMsg){
    const fn = window[fnName];
    if(typeof fn !== "function") throw new Error(fnName+"_NOT_READY");
    const res = await fn(payload||{});
    _ok(okMsg);
    return res;
  }

  // If original handlers exist, keep them. Otherwise provide safe defaults.
  window.executeAnalysisAll = window.executeAnalysisAll || (async function(){
    const symbol = (window.state && state.activeSymbol) ? state.activeSymbol : "BTCUSDT";
    const res = await _call("serverPredict6tf", { symbol }, "통합 예측 완료");
    try{ if(typeof openResultModal==="function") openResultModal(res); }catch(e){}
    return res;
  });

  window.autoScanUniverseAll = window.autoScanUniverseAll || (async function(){
    const res = await _call("serverScanAll", {}, "자동 스캔 완료");
    try{ if(typeof openScanListModal==="function") openScanListModal(); }catch(e){}
    return res;
  });

  window.runBacktest = window.runBacktest || (async function(){
    const res = await _call("serverBacktest", {}, "백테스트 완료");
    try{ if(typeof openBacktestModal==="function") openBacktestModal(); }catch(e){}
    return res;
  });
})();
