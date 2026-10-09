/*
 * Stock symbol extraction from supported sites.
 * Works both as a content-script global (window.StockResearch) and as a
 * CommonJS module for Node-based unit tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.StockResearch = root.StockResearch || {};
  root.StockResearch.extract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Exchange segment codes that can appear in a path just before the symbol.
  const EXCHANGES = ["NSE", "BSE", "NFO", "BFO", "MCX", "CDS", "BCD", "NCO", "NSI", "BSEFO"];

  // Trading-series suffixes that brokers (e.g. Zerodha) append to a ticker.
  // Only stripped when they are a known series code, so real hyphenated
  // symbols like BAJAJ-AUTO are preserved.
  const SERIES_SUFFIXES = [
    "ST", "BE", "BZ", "EQ", "SM", "IL", "IQ", "IV", "NA", "NB", "NC", "ND",
    "NE", "NF", "BL", "BT", "PP", "P1", "P2", "N1", "N2", "N3", "N4"
  ];

  function stripSeries(symbol) {
    const s = String(symbol || "");
    const m = s.match(/^(.*)-([A-Z0-9]{1,2})$/);
    if (m && SERIES_SUFFIXES.indexOf(m[2]) !== -1) return m[1];
    return s;
  }

  const SUPPORTED = {
    "kite.zerodha.com": "Zerodha",
    "screener.in": "Screener",
    "www.screener.in": "Screener",
    "chartink.com": "Chartink",
    "www.chartink.com": "Chartink",
    "tradingview.com": "TradingView",
    "www.tradingview.com": "TradingView"
  };

  function normalizeSymbol(raw) {
    if (!raw) return null;
    let s = String(raw).trim();
    // TradingView uses "NSE:MAZDOCK"; keep only the ticker part.
    if (s.indexOf(":") !== -1) s = s.split(":").pop();
    s = s.split("?")[0].split("#")[0];
    s = decodeURIComponent(s);
    s = s.replace(/[^A-Za-z0-9&._-]/g, "").toUpperCase();
    s = stripSeries(s);
    return s || null;
  }

  function stripHost(host) {
    return String(host || "").toLowerCase().replace(/^m\./, "");
  }

  function getExchangeFromQuery(u) {
    const ex = (u.searchParams.get("exchange") || u.searchParams.get("ex") || "").toUpperCase();
    return EXCHANGES.indexOf(ex) !== -1 ? ex : null;
  }

  /**
   * @param {string} urlString
   * @returns {{symbol:string, exchange:string|null, site:string, name:string, host:string}|null}
   */
  function parseUrl(urlString) {
    if (!urlString) return null;
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      return null;
    }

    const host = stripHost(u.hostname);
    const site = SUPPORTED[host];
    if (!site) return null;

    const segments = u.pathname.split("/").filter(Boolean);
    let symbol = null;
    let exchange = null;

    if (host === "kite.zerodha.com") {
      // e.g. /markets/chart/web/ciq/NSE/VIDYAWIRES/194617345 or /orders/NSE/INFY
      for (let i = 0; i < segments.length; i++) {
        if (EXCHANGES.indexOf(segments[i].toUpperCase()) !== -1 && segments[i + 1]) {
          exchange = segments[i].toUpperCase();
          symbol = segments[i + 1];
          break;
        }
      }
    } else if (host === "screener.in" || host === "www.screener.in") {
      // e.g. /company/GATECH/  or /company/GATECH/consolidated/
      const idx = segments.indexOf("company");
      if (idx !== -1 && segments[idx + 1]) {
        symbol = segments[idx + 1];
        exchange = (u.searchParams.get("exchange") || "NSE").toUpperCase();
      }
    } else if (host === "chartink.com" || host === "www.chartink.com") {
      symbol = u.searchParams.get("symbol");
      exchange = getExchangeFromQuery(u);
    } else if (host === "tradingview.com" || host === "www.tradingview.com") {
      const raw = u.searchParams.get("symbol");
      if (raw) {
        const parts = raw.split(":");
        if (parts.length > 1) exchange = parts[0].toUpperCase();
        symbol = parts[parts.length - 1];
      }
    }

    if (!symbol) return null;
    const clean = normalizeSymbol(symbol);
    if (!clean) return null;

    return {
      symbol: clean,
      exchange: exchange || null,
      site: site,
      name: clean,
      host: host
    };
  }

  function isSupported(urlString) {
    try {
      const u = new URL(urlString);
      return !!SUPPORTED[stripHost(u.hostname)];
    } catch (e) {
      return false;
    }
  }

  return {
    parseUrl: parseUrl,
    normalizeSymbol: normalizeSymbol,
    stripSeries: stripSeries,
    isSupported: isSupported,
    SUPPORTED: SUPPORTED,
    EXCHANGES: EXCHANGES,
    SERIES_SUFFIXES: SERIES_SUFFIXES
  };
});
