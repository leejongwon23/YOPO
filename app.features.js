
/*************************************************************
 * YOPO AI PRO — app.features.js (REBUILT · CURRENT)
 * 역할:
 * - 부트스트랩
 * - 버튼 이벤트 → app.api.js 서버 호출
 * - 결과를 기존 UI 훅으로 전달 (있을 때만)
 *************************************************************/

(function(){
  // ---- guards ----
  const ok = (m)=>{ try{ if(typeof toast==='function') toast(m,'success'); }catch(e){} };
  const er = (m)=>{ try{ if(typeof toast==='function') toast(m,'error'); }catch(e){} };

  function need(fn, name){
    if(typeof fn !== 'function') throw new Error(name+'_NOT_READY');
    return fn;
  }

  // ---- bootstrap ----
  try{
    if(typeof window.state !== 'object'){
      window.state = { activeSymbol: 'BTCUSDT' };
    }
  }catch(e){}

  // ---- handlers ----
  async function executeAnalysisAll(){
    try{
      need(window.serverPredict6tf, 'serverPredict6tf');
      const symbol = state.activeSymbol || 'BTCUSDT';
      const res = await serverPredict6tf({ symbol });
      ok('통합 예측 완료');
      try{
        if(typeof renderUnifiedResults==='function') renderUnifiedResults(res);
        if(typeof openResultModal==='function') openResultModal(res);
      }catch(e){}
      return res;
    }catch(e){
      er(e.message||'PREDICT_FAILED');
      throw e;
    }
  }

  async function autoScanUniverseAll(){
    try{
      need(window.serverScanAll, 'serverScanAll');
      const res = await serverScanAll({});
      ok('자동 스캔 완료');
      try{
        if(typeof renderScanResults==='function') renderScanResults(res);
        if(typeof openScanListModal==='function') openScanListModal();
      }catch(e){}
      return res;
    }catch(e){
      er(e.message||'SCAN_FAILED');
      throw e;
    }
  }

  async function runBacktest(){
    try{
      need(window.serverBacktest, 'serverBacktest');
      const res = await serverBacktest({});
      ok('백테스트 완료');
      try{
        if(typeof renderBacktest==='function') renderBacktest(res);
        if(typeof openBacktestModal==='function') openBacktestModal();
      }catch(e){}
      return res;
    }catch(e){
      er(e.message||'BACKTEST_FAILED');
      throw e;
    }
  }

  // ---- expose ----
  window.executeAnalysisAll = executeAnalysisAll;
  window.autoScanUniverseAll = autoScanUniverseAll;
  window.runBacktest = runBacktest;

})();
