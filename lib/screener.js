/*
 * Scraper for screener.in company pages (service-worker friendly, no DOM).
 * Extracts the top ratios (LTP / Market Cap / P/E / Div Yield / ROCE / ROE)
 * and the Quarterly Results table, then computes QoQ / YoY % changes for
 * Sales, Net Profit and Operating Profit.
 *
 * Usable as a service-worker global and as a CommonJS module for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.StockResearch = root.StockResearch || {};
  root.StockResearch.screener = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function stripTags(s) {
    return String(s)
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toNum(s) {
    if (s === null || s === undefined) return null;
    const cleaned = String(s).replace(/,/g, "").replace(/[^0-9.\-]/g, "").trim();
    if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }

  function extractBlock(html, tag, id) {
    const re = new RegExp("<" + tag + "[^>]*\\bid=[\"']" + id + "[\"'][\\s\\S]*?</" + tag + ">", "i");
    const m = String(html).match(re);
    return m ? m[0] : "";
  }

  // ---- top ratios -------------------------------------------------------
  function parseRatios(html) {
    const block = extractBlock(html, "ul", "top-ratios") || html;
    const out = {};
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = liRe.exec(block)) !== null) {
      const inner = m[1];
      const nameM = inner.match(/class="[^"]*\bname\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const numM = inner.match(/class="[^"]*\bnumber\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const valM = inner.match(/class="[^"]*\bvalue\b[^"]*"[^>]*>([\s\S]*)$/i);
      if (!nameM) continue;
      const name = stripTags(nameM[1]);
      const raw = valM ? stripTags(valM[1]) : numM ? stripTags(numM[1]) : stripTags(inner);
      out[name] = { raw: raw, num: toNum(numM ? stripTags(numM[1]) : raw) };
    }
    return out;
  }

  // ---- quarterly table --------------------------------------------------
  function parseTable(sectionHtml) {
    const rows = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = trRe.exec(sectionHtml)) !== null) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c;
      while ((c = cellRe.exec(m[1])) !== null) cells.push(stripTags(c[1]));
      if (cells.length) rows.push(cells);
    }
    return rows;
  }

  /**
   * Rows are arrays like [label, col1, col2, ...]. Optionally pass the
   * column header labels (quarter names) explicitly; otherwise the header is
   * detected from a row whose second cell looks like "May 2026".
   * @returns {{columns:string[], series:object, changes:object}|null}
   */
  function parseQuarterlyRows(rows, header) {
    if (!rows || !rows.length) return null;
    const salesRow = findRow(rows, "sales");
    const netRow = findRow(rows, "net profit");
    const opRow = findRow(rows, "operating profit");
    if (!salesRow && !netRow && !opRow) return null;

    let columns = [];
    if (Array.isArray(header) && header.length) {
      columns = header.slice(1);
    } else {
      const h = rows.find((r) => r[1] && /[A-Za-z]{3}\s*\d{4}/.test(r[1]));
      columns = h ? h.slice(1) : [];
    }

    const series = {
      sales: salesRow ? seriesFromRow(salesRow) : null,
      netProfit: netRow ? seriesFromRow(netRow) : null,
      operatingProfit: opRow ? seriesFromRow(opRow) : null
    };

    return {
      columns: columns,
      series: series,
      changes: {
        qoq: {
          sales: changesFor(series.sales).qoq,
          netProfit: changesFor(series.netProfit).qoq,
          profit: changesFor(series.operatingProfit).qoq
        },
        yoy: {
          sales: changesFor(series.sales).yoy,
          netProfit: changesFor(series.netProfit).yoy,
          profit: changesFor(series.operatingProfit).yoy
        }
      }
    };
  }

  function findRow(rows, label) {
    const l = label.toLowerCase();
    for (let i = 0; i < rows.length; i++) {
      const first = (rows[i][0] || "").toLowerCase();
      if (first.indexOf(l) === 0) return rows[i];
    }
    return null;
  }

  function seriesFromRow(row) {
    return row.slice(1).map(toNum);
  }

  function pctChange(curr, prev) {
    if (curr === null || prev === null || prev === 0) return null;
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  }

  function changesFor(series) {
    if (!series) return { qoq: null, yoy: null };
    const idxs = [];
    for (let i = 0; i < series.length; i++) if (series[i] !== null) idxs.push(i);
    if (idxs.length < 2) return { qoq: null, yoy: null };
    const last = idxs[idxs.length - 1];
    const prev = idxs[idxs.length - 2];
    const yoyIdx = last - 4;
    const yoy =
      yoyIdx >= 0 && series[yoyIdx] !== null ? pctChange(series[last], series[yoyIdx]) : null;
    return { qoq: pctChange(series[last], series[prev]), yoy: yoy };
  }

  function parseQuarterly(html) {
    const section = extractBlock(html, "section", "quarters");
    if (!section) return null;
    return parseQuarterlyRows(parseTable(section));
  }

  // ---- working capital / cash-conversion ratios -------------------------
  // Screener's "Ratios" section rows carry Debtor Days (DSO), Inventory Days
  // (DIO), Days Payable (DPO), Cash Conversion Cycle and Working Capital Days
  // as yearly values: [,  Mar 2015, ..., Mar 2026].
  function parseWorkCap(html) {
    const section = extractBlock(html, "section", "ratios");
    if (!section) return null;
    const rows = parseTable(section);
    const lastTwo = (row) => {
      if (!row) return null;
      const nums = row.slice(1).map(toNum).filter((v) => v !== null);
      if (!nums.length) return null;
      const last = nums[nums.length - 1];
      const prev = nums.length > 1 ? nums[nums.length - 2] : null;
      return { value: last, prev: prev, delta: prev === null ? null : Math.round((last - prev) * 10) / 10 };
    };
    const ccc = lastTwo(findRow(rows, "cash conversion cycle"));
    const wc = lastTwo(findRow(rows, "working capital days"));
    const dso = lastTwo(findRow(rows, "debtor days"));
    const dio = lastTwo(findRow(rows, "inventory days"));
    const dpo = lastTwo(findRow(rows, "days payable"));
    if (!ccc && !wc) return null;

    let status = "Stable";
    if (ccc && ccc.delta !== null && ccc.delta !== 0) status = ccc.delta > 0 ? "Worse" : "Good";
    else if (wc && wc.delta !== null && wc.delta > 0) status = "Worse";
    else if (wc && wc.delta !== null && wc.delta < 0) status = "Good";

    return { ccc: ccc, dso: dso, dio: dio, dpo: dpo, wcDays: wc, status: status };
  }

  /**
   * @param {string} html
   * @returns {{ratios:object, quarterly:object|null, changes:object|null, workingCapital:object|null}|null}
   */
  function parseScreener(html) {
    if (!html || typeof html !== "string") return null;
    const ratios = parseRatios(html);
    const quarterly = parseQuarterly(html);
    if (!Object.keys(ratios).length && !quarterly) return null;

    const get = (name) => (ratios[name] ? ratios[name] : null);
    const ltp = get("Current Price");
    const mcap = get("Market Cap");
    const pe = get("Stock P/E");
    const div = get("Dividend Yield");
    const roce = get("ROCE");
    const roe = get("ROE");

    return {
      ratios: {
        ltp: ltp ? ltp.num : null,
        mcap: mcap ? mcap.raw : null,
        pe: pe ? pe.num : null,
        divYield: div ? div.num : null,
        roce: roce ? roce.num : null,
        roe: roe ? roe.num : null
      },
      quarterly: quarterly,
      changes: quarterly ? quarterly.changes : null,
      workingCapital: parseWorkCap(html)
    };
  }

  return {
    parseScreener: parseScreener,
    parseRatios: parseRatios,
    parseQuarterly: parseQuarterly,
    parseQuarterlyRows: parseQuarterlyRows,
    parseWorkCap: parseWorkCap,
    changesFor: changesFor,
    stripTags: stripTags
  };
});
