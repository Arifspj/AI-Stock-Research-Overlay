/*
 * Service worker: brokers research requests between the on-page overlay
 * content script and the automated chatgpt.com content script.
 *
 * Pending requests live in chrome.storage.session so routing survives a
 * service-worker restart. chatgpt.js pings CHATGPT_STATUS periodically,
 * which also keeps this worker alive during long generations.
 */
"use strict";

importScripts("lib/screener.js", "lib/prompt.js");

const SCREENER = (self.StockResearch && self.StockResearch.screener) || null;
const PROMPT = (self.StockResearch && self.StockResearch.prompt) || null;
const CHATGPT_URLS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
const PENDING_PREFIX = "pending:";
const CHATGPT_TAB_KEY = "chatgptTabId";

// Short-lived in-worker stores so repeated research runs for the same stock
// reuse scraped data instead of opening fresh screener tabs each time.
const QUARTERLY_TTL = 15 * 60 * 1000; // 15 min
const quarterlyCache = new Map(); // SLUG -> { ts, quarterly }
const researchActive = new Map(); // tabId -> requestId (dedupe)

function uid() {
  if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
  return "req-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function setPending(id, value) {
  await chrome.storage.session.set({ [PENDING_PREFIX + id]: value });
}

async function getPending(id) {
  const key = PENDING_PREFIX + id;
  const obj = await chrome.storage.session.get(key);
  return obj[key] || null;
}

async function delPending(id) {
  await chrome.storage.session.remove(PENDING_PREFIX + id);
}

async function toOverlay(tabId, message) {
  if (tabId === undefined || tabId === null) return;
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    /* overlay/tab likely closed; drop silently */
  }
}

async function waitForComplete(tabId) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    chrome.tabs.get(tabId)
      .then((t) => {
        if (t && t.status === "complete") done();
      })
      .catch(done);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        done();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      done();
    }, 30000);
  });
}

async function getOrCreateChatGptTab() {
  const tabs = await chrome.tabs.query({ url: CHATGPT_URLS });
  if (tabs && tabs.length) {
    // Prefer the root/new-chat tab so old conversations are not reused.
    const root = tabs.find((t) => /chatgpt\.com\/?$/.test(t.url || ""));
    const chosen = root || tabs[0];
    if (chosen.discarded) {
      await chrome.tabs.reload(chosen.id);
      await waitForComplete(chosen.id);
      await sleep(1500);
    }
    return chosen.id;
  }
  const tab = await chrome.tabs.create({ url: "https://chatgpt.com/", active: false });
  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
  } catch (e) {}
  await waitForComplete(tab.id);
  await sleep(1500); // let the SPA mount the composer
  return tab.id;
}

async function sendToChatGpt(tabId, message) {
  let lastErr = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return;
    } catch (e) {
      lastErr = e;
      // The tab may predate this extension (or the extension was reloaded),
      // so its content script can be missing. Inject it and retry.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["lib/json.js", "content/chatgpt.js"]
        });
      } catch (ie) {
        /* tab still loading or restricted; retry */
      }
      await sleep(1000);
    }
  }
  throw lastErr || new Error("Could not reach the ChatGPT tab.");
}

function friendlyError(e) {
  const msg = (e && e.message) || String(e);
  if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
    return "Couldn't reach the ChatGPT tab. Reload your chatgpt.com tab (or just open chatgpt.com), make sure you're logged in, then retry.";
  }
  return msg;
}

