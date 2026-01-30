
// app.features.js — FULL FIX (non-silent, UI-wired)

/* =========================
   Helpers
========================= */
function _assert(fn, name){
  if(typeof fn !== 'function') throw new Error(name + "_NOT_READY");
  return fn;
}

function _toastOk(msg){
  try{ toast(msg, "success"); }catch(e){}
}
function _toastErr(msg){
  try{ toast(msg, "error"); }catch(e){}
}

/* =========================
   Core Actions (buttons)
========================= */
async function executeAnalysisAll(){
  try{
    _assert(window.serverPredict6tf, "serverPredict6tf");
    const res = await serverPredict6tf({ symbol: state?.activeSymbol || "BTCUSDT" });
    _toastOk("통합 예측 완료");
    // minimal render hook (safe)
    if(res && typeof openResultModal === "function"){
      openResultModal(res);
    }
    return res;
  }catch(e){
    _toastErr(e.message || "PREDICT_FAILED");
    throw e;
  }
}

async function autoScanUniverseAll(opts={}){
  try{
    _assert(window.serverScanAll, "serverScanAll");
    const res = await serverScanAll({});
    _toastOk("자동 스캔 완료");
    if(opts.openModal && typeof openScanListModal === "function"){
      openScanListModal();
    }
    return res;
  }catch(e){
    _toastErr(e.message || "SCAN_FAILED");
    throw e;
  }
}

async function runBacktest(opts={}){
  try{
    _assert(window.serverBacktest, "serverBacktest");
    const res = await serverBacktest({});
    _toastOk("백테스트 완료");
    if(opts.openModal && typeof openBacktestModal === "function"){
      openBacktestModal();
    }
    return res;
  }catch(e){
    _toastErr(e.message || "BACKTEST_FAILED");
    throw e;
  }
}

/* =========================
   Bindings (no optional chaining)
========================= */
window.executeAnalysisAll = executeAnalysisAll;
window.autoScanUniverseAll = autoScanUniverseAll;
window.runBacktest = runBacktest;
