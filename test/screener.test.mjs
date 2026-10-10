import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const screener = require("../lib/screener.js");

const HTML = `
<ul id="top-ratios" class="company-ratios">
  <li class="flex-row"><span class="name">Market Cap</span><span class="nowrap value"><span class="number">151</span> <span class="unit">Cr.</span></span></li>
  <li class="flex-row"><span class="name">Current Price</span><span class="nowrap value"><span class="number">148</span></span></li>
  <li class="flex-row"><span class="name">Stock P/E</span><span class="nowrap value"><span class="number">94.6</span></span></li>
  <li class="flex-row"><span class="name">Dividend Yield</span><span class="nowrap value"><span class="number">0.00</span> <span class="unit">%</span></span></li>
  <li class="flex-row"><span class="name">ROCE</span><span class="nowrap value"><span class="number">56.8</span> <span class="unit">%</span></span></li>
  <li class="flex-row"><span class="name">ROE</span><span class="nowrap value"><span class="number">114</span> <span class="unit">%</span></span></li>
</ul>
<section id="quarters" class="card">
  <table class="data-table">
    <thead><tr><th></th><th>Jun 2025</th><th>Sep 2025</th><th>Dec 2025</th><th>Mar 2026</th><th>Jun 2026</th></tr></thead>
    <tbody>
      <tr><td>Sales +</td><td>367</td><td>533</td><td>644</td><td>1,097</td><td>555</td></tr>
      <tr><td>Operating Profit</td><td>80</td><td>94</td><td>118</td><td>163</td><td>86</td></tr>
      <tr><td>Net Profit +</td><td>55</td><td>68</td><td>79</td><td>106</td><td>62</td></tr>
    </tbody>
  </table>
</section>
`;

test("parseScreener extracts top ratios", () => {
  const p = screener.parseScreener(HTML);
  assert.ok(p);
  assert.equal(p.ratios.ltp, 148);
  assert.equal(p.ratios.mcap, "151 Cr.");
  assert.equal(p.ratios.pe, 94.6);
  assert.equal(p.ratios.divYield, 0);
  assert.equal(p.ratios.roce, 56.8);
  assert.equal(p.ratios.roe, 114);
});

test("parseScreener extracts quarterly series", () => {
  const p = screener.parseScreener(HTML);
  assert.deepEqual(p.quarterly.series.sales, [367, 533, 644, 1097, 555]);
  assert.deepEqual(p.quarterly.series.netProfit, [55, 68, 79, 106, 62]);
  assert.deepEqual(p.quarterly.series.operatingProfit, [80, 94, 118, 163, 86]);
});

test("parseScreener computes QoQ and YoY", () => {
  const c = screener.parseScreener(HTML).changes;
  assert.equal(c.qoq.sales, "-49.4%");
  assert.equal(c.yoy.sales, "+51.2%");
  assert.equal(c.qoq.netProfit, "-41.5%");
  assert.equal(c.yoy.netProfit, "+12.7%");
  assert.equal(c.qoq.profit, "-47.2%");
  assert.equal(c.yoy.profit, "+7.5%");
});

test("parseScreener returns null for garbage", () => {
  assert.equal(screener.parseScreener("nope"), null);
  assert.equal(screener.parseScreener(""), null);
  assert.equal(screener.parseScreener(null), null);
});

test("parseQuarterlyRows parses DOM-style rows with explicit header", () => {
  const header = ["", "Jun 2025", "Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026"];
  const rows = [
    ["Sales +", "367", "533", "644", "1,097", "555"],
    ["Expenses +", "287", "439", "526", "934", "469"],
    ["Operating Profit", "80", "94", "118", "163", "86"],
    ["OPM %", "21.8%", "17.6%", "18.3%", "14.9%", "15.5%"],
    ["Net Profit +", "55", "68", "79", "106", "62"],
    ["EPS in Rs", "1.10", "1.36", "1.58", "2.12", "1.24"]
  ];
  const q = screener.parseQuarterlyRows(rows, header);
  assert.ok(q);
  assert.deepEqual(q.columns, ["Jun 2025", "Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026"]);
  assert.deepEqual(q.series.sales, [367, 533, 644, 1097, 555]);
  assert.deepEqual(q.series.netProfit, [55, 68, 79, 106, 62]);
  assert.deepEqual(q.series.operatingProfit, [80, 94, 118, 163, 86]);
  assert.equal(q.changes.qoq.sales, "-49.4%");
  assert.equal(q.changes.yoy.netProfit, "+12.7%");
  assert.equal(q.changes.qoq.profit, "-47.2%");
});

