import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const extract = require("../lib/extract.js");

test("Zerodha chart URL -> symbol + exchange", () => {
  const r = extract.parseUrl(
    "https://kite.zerodha.com/markets/chart/web/ciq/NSE/VIDYAWIRES/194617345"
  );
  assert.ok(r);
  assert.equal(r.symbol, "VIDYAWIRES");
  assert.equal(r.exchange, "NSE");
  assert.equal(r.site, "Zerodha");
});

test("Zerodha orders URL", () => {
  const r = extract.parseUrl("https://kite.zerodha.com/orders/NSE/INFY");
  assert.ok(r);
  assert.equal(r.symbol, "INFY");
  assert.equal(r.exchange, "NSE");
});

test("Screener URL -> symbol", () => {
  const r = extract.parseUrl("https://www.screener.in/company/GATECH/");
  assert.ok(r);
  assert.equal(r.symbol, "GATECH");
  assert.equal(r.site, "Screener");
});

test("Chartink URL -> symbol from query", () => {
  const url =
    "https://chartink.com/stocks-new?from_scan=1&scan_link=scanlink%3Adc5816d352d457253c2d4179570ed613&scan_source=%7B%22sourceScanId%22%3A27287105%2C%22name%22%3A%22IPO+Breakout%22%2C%22slug%22%3A%22ipo-breakout-2135%22%7D&symbol=ABBOTINDIA&timeframe=Monthly";
  const r = extract.parseUrl(url);
  assert.ok(r);
  assert.equal(r.symbol, "ABBOTINDIA");
  assert.equal(r.site, "Chartink");
});

test("TradingView URL -> symbol after NSE:", () => {
  const r = extract.parseUrl(
    "https://www.tradingview.com/chart/JC1oNpA0/?symbol=NSE%3AMAZDOCK"
  );
  assert.ok(r);
  assert.equal(r.symbol, "MAZDOCK");
  assert.equal(r.exchange, "NSE");
  assert.equal(r.site, "TradingView");
});

test("unsupported site -> null", () => {
  assert.equal(extract.parseUrl("https://www.google.com/search?q=x"), null);
  assert.equal(extract.parseUrl("not a url"), null);
});

test("normalizeSymbol strips exchange prefix", () => {
  assert.equal(extract.normalizeSymbol("NSE:RELIANCE"), "RELIANCE");
  assert.equal(extract.normalizeSymbol(" bse:tcs "), "TCS");
});

test("Zerodha -ST series suffix is trimmed", () => {
  const r = extract.parseUrl(
    "https://kite.zerodha.com/markets/chart/web/ciq/NSE/FONEBOX-ST/5765121"
  );
  assert.ok(r);
  assert.equal(r.symbol, "FONEBOX");
  assert.equal(r.exchange, "NSE");
});

test("known series suffixes trimmed, real hyphens preserved", () => {
  assert.equal(extract.normalizeSymbol("FONEBOX-ST"), "FONEBOX");
  assert.equal(extract.normalizeSymbol("SOMESTOCK-BE"), "SOMESTOCK");
  assert.equal(extract.normalizeSymbol("BAJAJ-AUTO"), "BAJAJ-AUTO");
  assert.equal(extract.normalizeSymbol("M&M"), "M&M");
});
