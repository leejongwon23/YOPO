
/*************************************************************
 * YOPO AI PRO — app.features.js (PREDICT-ONLY · FINAL)
 * 역할:
 * - UI 부트스트랩
 * - 버튼 이벤트(통합예측/백테스트 팝업/리셋/취소)
 * - 코인목록 렌더 + Binance Futures 시세 폴링
 * - TradingView 차트(Binance Perp) 표시
 * - 정밀추적 LIVE 루프 + TP/SL/만료 처리 + evolve 피드백
 *
 * 원칙:
 * - 브라우저는 계산하지 않는다(서버 결과를 표시/추적만)
 *************************************************************/
(function(){
  // ---------- safe toast ----------
  const ok = (m)=>{ try{ if(typeof toast==='function') toast(m,'success'); }catch(e){} };
  const er = (m)=>{ try{ if(typeof toast==='function') toast(m,'error'); }catch(e){} };
  const wr = (m)=>{ try{ if(typeof toast==='function') toast(m,'warn'); }catch(e){} };

  // ---------- state ----------
  function ensureState(){
    if(typeof window.state!=='object' || !window.state){
      window.state = {};
    }
    if(!Array.isArray(state.universe)) state.universe = [];
    if(!state.symbol) state.symbol = "BTCUSDT";
    if(!Array.isArray(state.tracks)) state.tracks = []; // {id,symbol,tf,side,entry,tpPct,slPct,openedAt,closedAt,status,lastPrice}
  }

  // ---------- dom helpers ----------
  const $ = (id)=>document.getElementById(id);
  function setText(id, txt){ const el=$(id); if(el) el.textContent = txt; }
  function setHTML(id, html){ const el=$(id); if(el) el.innerHTML = html; }

  // ---------- modal ----------
  function openResultModal(title, subtitle, bodyHtml){
    const modal = $("result-modal");
    if(!modal) return;
    setText("modal-title", title||"결과");
    setText("modal-subtitle", subtitle||"");
    setHTML("modal-content", bodyHtml||"");
    modal.classList.add("show");
  }
  function closeResultModal(){
    const modal = $("result-modal");
    if(modal) modal.classList.remove("show");
  }

  // ---------- chart (TradingView Futures Perp) ----------
  let _tvWidget = null;
  function tvSymbol(sym){
    const s = String(sym||"BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g,'');
    return `BINANCE:${s}.P`;
  }
  function initChart(sym){
    const wrap = $("chart-wrap");
    if(!wrap) return;
    // clear container
    wrap.innerHTML = "";
    const symbol = tvSymbol(sym);
    try{
      if(window.TradingView && typeof window.TradingView.widget === "function"){
        _tvWidget = new window.TradingView.widget({
          autosize: true,
          symbol,
          interval: "15",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "kr",
          container_id: "chart-wrap",
          hide_top_toolbar: false,
          hide_legend: false,
          allow_symbol_change: false,
          withdateranges: true
        });
      }else{
        wrap.innerHTML = `<div style="padding:14px;color:#9fb0c7;">차트 로딩 중… (TradingView)</div>`;
      }
    }catch(e){
      wrap.innerHTML = `<div style="padding:14px;color:#ffb4b4;">차트 초기화 오류: ${String(e.message||e)}</div>`;
    }
  }

  // ---------- universe render ----------
  function renderMarketList(){
    const box = $("market-list-container");
    if(!box) return;

    const rows = (state.universe||[]).map(u=>{
      const sym = u.s;
      const price = (u.p!=null && Number.isFinite(u.p)) ? u.p : null;
      const chg = (u.chg!=null && Number.isFinite(u.chg)) ? u.chg : null;
      const active = (sym === state.symbol) ? ' active' : '';
      const priceTxt = (price==null) ? "--" : (price>=100 ? price.toFixed(2) : price>=1 ? price.toFixed(4) : price.toFixed(8));
      const chgTxt = (chg==null) ? "" : `${chg>0?'+':''}${chg.toFixed(2)}%`;
      const chgCls = (chg==null) ? '' : (chg>0?'pos':(chg<0?'neg':''));
      return `
        <div class="mrow${active}" data-sym="${sym}">
          <div class="msym">${sym}</div>
          <div class="mprice">${priceTxt}</div>
          <div class="mchg ${chgCls}">${chgTxt}</div>
        </div>`;
    }).join("");

    box.innerHTML = `<div class="market-list">${rows||'<div class="empty">유니버스 로딩중…</div>'}</div>`;

    // bind clicks
    box.querySelectorAll(".mrow").forEach(el=>{
      el.addEventListener("click", ()=>{
        const sym = el.getAttribute("data-sym");
        if(!sym) return;
        state.symbol = sym;
        renderMarketList();
        initChart(sym);
      });
    });
  }

  // ---------- operations ----------
  let _busy = false;
  function setBusy(v){
    _busy = !!v;
    // UI dots/buttons could be toggled here if needed
  }
  function isBusy(){ return _busy; }

  // ---------- server calls ----------
  async function predict6tf(){
    if(typeof window.serverPredict6tf !== "function") throw new Error("serverPredict6tf_NOT_READY");
    const sym = String(state.symbol||"BTCUSDT").toUpperCase();
    return await window.serverPredict6tf({ symbol: sym });
  }
  async function backtest6tf(symbol, limit){
    if(typeof window.serverBacktest !== "function") throw new Error("serverBacktest_NOT_READY");
    return await window.serverBacktest({ symbol, limit });
  }

  // ---------- backtest popup ----------
  function runBacktestPopup(){
    try{
      ensureState();
      const base = (window.YOPO_SERVER_BASE||"").replace(/\/$/,"");
      if(!base) return er("서버 주소(YOPO_SERVER_BASE)가 비어있습니다.");

      const popup = window.open("", "yopoBacktest", "width=980,height=720,noopener,noreferrer");
      if(!popup) return er("팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.");

      const symbols = (state.universe||[]).map(x=>x.s).filter(Boolean);
      const defaultSym = state.symbol || symbols[0] || "BTCUSDT";

      const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>YOPO 백테스트</title>
<style>
body{font-family:Pretendard,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0b1220;color:#e9eef7;}
header{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
main{padding:16px;}
select,input,button{background:#111a2e;color:#e9eef7;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;font-size:14px}
button{cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{background:#0f172a;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px}
.small{color:#9fb0c7;font-size:12px}
table{width:100%;border-collapse:collapse}
td,th{padding:10px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;font-size:13px}
.badge{padding:3px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.16);font-size:12px}
.pos{color:#7CFFB2} .neg{color:#FF7C7C}
</style></head>
<body>
<header>
  <b>백테스트(심볼별 · 6전략)</b>
  <span class="small">서버 계산 · Binance Futures 기준</span>
  <span style="flex:1"></span>
  <label class="small">심볼</label>
  <select id="sym"></select>
  <label class="small">캔들수</label>
  <input id="limit" type="number" min="240" max="1500" value="900" style="width:120px"/>
  <button id="go">실행</button>
  <span id="status" class="small"></span>
</header>
<main>
  <div id="out" class="grid"></div>
</main>
<script>
const BASE = ${JSON.stringify(base)};
const SYMBOLS = ${JSON.stringify(symbols)};
const DEFAULT = ${JSON.stringify(defaultSym)};
const tfLabel = (tf)=>tf;
const qs = (id)=>document.getElementById(id);
function card(tf, data){
  // server.js returns: {tf, trades, winRate, avgPnl, holdRate, note}
  const n = Number(data.trades||0);
  const wr = Number.isFinite(data.winRate) ? (Number(data.winRate)*100) : 0;
  const avg = Number(data.avgPnl||0);
  const cls = avg>=0 ? 'pos':'neg';
  const hold = Number.isFinite(data.holdRate) ? (Number(data.holdRate)*100) : 0;

  return (
    '<div class="card">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<b>' + tfLabel(tf) + '</b>' +
        '<span class="badge">' + n + ' trades</span>' +
        '<span class="badge">' + wr.toFixed(1) + '%</span>' +
        '<span class="badge ' + cls + '">avg ' + ((avg*100).toFixed(2)) + '%</span>' +
        '<span class="badge">hold ' + (hold.toFixed(0)) + '%</span>' +
      '</div>' +
      '<div class="small" style="margin-top:8px;">note=' + (data.note||'') + '</div>' +
    '</div>'
  );
}
async function _fetchJson(url, timeoutMs=12000){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(url, { signal: ctrl.signal, headers:{'accept':'application/json'} });
    if(!res.ok) return null;
    return await res.json().catch(()=>null);
  }catch(_e){
    return null;
  }finally{ clearTimeout(t); }
}
const FUTURES_BASES = ["https://fapi.binance.com","https://fapi.binance.vision"];

async function fetchKlines(sym, interval, limit){
  for(const base of FUTURES_BASES){
    const url = base + "/fapi/v1/klines?symbol=" + encodeURIComponent(sym) + "&interval=" + encodeURIComponent(interval) + "&limit=" + encodeURIComponent(limit);
    const j = await _fetchJson(url, 12000);
    if(Array.isArray(j) && j.length){
      return j.map(k=>({ts:k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}));
    }
  }
  return null;
}

async function post(path, body){
  // ✅ NO PROXY: browser fetches candles directly, server calculates only
  const sym = String((body&&body.symbol)||"BTCUSDT").toUpperCase();
  const limit = Number((body&&body.limit)||900);
  const tfs = ['15m','30m','1h','4h','1d','1w'];
  const candlesByTf = {};
  for(const tf of tfs){
    const c = await fetchKlines(sym, tf, limit);
    if(c) candlesByTf[tf] = c;
  }

  const res = await fetch(BASE+path, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ ...(body||{}), symbol:sym, limit, candlesByTf })
  });
  const js = await res.json().catch(()=>null);
  if(!res.ok || !js) throw new Error('SERVER_'+res.status);
  return js;
}
function render(out){
  const box = qs('out');
  if(!out || !out.ok){ box.innerHTML='<div class="card">실패: '+(out?.message||'UNKNOWN')+'</div>'; return; }
  const arr = Array.isArray(out.results) ? out.results : [];
  const map = {};
  for(const r of arr){ if(r && r.tf) map[r.tf]=r; }
  const order = ['15m','30m','1h','4h','1d','1w'];
  box.innerHTML = order.map(tf=>card(tf, map[tf]||{})).join('');
}
function fillSymbols(){
  const sel = qs('sym');
  sel.innerHTML = SYMBOLS.map(s=>\`<option value="\${s}">\${s}</option>\`).join('');
  sel.value = DEFAULT;
}
fillSymbols();
qs('go').addEventListener('click', async ()=>{
  qs('status').textContent='실행중…';
  qs('out').innerHTML='';
  try{
    const sym = qs('sym').value;
    const limit = Number(qs('limit').value||900);
    const out = await post('/api/engine/backtest', {symbol:sym, limit});
    render(out);
    qs('status').textContent='완료';
  }catch(e){
    qs('status').textContent='실패';
    qs('out').innerHTML='<div class="card">오류: '+String(e.message||e)+'</div>';
  }
});
</script>
</body></html>`;

      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      ok("백테스트 팝업을 열었습니다.");
    }catch(e){
      er(String(e.message||e));
    }
  }

  // ---------- live prices ----------
  async function refreshUniverse(){
    if(typeof window.refreshUniverseAndGlobals !== "function") return;
    const out = await window.refreshUniverseAndGlobals();
    // expected: {ok:true, symbols:[...], ts}
    if(out && out.ok && Array.isArray(out.symbols)){
      const now = Date.now();
      state.universe = out.symbols.map(s=>({ s:String(s).toUpperCase(), p:null, chg:null, ts:now }));
      setText("universe-ts", "업데이트: " + new Date(out.ts || now).toLocaleTimeString());
      // keep current symbol valid
      if(!state.universe.find(x=>x.s===state.symbol)){
        state.symbol = state.universe[0]?.s || state.symbol;
      }
      renderMarketList();
      initChart(state.symbol);
    }
  }

  async function pollPricesOnce(){
    const syms = new Set();
    (state.universe||[]).forEach(u=>u?.s && syms.add(u.s));
    (state.tracks||[]).forEach(t=>t?.symbol && syms.add(t.symbol));
    if(state.symbol) syms.add(state.symbol);

    for(const sym of syms){
      try{
        const out = await window.marketTick(sym);
        if(out && out.ok && Number.isFinite(out.price)){
          const price = Number(out.price);
          // update universe price
          const u = (state.universe||[]).find(x=>x.s===sym);
          if(u){
            u.p = price;
            u.chg = Number.isFinite(out.chg) ? Number(out.chg) : (Number.isFinite(out.changePct) ? Number(out.changePct) : u.chg);
            u.ts = Date.now();
          }
          // update tracks
          updateTracksWithPrice(sym, price);
        }
      }catch(e){}
    }
    renderMarketList();
    renderTracks();
  }

  // ---------- tracking ----------
  function newTrackId(){
    return "T"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  }
  function addTrackFromBest(best, perTf){
    const side = best.action;
    if(side!=="LONG" && side!=="SHORT") return wr("HOLD는 추적하지 않습니다.");
    const tf = best.tf || "15m";
    const tfObj = (perTf||[]).find(x=>x.tf===tf) || {};
    const entry = Number(best.lastClose || tfObj.lastClose || NaN);
    const tpPct = Number(tfObj.tpPct || 0.01);
    const slPct = Number(tfObj.slPct || 0.01);
    if(!Number.isFinite(entry)) return er("진입가를 계산할 수 없습니다.");
    const t = {
      id: newTrackId(),
      symbol: String(state.symbol).toUpperCase(),
      tf,
      side,
      entry,
      tpPct,
      slPct,
      openedAt: Date.now(),
      closedAt: null,
      status: "OPEN",
      lastPrice: entry
    };
    state.tracks.unshift(t);
    ok(`추적 시작: ${t.symbol} ${t.side} (${t.tf})`);
    renderTracks();
  }

  function updateTracksWithPrice(symbol, price){
    const now = Date.now();
    for(const t of (state.tracks||[])){
      if(t.status!=="OPEN") continue;
      if(t.symbol !== symbol) continue;
      t.lastPrice = price;

      const tp = (t.side==="LONG") ? t.entry*(1+t.tpPct) : t.entry*(1-t.tpPct);
      const sl = (t.side==="LONG") ? t.entry*(1-t.slPct) : t.entry*(1+t.slPct);

      let hit = null;
      if(t.side==="LONG"){
        if(price >= tp) hit = "TP";
        else if(price <= sl) hit = "SL";
      }else{
        if(price <= tp) hit = "TP";
        else if(price >= sl) hit = "SL";
      }

      if(hit){
        t.status = hit;
        t.closedAt = now;
        // evolve feedback (best effort)
        try{
          if(typeof window.serverEvolveFeedback === "function"){
            window.serverEvolveFeedback({
              symbol: t.symbol,
              tf: t.tf,
              action: t.side,
              side: t.side,
              result: hit,
              entry: t.entry,
              exit: price,
              tpPct: t.tpPct,
              slPct: t.slPct,
              openedAt: t.openedAt,
              closedAt: t.closedAt
            }).catch(()=>{});
          }
        }catch(e){}
      }
    }
  }

  function renderTracks(){
    const box = $("tracking-container");
    if(!box) return;
    const list = (state.tracks||[]);
    if(!list.length){
      box.innerHTML = `<div class="empty">추적 중인 포지션이 없습니다.</div>`;
      setText("active-stat", "0");
      return;
    }
    setText("active-stat", String(list.filter(x=>x.status==="OPEN").length));

    box.innerHTML = list.map(t=>{
      const nowPrice = Number(t.lastPrice||t.entry);
      const pnl = (t.side==="LONG") ? (nowPrice/t.entry - 1) : (t.entry/nowPrice - 1);
      const pnlTxt = Number.isFinite(pnl) ? (pnl*100).toFixed(2)+"%" : "--";
      const pnlCls = pnl>=0 ? "pos" : "neg";
      const tp = (t.side==="LONG") ? t.entry*(1+t.tpPct) : t.entry*(1-t.tpPct);
      const sl = (t.side==="LONG") ? t.entry*(1-t.slPct) : t.entry*(1+t.slPct);
      const status = t.status;
      return `
      <div class="tcard ${status!=="OPEN"?'closed':''}">
        <div class="trow">
          <b>${t.symbol}</b>
          <span class="pill">${t.tf}</span>
          <span class="pill">${t.side}</span>
          <span class="pill ${status==='TP'?'pos':status==='SL'?'neg':''}">${status}</span>
          <span style="flex:1"></span>
          <span class="pnl ${pnlCls}">${pnlTxt}</span>
        </div>
        <div class="tsub">
          entry ${t.entry.toFixed(4)} · now ${nowPrice.toFixed(4)} · tp ${tp.toFixed(4)} · sl ${sl.toFixed(4)}
        </div>
      </div>`;
    }).join("");
  }

  // ---------- predict action ----------
  async function onPredict(){
    if(isBusy()) return wr("작업 진행 중입니다. 잠시 후 다시 시도하세요.");
    setBusy(true);
    try{
      ensureState();
      const out = await predict6tf();
      if(!out || !out.ok) throw new Error(out?.message || "PREDICT_FAIL");

      const best = out.best || {};
      const results = out.results || [];

      const bestTf = best.tf || "-";
      const bestSide = best.action || "HOLD";
      const bestEv = (best.ev!=null && Number.isFinite(best.ev)) ? best.ev.toFixed(4) : "-";
      const lastClose = (best.lastClose!=null && Number.isFinite(best.lastClose)) ? Number(best.lastClose) : null;

      // build table
      const rows = results.map(r=>{
        const ev = (r.action==="LONG") ? r.evLong : (r.action==="SHORT" ? r.evShort : null);
        const evTxt = (ev!=null && Number.isFinite(ev)) ? ev.toFixed(4) : "-";
        const lc = (r.lastClose!=null && Number.isFinite(r.lastClose)) ? Number(r.lastClose).toFixed(4) : "--";
        const tp = (r.tpPct!=null && Number.isFinite(r.tpPct)) ? (r.tpPct*100).toFixed(2)+"%" : "--";
        const sl = (r.slPct!=null && Number.isFinite(r.slPct)) ? (r.slPct*100).toFixed(2)+"%" : "--";
        return `<tr>
          <td>${r.tf}</td><td>${r.action||'HOLD'}</td><td>${r.regime||'-'}</td>
          <td>${evTxt}</td><td>${tp}</td><td>${sl}</td><td>${lc}</td>
        </tr>`;
      }).join("");

      const btnTrack = (bestSide==="LONG" || bestSide==="SHORT")
        ? `<button id="btn-track" class="btn primary" style="margin-top:10px;width:100%;">정밀추적 시작</button>`
        : `<div class="small" style="margin-top:10px;color:#9fb0c7;">HOLD는 추적하지 않습니다.</div>`;

      const body = `
        <div class="cardbox">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <b>${out.symbol}</b>
            <span class="pill">${bestTf}</span>
            <span class="pill">${bestSide}</span>
            <span class="pill">EV ${bestEv}</span>
            ${lastClose!=null?`<span class="pill">last ${lastClose.toFixed(4)}</span>`:""}
          </div>
          <div class="small" style="margin-top:8px;">best reason: ${best.reason||'-'}</div>
          <div style="overflow:auto;margin-top:10px;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr>
                <th>TF</th><th>Action</th><th>Regime</th><th>EV</th><th>TP</th><th>SL</th><th>Last</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${btnTrack}
        </div>
      `;
      openResultModal("통합예측 결과", "서버 계산 · Binance Futures", body);

      // bind track
      setTimeout(()=>{
        const b = document.getElementById("btn-track");
        if(b){
          b.addEventListener("click", ()=>{
            try{
              addTrackFromBest(best, results);
              closeResultModal();
            }catch(e){ er(String(e.message||e)); }
          });
        }
      }, 0);

    }catch(e){
      er(String(e.message||e));
    }finally{
      setBusy(false);
    }
  }

  // ---------- reset ----------
  function resetAll(){
    ensureState();
    state.tracks = [];
    ok("초기화 완료");
    renderTracks();
  }

  
  // ---------- legacy window bindings (index.html onclick compatibility) ----------
  // index.html may call these via onclick. Keep them defined to prevent ReferenceError.
  window.executeAnalysisAll = window.executeAnalysisAll || (async function(){ return onPredict(); });
  // backtest is opened in a popup; accept optional params but ignore them safely.
  window.runBacktest = window.runBacktest || (function(_opts){ return runBacktestPopup(); });

// ---------- boot ----------
  async function boot(){
    ensureState();

    // bind modal close
    const modal = $("result-modal");
    if(modal){
      modal.addEventListener("click", (e)=>{
        if(e.target === modal) closeResultModal();
      });
    }
    const closeBtn = $("op-cancel-btn");
    if(closeBtn){
      closeBtn.addEventListener("click", closeResultModal);
    }

    // bind buttons
    const predictBtn = $("predict-all-btn");
    if(predictBtn) predictBtn.addEventListener("click", onPredict);
    const btBtn = $("backtest-btn");
    if(btBtn) btBtn.addEventListener("click", runBacktestPopup);
    const resetBtn = $("reset-all-btn");
    if(resetBtn) resetBtn.addEventListener("click", resetAll);

    // first universe
    await refreshUniverse().catch(()=>{});
    renderMarketList();
    initChart(state.symbol);
    renderTracks();

    // loops
    setInterval(()=>{ pollPricesOnce().catch(()=>{}); }, 2000);
    setInterval(()=>{ refreshUniverse().catch(()=>{}); }, 60000);
  }

  // start after DOM ready
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