test("parseQuarterlyRows returns null without matching rows", () => {
  assert.equal(screener.parseQuarterlyRows([["foo", "1", "2"]], ["", "x", "y"]), null);
  assert.equal(screener.parseQuarterlyRows([], []), null);
});

test("parseWorkCap extracts CCC, DSO, DIO, DPO, WC days and status", () => {
  const html = `
    <section id="ratios" class="card card-large">
      <table class="data-table">
        <thead><tr><th></th><th>Mar 2024</th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
        <tbody>
          <tr><td>Debtor Days</td><td>0</td><td>0</td><td>-0</td></tr>
          <tr><td>Inventory Days</td><td>151</td><td>140</td><td>195</td></tr>
          <tr><td>Days Payable</td><td>69</td><td>85</td><td>79</td></tr>
          <tr><td>Cash Conversion Cycle</td><td>87</td><td>56</td><td>116</td></tr>
          <tr><td>Working Capital Days</td><td>50</td><td>19</td><td>47</td></tr>
        </tbody>
      </table>
    </section>`;
  const w = screener.parseWorkCap(html);
  assert.ok(w);
  assert.equal(w.ccc.value, 116);
  assert.equal(w.ccc.prev, 56);
  assert.equal(w.ccc.delta, 60);
  assert.equal(w.dio.value, 195);
  assert.equal(w.dio.delta, 55);
  assert.equal(w.dpo.value, 79);
  assert.equal(w.dpo.delta, -6);
  assert.equal(w.wcDays.value, 47);
  assert.equal(w.wcDays.delta, 28);
  assert.equal(w.status, "Worse");
});

test("parseWorkCap says Good when CCC shrinks", () => {
  const html = `
    <section id="ratios" class="card card-large">
      <table class="data-table">
        <thead><tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
        <tbody>
          <tr><td>Debtor Days</td><td>10</td><td>8</td></tr>
          <tr><td>Inventory Days</td><td>190</td><td>150</td></tr>
          <tr><td>Days Payable</td><td>70</td><td>80</td></tr>
          <tr><td>Cash Conversion Cycle</td><td>130</td><td>78</td></tr>
          <tr><td>Working Capital Days</td><td>60</td><td>40</td></tr>
        </tbody>
      </table>
    </section>`;
  const w = screener.parseWorkCap(html);
  assert.ok(w);
  assert.equal(w.ccc.delta, -52);
  assert.equal(w.status, "Good");
});

test("parseWorkCap returns null without ratios table", () => {
  assert.equal(screener.parseWorkCap("no table here"), null);
});

