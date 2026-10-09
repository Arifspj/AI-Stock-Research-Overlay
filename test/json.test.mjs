import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSONX = require("../lib/json.js");

const SAMPLE = {
  symbol: "GATECH",
  name: "GATECH Ltd",
  metrics: {
    badges: ["DEBT FREE", "QUALITY BUSINESS"],
    ltp: 123.45,
    action: "BUY",
    qoq: { netProfit: "+12%", sales: "+8%", profit: "+9%" },
    yoy: { netProfit: "+30%", sales: "+22%", profit: "+28%" },
    valuation: { status: "Undervalued", percent: 15, fairValue: 142, ltp: 123.45 },
    mcap: "1,234 Cr",
    pe: 24.5,
    divYield: 0.5,
    roce: 18.2,
    roe: 15.1,
    cfoPat: 1.1,
    piotroski: 7,
    performance: "Excellent"
  }
};

test("parses a ```json fenced block", () => {
  const text = "Here you go:\n```json\n" + JSON.stringify(SAMPLE) + "\n```\n";
  const out = JSONX.extractJson(text);
  assert.equal(out.symbol, "GATECH");
  assert.equal(out.metrics.ltp, 123.45);
});

test("parses a bare JSON object", () => {
  const out = JSONX.extractJson(JSON.stringify(SAMPLE));
  assert.equal(out.metrics.pe, 24.5);
});

test("parses JSON buried in prose with nested braces and braces in strings", () => {
  const tricky = { symbol: "X", metrics: { note: "braces {like} this", n: 1 } };
  const text = "Sure! Here is the data: " + JSON.stringify(tricky) + " hope it helps.";
  const out = JSONX.extractJson(text);
  assert.equal(out.symbol, "X");
  assert.equal(out.metrics.note, "braces {like} this");
});

test("returns null for non-JSON", () => {
  assert.equal(JSONX.extractJson("no json here"), null);
  assert.equal(JSONX.extractJson(""), null);
});

test("normalizePayload fills defaults and coerces numbers", () => {
  const raw = { symbol: "ABC", metrics: { ltp: "1,234.50", pe: "N/A", badges: "oops" } };
  const out = JSONX.normalizePayload(raw, "ABC");
  assert.equal(out.symbol, "ABC");
  assert.equal(out.metrics.ltp, 1234.5);
  assert.equal(out.metrics.pe, null);
  assert.deepEqual(out.metrics.badges, []);
  assert.equal(out.metrics.qoq.netProfit, null);
  assert.equal(out.metrics.valuation.ltp, 1234.5);
});

test("normalizePayload preserves qualitative fields", () => {
  const raw = {
    symbol: "FONEBOX",
    metrics: { ltp: 148 },
    summary: "Fonebox sells phones.",
    sector: { name: "Retail", tailwind: false, reason: "competitive" },
    linkedCompanies: [{ name: "Apple", relation: "stocked brand", source: "https://screener.in/x/" }],
    bigOrders: [{ desc: "Allotment", value: "25.74 Cr", date: "Sep 2026", source: "https://nse/1" }],
    catalysts: [{ point: "NWOM win", source: "https://nse/2" }],
    risks: [{ point: "dilution", source: "https://nse/3" }, "junk"]
  };
  const out = JSONX.normalizePayload(raw, "FONEBOX");
  assert.equal(out.summary, "Fonebox sells phones.");
  assert.equal(out.sector.name, "Retail");
  assert.equal(out.sector.tailwind, false);
  assert.equal(out.linkedCompanies[0].relation, "stocked brand");
  assert.equal(out.bigOrders[0].value, "25.74 Cr");
  assert.equal(out.catalysts[0].point, "NWOM win");
  assert.equal(out.risks.length, 1);
  assert.equal(out.risks[0].point, "dilution");
});

test("normalizePayload handles empty input", () => {
  const out = JSONX.normalizePayload(null, "ZZZ");
  assert.equal(out.symbol, "ZZZ");
  assert.equal(out.metrics.ltp, null);
});

// Mirrors chatgpt.js scanning: the prompt schema is valid JSON (its "comments"
// live inside strings) and has symbol "string", so the answer must be selected
// by matching the requested symbol.
function scanBlocks(pageText, symbol) {
  const norm = (s) =>
    String(s || "").toUpperCase().split(":").pop().replace(/[^A-Z0-9]/g, "");
  const want = symbol ? norm(symbol) : null;
  const out = [];
  let from = 0;
  while (from < pageText.length) {
    const block = JSONX.findBalancedObject(pageText, from);
    if (!block) break;
    let parsed = null;
    try {
      parsed = JSON.parse(block);
    } catch (e) {
      parsed = null;
    }
    if (parsed && parsed.metrics) {
      const sym = parsed.symbol ? norm(parsed.symbol) : null;
      if (!want || !sym || sym === want) out.push(parsed);
    }
    from = pageText.indexOf(block, from) + block.length;
  }
  return out;
}

test("page scan ignores the prompt schema and finds the real answer", () => {
  const promptSchema =
    '{ "symbol": "string", "metrics": { "badges": ["string // tags"], "ltp": "number // price" } }';
  const page =
    promptSchema +
    "\nWorked for 9s\n" +
    '{"symbol":"FONEBOX","name":"Fonebox Retail Ltd","metrics":{"badges":["HIGH GROWTH"],"ltp":147.5,"action":"HOLD","qoq":{},"yoy":{},"valuation":{"status":"Overvalued","percent":22,"fairValue":121,"ltp":147.5},"mcap":"152 Cr","pe":24.3,"divYield":0,"roce":44.4,"roe":17.9,"cfoPat":1.65,"piotroski":4,"performance":"Good"}}';
  const found = scanBlocks(page, "FONEBOX");
  assert.equal(found.length, 1);
  assert.equal(found[0].symbol, "FONEBOX");
  assert.equal(found[0].metrics.ltp, 147.5);
});
