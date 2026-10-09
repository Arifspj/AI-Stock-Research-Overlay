import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildPrompt, SCHEMA } = require("../lib/prompt.js");
const mock = require("../lib/mock.js");

test("buildPrompt embeds symbol and exchange", () => {
  const p = buildPrompt("VIDYAWIRES", "NSE");
  assert.ok(p.includes("VIDYAWIRES"));
  assert.ok(p.includes("NSE"));
  assert.ok(/JSON/.test(p));
});

test("buildPrompt defaults exchange to NSE", () => {
  const p = buildPrompt("INFY");
  assert.ok(p.includes("INFY"));
  assert.ok(p.includes("NSE"));
});

test("buildPrompt forces real QoQ and YoY (no N/A)", () => {
  const p = buildPrompt("FONEBOX", "NSE");
  assert.ok(p.includes("QoQ"));
  assert.ok(p.includes("YoY"));
  assert.ok(/DO NOT output "N\/A"/.test(p));
  assert.ok(p.includes("screener.in/company/FONEBOX"));
});

test("buildPrompt forces web browsing and a Piotroski score", () => {
  const p = buildPrompt("FONEBOX", "NSE");
  assert.ok(/WEB SEARCH|BROWSE/i.test(p));
  assert.ok(/Do NOT answer from memory/i.test(p));
  assert.ok(/PIOTROSKI/i.test(p));
  assert.ok(/0-9/.test(p));
  assert.ok(p.includes("/consolidated/"));
});

test("buildPrompt sends scraped screener data as ground truth", () => {
  const verified = {
    source: "screener.in",
    ltp: 148,
    marketCap: "151 Cr.",
    pe: 94.6,
    divYield: 0,
    roce: 56.8,
    roe: 114,
    qoq: { sales: "-49.4%", netProfit: "-41.5%", profit: "-47.2%" },
    yoy: { sales: "+51.2%", netProfit: "+12.7%", profit: "+7.5%" }
  };
  const p = buildPrompt("FONEBOX", "NSE", verified);
  assert.ok(/GROUND TRUTH/i.test(p));
  assert.ok(p.includes("148"));
  assert.ok(p.includes("151 Cr."));
  assert.ok(p.includes("-49.4%"));
  assert.ok(p.includes("+12.7%"));
  assert.ok(/Copy them EXACTLY|do NOT change/i.test(p));
  assert.ok(/valuation.ltp must equal ltp/.test(p));
  assert.ok(/JSON/.test(p));
});

test("schema has all expected top-level keys", () => {
  const top = Object.keys(SCHEMA);
  for (const k of ["symbol", "name", "summary", "sector", "linkedCompanies", "bigOrders", "catalysts", "risks", "metrics"]) {
    assert.ok(top.includes(k), "schema missing " + k);
  }
  assert.ok(Array.isArray(SCHEMA.catalysts));
  assert.equal(typeof SCHEMA.risks, "object");
  assert.equal(SCHEMA.sector.tailwind, "boolean  // is this sector a structural tailwind?");
});

test("schema has the four modules", () => {
  for (const k of ["hiddenTrigger", "newOrders", "valuation", "multibaggerCheck"]) {
    assert.ok(Object.keys(SCHEMA).includes(k), "schema missing module " + k);
  }
  const noVersion = ["triggerFound", "verdict", "hiddenLinkage", "probability", "confirmedStatus"];
  for (const k of noVersion) {
    assert.ok(k in SCHEMA.hiddenTrigger, "hiddenTrigger missing " + k);
  }
  assert.ok(Array.isArray(SCHEMA.newOrders.orders));
  assert.equal(
    SCHEMA.newOrders.orders[0].status,
    "\"Confirmed\" | \"LOA\" | \"Work Order\" | \"Tender Win\" | \"MoU\" | \"Bid\""
  );
  for (const k of ["bearValue", "baseFairValue", "bullValue", "valuationMethod", "verdict"]) {
    assert.ok(k in SCHEMA.valuation, "valuation missing " + k);
  }
  for (const k of ["overallScore", "potential3x", "potential5x", "bearCase", "verdict"]) {
    assert.ok(k in SCHEMA.multibaggerCheck, "multibaggerCheck missing " + k);
  }
});

test("buildPrompt instructs the four modules", () => {
  const p = buildPrompt("FONEBOX", "NSE");
  assert.ok(/MODULES/.test(p));
  assert.ok(/hiddenTrigger/.test(p));
  assert.ok(/newOrders/.test(p));
  assert.ok(/multibaggerCheck/.test(p));
  assert.ok(/NO_CONFIRMED_TRIGGER/.test(p));
  assert.ok(/NO VERIFIED ORDER/.test(p));
  assert.ok(/never invent/.test(p));
});

test("schema has all expected metric keys", () => {
  const keys = Object.keys(SCHEMA.metrics);
  for (const k of [
    "badges",
    "ltp",
    "action",
    "qoq",
    "yoy",
    "valuation",
    "mcap",
    "pe",
    "divYield",
    "roce",
    "roe",
    "cfoPat",
    "piotroski",
    "performance"
  ]) {
    assert.ok(keys.includes(k), "schema missing " + k);
  }
});

test("mock payload is well shaped", () => {
  const m = mock.getMock("GATECH", "NSE");
  assert.equal(m.symbol, "GATECH");
  assert.ok(Array.isArray(m.metrics.badges));
  assert.ok(m.metrics.ltp > 0);
  assert.ok(["BUY", "SELL", "HOLD", "EXIT"].includes(m.metrics.action));
  assert.ok(["Undervalued", "Overvalued", "Fair"].includes(m.metrics.valuation.status));
  assert.ok(typeof m.summary === "string" && m.summary.length > 0);
  assert.ok(m.sector && m.sector.name);
  assert.ok(Array.isArray(m.risks) && m.risks.length >= 1);
  assert.ok(Array.isArray(m.catalysts) && m.catalysts.length >= 1);
  assert.ok(Array.isArray(m.linkedCompanies) && m.linkedCompanies.length >= 1);
  assert.ok(m.linkedCompanies[0].source.startsWith("https://"));
});
