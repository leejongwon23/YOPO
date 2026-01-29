/*************************************************************
 * YOPO AI PRO — app.features.js (FINAL · CLEAR ERRORS)
 * 역할:
 * - 버튼 클릭 시 서버 호출
 * - 실패 사유(code/message)를 사용자에게 그대로 표시
 *************************************************************/

async function _handleServerCall(fn, actionName){
  try{
    const res = await fn();
    if(!res || res.ok === false){
      throw new Error(res?.message || "UNKNOWN_SERVER_ERROR");
    }
    toast(`${actionName} 성공`, "success");
    return res;
  }catch(e){
    toast(`${actionName} 실패: ${e.message}`, "error");
    throw e;
  }
}

/* ===== Buttons ===== */
async function executeAnalysisAll(){
  return _handleServerCall(
    ()=>serverPredict6tf({ symbol: state?.activeSymbol || "BTCUSDT" }),
    "통합예측"
  );
}

async function autoScanUniverseAll(){
  return _handleServerCall(
    ()=>serverScanAll({}),
    "자동스캔"
  );
}

async function runBacktest(){
  return _handleServerCall(
    ()=>serverBacktest({}),
    "백테스트"
  );
}