async function fetchHtml(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(url, { credentials: "include", signal: controller.signal });
    clearTimeout(timer);
    if (!res || !res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

async function parseScreenerUrl(slug) {
  const enc = encodeURIComponent(slug || "");
  // Standalone page is screener's canonical view (its top-ratios use the
  // standalone financials, e.g. sane P/E). Consolidated first would expose
  // screener's consolidated-derived ratios (see Stellant 526071: P/E 5518).
  const urls = [
    "https://www.screener.in/company/" + enc + "/",
    "https://www.screener.in/company/" + enc + "/consolidated/"
  ];
  for (const url of urls) {
    const html = await fetchHtml(url);
    if (!html) continue;
    const parsed = SCREENER.parseScreener(html);
    if (parsed && (parsed.quarterly || (parsed.ratios && parsed.ratios.ltp !== null))) {
      return parsed;
    }
  }
  return null;
}

// Resolve the canonical screener.in company slug (from a site symbol like an
// ISIN/script-code or short name) using screener's lightweight search API.
async function resolveScreenerSlug(symbol) {
  if (!symbol) return null;
  const html = await fetchHtml(
    "https://www.screener.in/api/company/search/?q=" + encodeURIComponent(String(symbol))
  );
  if (!html) return null;
  try {
    const list = JSON.parse(html);
    if (Array.isArray(list) && list.length) {
      const first = list[0] && list[0].url ? String(list[0].url) : "";
      const m = first.match(/\/company\/([^/]+)\/?$/);
      if (m) return decodeURIComponent(m[1]);
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

async function fetchScreener(symbol) {
  if (!SCREENER || !symbol) return null;
  // Screener occasionally throttles the first request; retry once.
  let parsed = await parseScreenerUrl(symbol);
  if (!parsed) {
    await sleep(700);
    parsed = await parseScreenerUrl(symbol);
  }
  return parsed;
}

function buildVerified(parsed, quarterly) {
  const r = parsed ? parsed.ratios || {} : {};
  const q = quarterly || {};
  const series = q.series || {};
  const changes = q.changes || {};
  return {
    source: "screener.in",
    ltp: r.ltp !== undefined ? r.ltp : null,
    marketCap: r.mcap || null,
    pe: r.pe !== undefined ? r.pe : null,
    divYield: r.divYield !== undefined ? r.divYield : null,
    roce: r.roce !== undefined ? r.roce : null,
    roe: r.roe !== undefined ? r.roe : null,
    qoq: changes.qoq || null,
    yoy: changes.yoy || null,
    workingCapital: parsed.workingCapital || null,
    quarters: q.columns || [],
    sales: series.sales || null,
    netProfit: series.netProfit || null,
    operatingProfit: series.operatingProfit || null
  };
}

// Self-contained; injected via chrome.scripting into a screener tab. Waits for
// the lazily-loaded quarterly table to hydrate, then reads its rows.
function pollScreenerQuarterly() {
  return new Promise(function (resolve) {
    function grab() {
      var sec = document.getElementById("quarters");
      if (!sec) return null;
      var header = Array.prototype.map.call(sec.querySelectorAll("thead th:not(.text)"), function (th) {
        return (th.textContent || "").replace(/\s+/g, " ").trim();
      });
      var rows = [];
      var trs = sec.querySelectorAll("tbody tr");
      for (var i = 0; i < trs.length; i++) {
        var cells = Array.prototype.map.call(trs[i].querySelectorAll("td,th"), function (td) {
          return (td.textContent || "").replace(/\s+/g, " ").trim();
        });
        if (cells.length > 1) rows.push(cells);
      }
      return { header: header, rows: rows };
    }
    function isReady(g) {
      return (
        g &&
        g.header &&
        g.header.length >= 2 &&
        g.rows.some(function (r) {
          return /sales/i.test(r[0] || "") && r.length >= 3 &&
            r.slice(1).some(function (v) { return v !== "" && v !== "\u2014"; });
        })
      );
    }
    var start = Date.now();
    function loop() {
      var g = grab();
      if (isReady(g) || Date.now() - start > 14000) {
        resolve(g);
      } else {
        setTimeout(loop, 400);
      }
    }
    loop();
  });
}

async function scrapeQuarterlyFromTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: pollScreenerQuarterly
    });
    const out = results && results[0] && results[0].result;
    if (out && out.rows && out.rows.length) {
      return SCREENER.parseQuarterlyRows(out.rows, out.header);
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

async function waitForTabComplete(tabId) {
  const start = Date.now();
  while (Date.now() - start < 12000) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && t.status === "complete") return true;
    } catch (e) {
      return false;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Some companies (e.g. BSE SME / half-yearly reporters) expose their
// "Quarterly Results" (half-yearly) only on the standalone page, while the
// consolidated page renders an empty table. Drag both pages through the
// static parser so we always pick up whichever one actually has columns.
async function staticQuarterly(slug) {
  const enc = encodeURIComponent(slug || "");
  const urls = [
    "https://www.screener.in/company/" + enc + "/",
    "https://www.screener.in/company/" + enc + "/consolidated/"
  ];
  for (const url of urls) {
    const html = await fetchHtml(url);
    if (!html) continue;
    const parsed = SCREENER.parseScreener(html);
    if (parsed && parsed.quarterly && parsed.quarterly.columns && parsed.quarterly.columns.length) {
      return parsed.quarterly;
    }
  }
  return null;
}

async function acquireQuarterly(slug, sender) {
  // We deliberately avoid opening dedicated screener tabs here: an injected
  // overlay on such a tab auto-researches the stock and keeps opening more
  // tabs (a loop that also trips screener's rate limits). Only two sources:
  //  - the live DOM of the page the user is already on (if it's screener)
  //  - static fetches of the consolidated + standalone pages (half-yearly
  //    reporters like FONEBOX only publish their table on standalone).
  let host = "";
  try {
    if (sender.tab && sender.tab.url) host = new URL(sender.tab.url).hostname;
  } catch (e) {}
  if (host === "www.screener.in" || host === "screener.in") {
    const live = await scrapeQuarterlyFromTab(sender.tab.id);
    if (live && live.columns && live.columns.length) return live;
  }
  return staticQuarterly(slug);
}

async function getQuarterly(slug, sender) {
  const key = String(slug || "").toUpperCase();
  const hit = quarterlyCache.get(key);
  if (hit && Date.now() - hit.ts < QUARTERLY_TTL) return hit.quarterly;
  const q = await acquireQuarterly(slug, sender);
  if (q && q.columns && q.columns.length) {
    quarterlyCache.set(key, { ts: Date.now(), quarterly: q });
  }
  return q;
}

// Force the scraped ground-truth numbers onto the model's payload.
function applyVerified(payload, v) {
  if (!payload || !v) return payload;
  const m = payload.metrics || (payload.metrics = {});
  if (v.ltp !== null && v.ltp !== undefined) m.ltp = v.ltp;
  if (v.marketCap) m.mcap = v.marketCap;
  if (v.pe !== null && v.pe !== undefined) m.pe = v.pe;
  if (v.divYield !== null && v.divYield !== undefined) m.divYield = v.divYield;
  if (v.roce !== null && v.roce !== undefined) m.roce = v.roce;
  if (v.roe !== null && v.roe !== undefined) m.roe = v.roe;
  if (v.workingCapital && v.workingCapital.status) m.workingCapital = v.workingCapital;

  const merge = (dest, src) => {
    if (!src) return;
    const d = dest || {};
    if (src.sales) d.sales = src.sales;
    if (src.netProfit) d.netProfit = src.netProfit;
    if (src.profit) d.profit = src.profit;
    return d;
  };
  if (v.qoq) m.qoq = merge(m.qoq, v.qoq);
  if (v.yoy) m.yoy = merge(m.yoy, v.yoy);

  if (m.valuation && typeof m.valuation === "object" && v.ltp !== null && v.ltp !== undefined) {
    m.valuation.ltp = v.ltp;
  }
  return payload;
}

async function onResearchStart(msg, sender) {
  const requestId = msg.requestId || uid();
  const tabId = sender.tab && sender.tab.id;
  if (tabId === undefined) return;

  // Dedupe: if this tab already has an active research, ignore the duplicate
  // so we never spawn a second wave of screener tabs.
  if (researchActive.has(tabId)) {
    return;
  }
  researchActive.set(tabId, requestId);

  await setPending(requestId, {
    tabId: tabId,
    symbol: msg.symbol || null,
    exchange: msg.exchange || null,
    site: msg.site || null,
    createdAt: Date.now()
  });

  try {
    await toOverlay(tabId, {
      type: "RESEARCH_STATUS",
      requestId: requestId,
      phase: "screener",
      message: "Fetching data from screener.in\u2026"
    });

    // Resolve the canonical screener slug so both the ratio scrape and the
    // quarterly tab use a URL that actually exists on screener.in.
    let scrSlug = msg.symbol || null;
    try {
      const resolved = await resolveScreenerSlug(msg.symbol);
      if (resolved) scrSlug = resolved;
    } catch (e) {
      /* fall back to the raw symbol */
    }

    let parsed = null;
    try {
      parsed = await fetchScreener(scrSlug);
    } catch (e) {
      parsed = null;
    }

    let quarterly = null;
    try {
      quarterly = await getQuarterly(scrSlug, sender);
    } catch (e) {
      quarterly = null;
    }
    const verified = buildVerified(parsed, quarterly);

    // persist verified data so the result can be reconciled after a SW restart
    const pending = await getPending(requestId);
    if (pending) {
      pending.verified = verified;
      pending.slug = scrSlug;
      await setPending(requestId, pending);
    }

    await toOverlay(tabId, {
      type: "RESEARCH_STATUS",
      requestId: requestId,
      phase: "opening",
      message: "Opening ChatGPT session\u2026"
    });

    const cgTabId = await getOrCreateChatGptTab();
    await chrome.storage.session.set({ [CHATGPT_TAB_KEY]: cgTabId });
    await toOverlay(tabId, {
      type: "RESEARCH_STATUS",
      requestId: requestId,
      phase: "asking",
      message:
        (verified ? "Got screener data (ratios" + (verified.qoq && verified.qoq.sales ? " + QoQ/YoY" : "") + "). " : "") +
        "Researching " + (msg.symbol || "stock") + " on ChatGPT\u2026"
    });

    const prompt =
      PROMPT && PROMPT.buildPrompt
        ? PROMPT.buildPrompt(msg.symbol, msg.exchange, verified)
        : msg.prompt;

    await sendToChatGpt(cgTabId, {
      type: "ASK_CHATGPT",
      requestId: requestId,
      prompt: prompt,
      symbol: msg.symbol
    });
  } catch (e) {
    await delPending(requestId);
    await toOverlay(tabId, {
      type: "RESEARCH_ERROR",
      requestId: requestId,
      error: friendlyError(e)
    });
  } finally {
    researchActive.delete(tabId);
  }
}

async function onChatGptStatus(msg) {
  const pending = await getPending(msg.requestId);
  if (!pending) return;
  await toOverlay(pending.tabId, {
    type: "RESEARCH_STATUS",
    requestId: msg.requestId,
    phase: msg.phase || "working",
    message: msg.message || null
  });
}

async function onChatGptResult(msg) {
  const pending = await getPending(msg.requestId);
  if (!pending) return;
  if (msg.error) {
    await toOverlay(pending.tabId, {
      type: "RESEARCH_ERROR",
      requestId: msg.requestId,
      error: msg.error
    });
  } else {
    if (msg.payload && pending.verified) {
      applyVerified(msg.payload, pending.verified);
    }
    if (msg.payload && pending.slug) {
      // Remember the canonical screener slug so the overlay's link button
      // opens the right page even when the site symbol is an ISIN/script code.
      msg.payload._scrSlug = pending.slug;
    }
    await toOverlay(pending.tabId, {
      type: "RESEARCH_RESULT",
      requestId: msg.requestId,
      payload: msg.payload || null,
      text: msg.text || null,
      parseError: msg.parseError || null
    });
  }
  await delPending(msg.requestId);
}

async function onResearchCancel(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  const id = msg.requestId || null;
  if (id) {
    try {
      await delPending(id);
    } catch (e) {}
  }
  if (tabId !== undefined) researchActive.delete(tabId);
  try {
    const obj = await chrome.storage.session.get(CHATGPT_TAB_KEY);
    const cgTabId = obj[CHATGPT_TAB_KEY];
    if (cgTabId) {
      await chrome.tabs.sendMessage(cgTabId, { type: "CHATGPT_CANCEL", requestId: id }).catch(() => {});
    }
  } catch (e) {}
  await toOverlay(tabId, { type: "RESEARCH_CANCELED", requestId: id || undefined });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case "RESEARCH_START":
      onResearchStart(msg, sender);
      break;
    case "RESEARCH_CANCEL":
      onResearchCancel(msg, sender);
      break;
    case "CHATGPT_STATUS":
      onChatGptStatus(msg);
      break;
    case "CHATGPT_RESULT":
      onChatGptResult(msg);
      break;
    case "OPEN_CHATGPT":
      getOrCreateChatGptTab()
        .then((id) => chrome.tabs.update(id, { active: true }))
        .catch(() => {});
      break;
    default:
      break;
  }
  // We do not need to respond to any of these messages.
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
});