const ANNUAL_HTML = `
<ul id="top-ratios" class="company-ratios">
  <li class="flex-row"><span class="name">Current Price</span><span class="nowrap value"><span class="number">154</span></span></li>
</ul>
<section id="profit-loss" class="card">
  <table class="data-table">
    <thead><tr><th></th><th>Mar 2015</th><th>Mar 2016</th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
    <tbody>
      <tr><td>Sales +</td><td>287</td><td>334</td><td>3,060</td><td>3,428</td></tr>
      <tr><td>Operating Profit</td><td>28</td><td>32</td><td>475</td><td>515</td></tr>
      <tr><td>Net Profit +</td><td>10</td><td>12</td><td>163</td><td>177</td></tr>
    </tbody>
  </table>
</section>
<section id="cash-flow" class="card">
  <table class="data-table">
    <thead><tr><th></th><th>Mar 2024</th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
    <tbody>
      <tr><td>Cash from Operating Activity +</td><td>85</td><td>191</td><td>-96</td></tr>
    </tbody>
  </table>
</section>
<section id="balance-sheet" class="card">
  <table class="data-table">
    <thead><tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
    <tbody>
      <tr><td>Equity Capital</td><td>35</td><td>36</td></tr>
      <tr><td>Borrowings +</td><td>861</td><td>995</td></tr>
      <tr><td>Other Liabilities +</td><td>372</td><td>525</td></tr>
      <tr><td>Other Assets +</td><td>716</td><td>1,412</td></tr>
      <tr><td>Total Assets</td><td>1,577</td><td>2,422</td></tr>
    </tbody>
  </table>
</section>`;

test("parseFundamentals computes CFO/PAT, Piotroski proxy and performance", () => {
  const f = screener.parseFundamentals(ANNUAL_HTML);
  assert.ok(f);
  assert.equal(f.cfoPat, -0.54);
  assert.ok(typeof f.piotroski === "number");
  assert.equal(f.performance, "Good");
  // Cross-check the F-score apart by hand:
  // +ve NP(1) +ve CFO(0) ROA up(0) CFO>NP(0) leverage down(1)
  // other-asset ratio up(1) no new shares(0) op margin up(0) turnover up(0) = 3
  assert.equal(f.piotroski, 3);
});

test("parseScreener carries fundamentals", () => {
  const p = screener.parseScreener(ANNUAL_HTML);
  assert.ok(p);
  assert.equal(p.fundamentals.cfoPat, -0.54);
  assert.equal(p.fundamentals.piotroski, 3);
  assert.equal(p.fundamentals.performance, "Good");
});

test("parseFundamentals returns null without annual sections", () => {
  assert.equal(screener.parseFundamentals("no sections here"), null);
  assert.equal(screener.parseFundamentals(""), null);
});

test("computeValuation blends Graham number and growth-adjusted EPS", () => {
  // V2RETAIL: LTP 154, P/E 34.4 -> EPS 4.477, Book Value 24.8, YoY NP +12.7%.
  const v = screener.computeValuation({
    ltp: 154,
    pe: 34.4,
    bookValue: 24.8,
    growth: "+12.7%"
  });
  assert.ok(v);
  assert.equal(v.eps, 4.48);
  assert.ok(v.fairValue > 0);
  assert.ok(["Undervalued", "Fair", "Overvalued"].includes(v.status));
  assert.ok(v.percent > 0);
});

test("computeValuation returns null without LTP or P/E", () => {
  assert.equal(screener.computeValuation({ ltp: 154, pe: null, bookValue: 24.8 }), null);
  assert.equal(screener.computeValuation({ ltp: 0, pe: 10, bookValue: 24.8 }), null);
  assert.equal(screener.computeValuation(null), null);
});

test("computeValuation works with only book value (no growth)", () => {
  const v = screener.computeValuation({ ltp: 100, pe: 10, bookValue: 50 });
  assert.ok(v);
  // EPS = 10, Graham = sqrt(22.5 * 10 * 50) = sqrt(11250) ~ 106.07
  assert.ok(Math.abs(v.fairValue - 106.07) < 0.1);
});

test("parseScreener exposes computed valuation", () => {
  const html =
    `<ul id="top-ratios">
       <li><span class="name">Current Price</span><span class="value"><span class="number">154</span></span></li>
       <li><span class="name">Stock P/E</span><span class="value"><span class="number">34.4</span></span></li>
       <li><span class="name">Book Value</span><span class="value"><span class="number">24.8</span></span></li>
     </ul>`;
  const p = screener.parseScreener(html);
  assert.ok(p.valuation);
  assert.equal(p.ratios.bookValue, 24.8);
  assert.ok(p.valuation.fairValue > 0);
});
