/*
 * Overlay content script for supported stock sites.
 * - Extracts the stock symbol from the URL
 * - Shows a floating launcher
 * - Requests research from the ChatGPT automation script (via background)
 * - Renders the returned JSON as a clean metrics panel
 */
(function () {
  "use strict";

  const SR = (typeof StockResearch !== "undefined" && StockResearch) || {};
  const EXTRACT = SR.extract;
  const JSONX = SR.json;
  const MOCK = SR.mock;
  const PROMPT = SR.prompt;

  if (!EXTRACT || !JSONX) return;

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif; }
.host-root { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
.fab {
  position: fixed; right: 20px; bottom: 20px; pointer-events: auto;
  width: 52px; height: 52px; border-radius: 50%; border: 1px solid rgba(255,255,255,.14);
  background: linear-gradient(135deg,#7c5cff,#4f8cff); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;
  box-shadow: 0 10px 30px rgba(79,140,255,.45); letter-spacing: .3px;
  transition: transform .15s ease, box-shadow .15s ease;
}
.fab:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 14px 34px rgba(79,140,255,.55); }
.fab .dot { position:absolute; top:-6px; right:-6px; background:#16c784; color:#04120c; font-size:9px; font-weight:800; padding:2px 5px; border-radius:8px; }
.panel {
  position: fixed; right: 20px; bottom: 84px; width: 384px; max-width: calc(100vw - 40px);
  max-height: min(78vh, 720px); pointer-events: auto; display: flex; flex-direction: column;
  background: rgba(16,19,27,.96); color: #e7e9f0; border: 1px solid rgba(255,255,255,.10);
  border-radius: 16px; box-shadow: 0 24px 60px rgba(0,0,0,.55); overflow: hidden;
  backdrop-filter: blur(14px); animation: sr-in .18s ease-out;
}
@keyframes sr-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.panel.hidden { display: none; }
.head { display: flex; align-items: center; gap: 10px; padding: 13px 14px; border-bottom: 1px solid rgba(255,255,255,.07); background: rgba(255,255,255,.02); }
.head .sym { font-weight: 800; font-size: 15px; letter-spacing: .3px; }
.head .company { font-size: 11px; color: #9aa1b4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
.head .spacer { flex: 1; }
.iconbtn { background: transparent; border: none; color: #9aa1b4; cursor: pointer; font-size: 16px; line-height: 1; padding: 4px 6px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
.iconbtn:hover { background: rgba(255,255,255,.08); color: #fff; }
.iconbtn .ic { width: 15px; height: 15px; }
.iconbtn.openlink { color: #7fb2ff; }
.iconbtn.openlink:hover { color: #bcd9ff; background: rgba(127,178,255,.12); }
.srcicon { background: transparent; border: none; color: #6f86ff; cursor: pointer; padding: 5px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.srcicon .ic { width: 13px; height: 13px; }
.srcicon:hover { background: rgba(124,92,255,.2); color: #cdc0ff; }
.body { padding: 14px; overflow-y: auto; }
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 8px; }
.muted { color: #9aa1b4; font-size: 12px; }
.center { text-align: center; }
.btn {
  width: 100%; padding: 11px 14px; border-radius: 11px; border: 1px solid transparent; cursor: pointer;
  font-weight: 700; font-size: 13px; background: linear-gradient(135deg,#7c5cff,#4f8cff); color: #fff;
  transition: filter .15s ease;
}
.btn:hover { filter: brightness(1.08); }
.btn.ghost { background: rgba(255,255,255,.06); color: #cfd3df; border-color: rgba(255,255,255,.12); font-weight: 600; }
.btn.ghost:hover { background: rgba(255,255,255,.12); }
.row { display: flex; gap: 8px; margin-top: 10px; }
.badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.badge { font-size: 10px; font-weight: 800; letter-spacing: .4px; padding: 4px 8px; border-radius: 999px; background: rgba(124,92,255,.16); color: #b9a9ff; border: 1px solid rgba(124,92,255,.35); text-transform: uppercase; transition: background .15s ease, transform .15s ease; }
.badge:hover { background: rgba(124,92,255,.28); }
.topline { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.ltp { font-size: 26px; font-weight: 800; }
.ltp small { font-size: 11px; font-weight: 600; color: #9aa1b4; margin-left: 4px; }
.pill { font-size: 12px; font-weight: 800; padding: 6px 12px; border-radius: 999px; letter-spacing: .5px; }
.pill.BUY { background: rgba(22,199,132,.16); color: #16c784; border: 1px solid rgba(22,199,132,.4); }
.pill.SELL { background: rgba(234,57,67,.16); color: #ff6b73; border: 1px solid rgba(234,57,67,.4); }
.pill.HOLD { background: rgba(245,166,35,.16); color: #f5a623; border: 1px solid rgba(245,166,35,.4); }
.pill.EXIT { background: rgba(139,143,154,.18); color: #c2c6d0; border: 1px solid rgba(139,143,154,.4); }
.section { margin-top: 12px; }
.section-title { font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #7e879c; margin-bottom: 8px; padding-left: 7px; border-left: 3px solid #7c5cff; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.grid3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
.card { background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.07); border-radius: 11px; padding: 9px 10px; transition: background .15s ease, border-color .15s ease; }
.card:hover { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.13); }
.card .k { font-size: 10px; color: #8b93a7; margin-bottom: 3px; }
.card .v { font-size: 14px; font-weight: 700; }
.up { color: #16c784; } .down { color: #ff6b73; } .flat { color: #c2c6d0; }
.valbar { height: 8px; border-radius: 6px; background: linear-gradient(90deg,#16c784,#f5a623,#ea3943); margin: 9px 0 6px; position: relative; }
.valbar .mark { position: absolute; top: -4px; width: 2px; height: 16px; background: #fff; border-radius: 2px; box-shadow: 0 0 6px rgba(255,255,255,.8); }
.spinner { width: 22px; height: 22px; border: 3px solid rgba(255,255,255,.18); border-top-color: #7c5cff; border-radius: 50%; animation: sr-spin .8s linear infinite; margin: 0 auto 12px; }
@keyframes sr-spin { to { transform: rotate(360deg); } }
.steps { margin-top: 14px; text-align: left; display: inline-block; }
.step { font-size: 11px; color: #6f778c; display: flex; align-items: center; gap: 7px; margin: 5px 0; }
.step.active { color: #cfd3df; }
.step .tick { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid currentColor; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; }
.step.done .tick { background: #16c784; border-color: #16c784; color: #04120c; }
.err { color: #ff8b92; font-size: 12px; line-height: 1.5; }
.foot { padding: 10px 14px; border-top: 1px solid rgba(255,255,255,.07); display: flex; gap: 8px; align-items: center; }
.foot .muted { flex: 1; font-size: 10px; }
.smallbtn { pointer-events: auto; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: #cfd3df; border-radius: 8px; padding: 6px 10px; font-size: 11px; cursor: pointer; font-weight: 600; }
.smallbtn:hover { background: rgba(255,255,255,.12); }
.lead { font-size: 13px; line-height: 1.6; color: #cfd3df; margin-bottom: 2px; }
.sectorrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tailwind { font-size: 10px; font-weight: 800; letter-spacing: .4px; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; }
.tailwind.yes { background: rgba(22,199,132,.14); color: #16c784; border: 1px solid rgba(22,199,132,.35); }
.tailwind.no { background: rgba(234,57,67,.14); color: #ff6b73; border: 1px solid rgba(234,57,67,.35); }
.newslist { display: flex; flex-direction: column; gap: 10px; }
.newitem { font-size: 11px; line-height: 1.5; display: flex; gap: 8px; align-items: flex-start; }
.newitem .txt { flex: 1; min-width: 0; }
.newitem .t { color: #e7e9f0; }
.newitem .sub { color: #8b93a7; margin-top: 1px; }
`;

  // ---- state ------------------------------------------------------------
  let info = EXTRACT.parseUrl(location.href);
  const state = {
    status: "idle", // idle | loading | result | error
    requestId: null,
    phase: "starting",
    message: null,
    payload: null,
    error: null,
    open: false,
    fromCache: false,
    cachedAt: null
  };
  let settings = { demo: false, autoResearch: true, autoOpen: true };
  let host = null;
  let root = null;
  let ui = null;

  // ---- helpers ----------------------------------------------------------
  const LINK_SVG =
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

  const SCREENER_DOMAIN = "www.screener.in";

  function screenerUrl(symbol) {
    return "https://" + SCREENER_DOMAIN + "/company/" + encodeURIComponent(String(symbol || "")) + "/";
  }

  function uid() {
    if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
    return "req-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function cacheKey(symbol) {
    return "cache:" + String(symbol || "").toUpperCase();
  }

  function readCache(symbol, cb) {
    try {
      const k = cacheKey(symbol);
      chrome.storage.local.get(k, (o) => cb(o && o[k] ? o[k] : null));
    } catch (e) {
      cb(null);
    }
  }

  function writeCache(symbol, payload) {
    try {
      chrome.storage.local.set({
        [cacheKey(symbol)]: {
          symbol: symbol,
          url: location.href,
          cachedAt: Date.now(),
          payload: payload.raw || payload
        }
      });
    } catch (e) {}
  }

  function clearCache(symbol) {
    try {
      chrome.storage.local.remove(cacheKey(symbol));
    } catch (e) {}
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  function footLabel(payload) {
    if (state.fromCache) return "Cached \u00b7 " + timeAgo(state.cachedAt) + " (hard refresh for new)";
    if (payload && payload.source === "demo") return "Demo data";
    const when = payload && payload.generatedAt ? new Date(payload.generatedAt).toLocaleString() : "";
    return "Source: ChatGPT" + (when ? " \u00b7 " + when : "");
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtNum(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return "\u2014";
    const d = digits === undefined ? 2 : digits;
    return Number(n).toLocaleString("en-IN", { maximumFractionDigits: d });
  }

  function clsForDelta(str) {
    if (!str) return "flat";
    if (/^\s*\+/.test(str)) return "up";
    if (/^\s*-/.test(str)) return "down";
    const s = String(str);
    if (/%|up|inc|grow/i.test(s) && !/down|dec|fall|neg/i.test(s)) return "up";
    if (/down|dec|fall|loss|neg/i.test(s)) return "down";
    return "flat";
  }

  function perfClass(p) {
    const v = (p || "").toLowerCase();
    if (v === "excellent") return "up";
    if (v === "bad") return "down";
    return "flat";
  }

  function valClass(status) {
    const v = (status || "").toLowerCase();
    if (v === "undervalued") return "up";
    if (v === "overvalued") return "down";
    return "flat";
  }

  // ---- DOM setup --------------------------------------------------------
  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.id = "ai-stock-research-host";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    const container = document.createElement("div");
    container.className = "host-root";
    root.appendChild(container);
    ui = container;
    (document.documentElement || document.body).appendChild(host);

    ui.innerHTML = `
      <button class="fab" title="AI Stock Research">AI<span class="dot">NEW</span></button>
      <div class="panel hidden"></div>
    `;
    ui.querySelector(".fab").addEventListener("click", () => toggle(true));
    render();
  }

  function panelEl() {
    return ui.querySelector(".panel");
  }

  function toggle(open) {
    state.open = open === undefined ? !state.open : open;
    const p = panelEl();
    if (!p) return;
    p.classList.toggle("hidden", !state.open);
    if (state.open) render();
  }

  // ---- rendering --------------------------------------------------------
  function render() {
    if (!ui) return;
    const p = panelEl();
    if (!p) return;
    if (state.status === "loading") p.innerHTML = viewLoading();
    else if (state.status === "result") p.innerHTML = viewResult(state.payload);
    else if (state.status === "error") p.innerHTML = viewError();
    else p.innerHTML = viewIdle();
    wire(p);
    const fab = ui.querySelector(".fab");
    if (fab) fab.classList.toggle("busy", state.status === "loading");
  }

  function headHtml(sub) {
    return `
      <div class="head">
        <div>
          <div class="sym">${escapeHtml(info.symbol)}</div>
          <div class="company">${escapeHtml(state.payload && state.payload.name ? state.payload.name : (info.site + (info.exchange ? " \u00b7 " + info.exchange : "")))}</div>
        </div>
        <div class="spacer"></div>
        <button class="iconbtn openlink" data-act="open-screener" title="Open on Screener.in">${LINK_SVG}</button>
        <button class="iconbtn" data-act="refresh" title="Hard refresh (clear cache)">&#8635;</button>
        <button class="iconbtn" data-act="close" title="Close">&#10005;</button>
      </div>`;
  }

  function viewIdle() {
    return `
      ${headHtml()}
      <div class="body">
        <div class="muted">Detected on <b style="color:#cfd3df">${escapeHtml(info.site)}</b>${info.exchange ? " \u00b7 " + escapeHtml(info.exchange) : ""}.</div>
        <div style="height:12px"></div>
        <button class="btn" data-act="research">Research on ChatGPT</button>
        <div class="row">
          <button class="btn ghost" data-act="demo">Try demo data</button>
        </div>
        <div style="height:12px"></div>
        <div class="muted">ChatGPT will research <b style="color:#cfd3df">${escapeHtml(info.symbol)}</b> on the web and return metrics as JSON.</div>
      </div>`;
  }

  function viewLoading() {
    const steps = [
      { k: "opening", label: "Open ChatGPT session" },
      { k: "asking", label: "Ask for stock research" },
      { k: "reading", label: "Read & parse JSON" }
    ];
    const order = { opening: 0, starting: 0, asking: 1, reading: 2 };
    const cur = order[state.phase] === undefined ? 0 : order[state.phase];
    const stepsHtml = steps
      .map((s, i) => {
        const done = i < cur;
        const active = i === cur;
        return `<div class="step ${done ? "done" : ""} ${active ? "active" : ""}">
          <span class="tick">${done ? "&#10003;" : ""}</span>${escapeHtml(s.label)}</div>`;
      })
      .join("");
    return `
      ${headHtml()}
      <div class="body center">
        <div class="spinner"></div>
        <div style="font-weight:700;font-size:13px">${escapeHtml(state.message || "Working\u2026")}</div>
        <div class="steps">${stepsHtml}</div>
        <div class="row">
          <button class="btn ghost" data-act="close">Hide</button>
        </div>
      </div>`;
  }

  function viewError() {
    return `
      ${headHtml()}
      <div class="body">
        <div class="err">${escapeHtml(state.error || "Something went wrong.")}</div>
        <div style="height:12px"></div>
        <button class="btn" data-act="research">Try again</button>
        <div class="row">
          <button class="btn ghost" data-act="demo">Use demo data</button>
        </div>
      </div>`;
  }

  function viewResult(payload) {
    const m = payload.metrics || {};
    const val = m.valuation || {};
    const action = (m.action || "").toUpperCase();
    const valPct = val.percent;
    const markPos =
      val.status === "Undervalued" ? 82 : val.status === "Overvalued" ? 18 : 50;
    const markLeft = typeof valPct === "number" ? Math.max(5, Math.min(95, markPos)) : 50;

    const badges = (m.badges || [])
      .map((b) => `<span class="badge">${escapeHtml(b)}</span>`)
      .join("");

    const deltaCard = (label, v) =>
      `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v ${clsForDelta(v)}">${escapeHtml(v || "\u2014")}</div></div>`;

    const srcIcon = (src) =>
      src
        ? `<button class="srcicon" data-url="${escapeHtml(src)}" title="${escapeHtml(src)}">${LINK_SVG}</button>`
        : "";

    const pointItem = (li) =>
      `<div class="newitem"><div class="txt"><div class="t">${escapeHtml(li && li.point ? li.point : "")}</div></div>${srcIcon(li && li.source)}</div>`;
    const orderItem = (li) => {
      const parts = [];
      if (li && li.value) parts.push(String(li.value));
      if (li && li.date) parts.push(String(li.date));
      return `<div class="newitem"><div class="txt"><div class="t">${escapeHtml(li && li.desc ? li.desc : "")}</div>${parts.length ? `<div class="sub">${escapeHtml(parts.join(" \u00b7 "))}</div>` : ""}</div>${srcIcon(li && li.source)}</div>`;
    };
    const compItem = (li) =>
      `<div class="newitem"><div class="txt"><div class="t">${escapeHtml(li && li.name ? li.name : "")}</div><div>${escapeHtml(li && li.relation ? li.relation : "")}</div></div>${srcIcon(li && li.source)}</div>`;

    const sectionList = (title, arr, fn) =>
      arr && arr.length
        ? `<div class="section"><div class="section-title">${escapeHtml(title)}</div><div class="newslist">${arr.map(fn).join("")}</div></div>`
        : "";

    const summary = payload.summary
      ? `<div class="section"><div class="lead">${escapeHtml(payload.summary)}</div></div>`
      : "";
    const sector =
      payload.sector && payload.sector.name
        ? `<div class="section"><div class="section-title">Sector</div><div><div class="sectorrow"><span>${escapeHtml(payload.sector.name)}</span><span class="tailwind ${payload.sector.tailwind ? "yes" : "no"}">${payload.sector.tailwind ? "Tailwind" : "No tailwind"}</span></div>${payload.sector.reason ? `<div class="muted" style="margin-top:6px">${escapeHtml(payload.sector.reason)}</div>` : ""}</div></div>`
        : "";

    return `
      <div class="head">
        <div>
          <div class="sym">${escapeHtml(payload.symbol || info.symbol)}</div>
          <div class="company">${escapeHtml(payload.name || "")}</div>
        </div>
        <div class="spacer"></div>
        <button class="iconbtn openlink" data-act="open-screener" title="Open on Screener.in">${LINK_SVG}</button>
        <button class="iconbtn" data-act="refresh" title="Hard refresh (clear cache)">&#8635;</button>
        <button class="iconbtn" data-act="close" title="Close">&#10005;</button>
      </div>
      <div class="body">
        ${badges ? `<div class="badges">${badges}</div>` : ""}

        <div class="topline">
          <div class="ltp">\u20b9${escapeHtml(fmtNum(m.ltp))}<small>LTP</small></div>
          <div class="pill ${escapeHtml(action || "HOLD")}">${escapeHtml(action || "\u2014")}</div>
        </div>

        <div class="section">
          <div class="section-title">Valuation${val.status ? " \u00b7 " + escapeHtml(val.status) : ""}${typeof val.percent === "number" ? " (" + escapeHtml(fmtNum(val.percent, 1)) + "%)" : ""}</div>
          <div class="valbar"><div class="mark" style="left:${markLeft}%"></div></div>
          <div class="grid2">
            <div class="card"><div class="k">Fair Value</div><div class="v">\u20b9${escapeHtml(fmtNum(val.fairValue))}</div></div>
            <div class="card"><div class="k">LTP</div><div class="v">\u20b9${escapeHtml(fmtNum(val.ltp !== null && val.ltp !== undefined ? val.ltp : m.ltp))}</div></div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Quarter on Quarter (QoQ)</div>
          <div class="grid3">
            ${deltaCard("Net Profit", m.qoq && m.qoq.netProfit)}
            ${deltaCard("Sales", m.qoq && m.qoq.sales)}
            ${deltaCard("Profit", m.qoq && m.qoq.profit)}
          </div>
        </div>

        <div class="section">
          <div class="section-title">Year on Year (YoY)</div>
          <div class="grid3">
            ${deltaCard("Net Profit", m.yoy && m.yoy.netProfit)}
            ${deltaCard("Sales", m.yoy && m.yoy.sales)}
            ${deltaCard("Profit", m.yoy && m.yoy.profit)}
          </div>
        </div>

        <div class="section">
          <div class="section-title">Key Metrics</div>
          <div class="grid3">
            <div class="card"><div class="k">Market Cap</div><div class="v">${escapeHtml(m.mcap || "\u2014")}</div></div>
            <div class="card"><div class="k">Stock P/E</div><div class="v">${escapeHtml(fmtNum(m.pe, 1))}</div></div>
            <div class="card"><div class="k">Div Yield</div><div class="v">${escapeHtml(fmtNum(m.divYield, 2))}%</div></div>
            <div class="card"><div class="k">ROCE</div><div class="v">${escapeHtml(fmtNum(m.roce, 1))}%</div></div>
            <div class="card"><div class="k">ROE</div><div class="v">${escapeHtml(fmtNum(m.roe, 1))}%</div></div>
            <div class="card"><div class="k">CFO / PAT</div><div class="v">${escapeHtml(fmtNum(m.cfoPat, 2))}</div></div>
            <div class="card"><div class="k">Piotroski</div><div class="v">${escapeHtml(m.piotroski === null || m.piotroski === undefined ? "\u2014" : fmtNum(m.piotroski, 0) + "/9")}</div></div>
            <div class="card"><div class="k">Performance</div><div class="v ${perfClass(m.performance)}">${escapeHtml(m.performance || "\u2014")}</div></div>
          </div>
        </div>

        ${summary}
        ${sector}
        ${sectionList("Catalysts", payload.catalysts, pointItem)}
        ${sectionList("Risks", payload.risks, pointItem)}
        ${sectionList("Big Orders", payload.bigOrders, orderItem)}
        ${sectionList("Linked Companies", payload.linkedCompanies, compItem)}
      </div>
      <div class="foot">
        <span class="muted">${footLabel(payload)}</span>
        <button class="smallbtn" data-act="copy">Copy JSON</button>
        <button class="smallbtn" data-act="refresh">Hard refresh</button>
      </div>`;
  }

  function wire(p) {
    p.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener("click", () => {
        const act = el.getAttribute("data-act");
        if (act === "close") toggle(false);
        else if (act === "research") runResearch(false);
        else if (act === "demo") runResearch(true);
        else if (act === "refresh") hardRefresh();
        else if (act === "copy") copyJson();
        else if (act === "open-screener") openScreener();
      });
    });
    p.querySelectorAll("[data-url]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        openUrl(el.getAttribute("data-url"));
      });
    });
  }

  function openUrl(url) {
    if (!url) return;
    window.open(url, "_blank", "noopener,width=900,height=700");
  }

  function openScreener() {
    const sym = (state.payload && state.payload.symbol) || info.symbol;
    openUrl(screenerUrl(sym));
  }

  function copyJson() {
    const data = state.payload ? (state.payload.raw || state.payload) : null;
    if (!data) return;
    const txt = JSON.stringify(data, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(() => {});
    }
  }

  // ---- research flow ----------------------------------------------------
  function runResearch(useDemo) {
    toggle(true);
    state.fromCache = false;
    state.cachedAt = null;
    if (useDemo) {
      state.status = "loading";
      state.phase = "asking";
      state.message = "Generating demo data\u2026";
      state.payload = null;
      state.error = null;
      render();
      setTimeout(() => {
        finishWithPayload(MOCK.getMock(info.symbol, info.exchange));
      }, 650);
      return;
    }

    const requestId = uid();
    state.status = "loading";
    state.requestId = requestId;
    state.phase = "starting";
    state.message = "Starting\u2026";
    state.payload = null;
    state.error = null;
    render();

    const prompt = PROMPT.buildPrompt(info.symbol, info.exchange);
    try {
      const p = chrome.runtime.sendMessage({
        type: "RESEARCH_START",
        requestId: requestId,
        symbol: info.symbol,
        exchange: info.exchange,
        site: info.site,
        pageUrl: location.href,
        prompt: prompt
      });
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      setError("Extension was reloaded. Refresh this page and try again.");
    }
  }

  function finishWithPayload(rawPayload) {
    state.payload = JSONX.normalizePayload(rawPayload, info.symbol);
    state.status = "result";
    state.error = null;
    state.fromCache = false;
    state.cachedAt = null;
    if (state.payload.source !== "demo") {
      writeCache(info.symbol, state.payload);
      state.cachedAt = Date.now();
    }
    render();
  }

  function hardRefresh() {
    clearCache(info.symbol);
    state.fromCache = false;
    state.cachedAt = null;
    runResearch(settings.demo);
  }

  function setError(msg) {
    state.status = "error";
    state.error = msg || "Something went wrong.";
    render();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.requestId !== state.requestId) return;
    if (msg.type === "RESEARCH_STATUS") {
      state.phase = msg.phase || state.phase;
      state.message = msg.message || state.message;
      render();
    } else if (msg.type === "RESEARCH_RESULT") {
      if (msg.payload) finishWithPayload(msg.payload);
      else if (msg.text) setError("ChatGPT replied but no JSON was found. Raw: " + String(msg.text).slice(0, 200));
      else setError(msg.parseError || "ChatGPT did not return valid JSON.");
    } else if (msg.type === "RESEARCH_ERROR") {
      setError(msg.error);
    }
  });

  // ---- settings + SPA navigation ---------------------------------------
  function hydrate() {
    if (state.status !== "idle") return;
    readCache(info.symbol, (entry) => {
      if (state.status !== "idle") return;
      if (entry && entry.payload) {
        state.payload = JSONX.normalizePayload(entry.payload, info.symbol);
        state.fromCache = true;
        state.cachedAt = entry.cachedAt;
        state.status = "result";
        toggle(true);
      } else if (settings.autoResearch) {
        runResearch(settings.demo);
      } else if (settings.autoOpen) {
        toggle(true);
      }
    });
  }

  function loadSettings() {
    try {
      chrome.storage.local.get({ demo: false, autoResearch: true, autoOpen: true }, (s) => {
        settings = Object.assign(settings, s);
        hydrate();
      });
    } catch (e) {}
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.demo) settings.demo = changes.demo.newValue;
      if (changes.autoResearch) settings.autoResearch = changes.autoResearch.newValue;
      if (changes.autoOpen) settings.autoOpen = changes.autoOpen.newValue;
    });
  } catch (e) {}

  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const next = EXTRACT.parseUrl(location.href);
    if (!next) {
      if (host) host.style.display = "none";
      return;
    }
    if (host) host.style.display = "";
    if (next.symbol !== (info && info.symbol)) {
      info = next;
      state.status = "idle";
      state.payload = null;
      state.error = null;
      state.fromCache = false;
      state.cachedAt = null;
      render();
      hydrate();
    }
  }, 1500);

  // ---- boot -------------------------------------------------------------
  if (info) {
    ensureHost();
    loadSettings();
  }
})();
