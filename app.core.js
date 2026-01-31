/*************************************************************
 * YOPO AI PRO — app.core.js (UI CORE · FINAL)
 * 역할:
 * - 전역 상태(state) 생성/유지
 * - UI 공통 유틸(토스트/DOM helper)
 * - 통계/히스토리(표시용) 최소 구현
 *
 * 원칙:
 * - 브라우저는 계산하지 않는다(표시/상태/기록만)
 *************************************************************/
(function(){
  // ---------- DOM helpers ----------
  const $ = (id)=>document.getElementById(id);

  // ---------- state ----------
  function ensureState(){
    if(typeof window.state !== "object" || !window.state) window.state = {};
    const s = window.state;

    if(!s.symbol) s.symbol = "BTCUSDT";
    if(!Array.isArray(s.universe)) s.universe = [];
    if(!Array.isArray(s.tracks)) s.tracks = [];
    if(!s.chartInterval) s.chartInterval = "15"; // TradingView interval
    if(!s.stats || typeof s.stats !== "object"){
      s.stats = { total:0, win:0, history:[] }; // history: [{ts,symbol,tf,side,result,pnlPct}]
    }
    return s;
  }

  // ---------- toast ----------
  function ensureToastRoot(){
    let root = document.getElementById("toast-root");
    if(root) return root;
    root = document.createElement("div");
    root.id = "toast-root";
    root.style.position = "fixed";
    root.style.zIndex = "99999";
    root.style.right = "14px";
    root.style.bottom = "14px";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.gap = "8px";
    document.body.appendChild(root);
    return root;
  }

  function toast(msg, type="success"){
    try{
      const root = ensureToastRoot();
      const box = document.createElement("div");
      box.textContent = String(msg||"");
      box.style.padding = "10px 12px";
      box.style.borderRadius = "12px";
      box.style.fontWeight = "900";
      box.style.fontSize = "12px";
      box.style.backdropFilter = "blur(6px)";
      box.style.border = "1px solid rgba(0,0,0,.10)";
      box.style.boxShadow = "0 10px 22px rgba(0,0,0,.10)";
      box.style.maxWidth = "72vw";

      const palette = {
        success: { bg:"rgba(230,255,250,.92)", fg:"#047857" },
        error:   { bg:"rgba(255,245,245,.92)", fg:"#b91c1c" },
        warn:    { bg:"rgba(255,251,235,.92)", fg:"#b45309" },
        info:    { bg:"rgba(239,246,255,.92)", fg:"#1d4ed8" },
      };
      const p = palette[type] || palette.info;
      box.style.background = p.bg;
      box.style.color = p.fg;

      root.appendChild(box);
      setTimeout(()=>{ try{ box.style.opacity="0"; box.style.transform="translateY(6px)"; }catch(e){} }, 2200);
      setTimeout(()=>{ try{ box.remove(); }catch(e){} }, 2600);
    }catch(e){
      // last resort
      console.log("[toast]", type, msg);
    }
  }

  // ---------- stats/history UI ----------
  function renderStats(){
    const s = ensureState();
    const total = Number(s.stats.total||0);
    const win = Number(s.stats.win||0);
    const winRate = total>0 ? (win/total*100) : 0;

    const totalEl = $("total-stat");
    const winEl = $("win-stat");
    if(totalEl) totalEl.textContent = String(total);
    if(winEl) winEl.textContent = total>0 ? winRate.toFixed(0)+"%" : "0%";

    const hc = $("history-count");
    if(hc) hc.textContent = String((s.stats.history||[]).length);
  }

  function renderHistory(){
    const s = ensureState();
    const box = $("history-container");
    if(!box) return;

    const list = (s.stats.history||[]);
    if(!list.length){
      box.innerHTML = '<div style="font-size:11px; color:var(--text-sub); font-weight:900; padding:4px 2px;">아직 종료된 기록이 없습니다.</div>';
      return;
    }

    const rows = list.slice(0, 30).map(h=>{
      const ts = new Date(h.ts||Date.now()).toLocaleTimeString();
      const win = (h.result === "TP") || (h.result === "WIN") || (h.win===true);
      const badge = win ? '<span class="badge-win">WIN</span>' : '<span class="badge-lose">LOSE</span>';
      const pnl = (typeof h.pnlPct === "number" && isFinite(h.pnlPct)) ? (h.pnlPct>=0?"+":"")+h.pnlPct.toFixed(2)+"%" : "";
      return `
        <div class="history-item">
          <div class="left">${badge}<b>${h.symbol||""}</b><span class="pill">${h.tf||""}</span><span class="pill">${h.side||h.action||""}</span></div>
          <div style="text-align:right">
            <div style="font-weight:950">${pnl}</div>
            <div style="font-size:10px; color:var(--text-sub); font-weight:850">${ts}</div>
          </div>
        </div>`;
    }).join("");

    box.innerHTML = rows;
  }

  function addOutcomeToStats(evt){
    const s = ensureState();
    s.stats.total = Number(s.stats.total||0) + 1;
    const win = (evt.result === "TP") || (evt.result === "WIN") || (evt.win===true);
    if(win) s.stats.win = Number(s.stats.win||0) + 1;

    s.stats.history.unshift({
      ts: evt.ts || Date.now(),
      symbol: evt.symbol || "",
      tf: evt.tf || "",
      side: evt.side || evt.action || "",
      result: evt.result || (win ? "WIN" : "LOSE"),
      win,
      pnlPct: (typeof evt.pnlPct === "number" && isFinite(evt.pnlPct)) ? evt.pnlPct : undefined
    });

    // keep small
    if(s.stats.history.length > 60) s.stats.history.length = 60;

    renderStats();
    renderHistory();
  }

  function resetStatsData(){
    const s = ensureState();
    s.stats.total = 0;
    s.stats.win = 0;
    s.stats.history = [];
    renderStats();
    renderHistory();
  }

  function cancelAllTrackingData(){
    const s = ensureState();
    s.tracks = [];
    // active-stat is rendered in app.features.js, but we also try to zero it here for safety
    const a = $("active-stat");
    if(a) a.textContent = "0";
  }

  // ---------- expose ----------
  window.toast = window.toast || toast;
  window.__yopoAddOutcomeToStats = window.__yopoAddOutcomeToStats || addOutcomeToStats;

  // index.html uses optional chaining on these; provide real ones for reliability.
  window.resetStatsUIAndData = window.resetStatsUIAndData || function(){
    resetStatsData();
    toast("누적 리셋 완료", "success");
  };
  window.cancelAllTracking = window.cancelAllTracking || function(){
    cancelAllTrackingData();
    toast("추적 전체취소 완료", "success");
  };

  // boot render once
  function boot(){
    ensureState();
    renderStats();
    renderHistory();
  }
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
