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
