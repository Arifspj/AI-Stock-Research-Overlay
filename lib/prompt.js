/*
 * Builds the research prompt asking ChatGPT for strict JSON.
 * Usable as a service-worker global and as a CommonJS module for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.StockResearch = root.StockResearch || {};
  root.StockResearch.prompt = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA = {
    symbol: "string",
    name: "string",
    summary:
      "string  // 1-3 sentence plain-English summary of what the company does and the key call (write for a retail investor)",
    sector: {
      name: "string  // e.g. Consumer Electronics Retail",
      tailwind: "boolean  // is this sector a structural tailwind?",
      reason: "string  // one line on why"
    },
    linkedCompanies: [
      {
        name: "string  // brand / supplier / acquirer name",
        relation:
          "string  // how the company is linked (distributor, brand stocked, acquisition target, etc.)",
        source: "string  // a real supporting URL (screener.in, NSE/BSE filing)"
      }
    ],
    bigOrders: [
      {
        desc: "string  // what the order/allotment is",
        value: "string  // e.g. \"₹25.74 crore\"",
        date: "string  // when",
        source: "string  // a real supporting URL"
      }
    ],
    catalysts: [
      { point: "string  // a specific upcoming or recent catalyst", source: "string  // a real supporting URL" }
    ],
    risks: [
      { point: "string  // a concrete risk", source: "string  // a real supporting URL" }
    ],
    metrics: {
      badges: ["string  // short UPPERCASE tags e.g. DEBT FREE, QUALITY BUSINESS, ROCE STAR, HIGH GROWTH, LOW PEG, CASH RICH"],
      ltp: "number  // last traded price in INR",
      action: "\"BUY\" | \"SELL\" | \"HOLD\" | \"EXIT\"",
      qoq: { netProfit: "string", sales: "string", profit: "string" },
      yoy: { netProfit: "string", sales: "string", profit: "string" },
      valuation: {
        status: "\"Undervalued\" | \"Overvalued\" | \"Fair\"",
        percent: "number  // how far from fair value, percent",
        fairValue: "number",
        ltp: "number"
      },
      mcap: "string  // e.g. 12,345 Cr",
      pe: "number  // Stock P/E (TTM)",
      divYield: "number  // dividend yield percent",
      roce: "number  // percent",
      roe: "number  // percent",
      cfoPat: "number  // CFO / PAT ratio",
      piotroski: "number  // 0-9",
      performance: "\"Excellent\" | \"Good\" | \"Bad\""
    }
  };

  function buildPrompt(symbol, exchange, verified) {
    const ex = exchange || "NSE";
    const today = new Date().toISOString().slice(0, 10);
    const screenerConsolidated = "https://www.screener.in/company/" + symbol + "/consolidated/";
    const screener = "https://www.screener.in/company/" + symbol + "/";
    const lines = [
      "You are an equity research analyst covering Indian listed companies.",
      "Today's date is " + today + ".",
      ""
    ];

    if (verified) {
      lines.push(
        "GROUND TRUTH - freshly scraped from screener.in for \"" + symbol + "\" (" + ex + ").",
        "These numbers are authoritative. Copy them EXACTLY into the JSON - do NOT change, round or guess them:",
        JSON.stringify(verified, null, 2),
        "",
        "Rules for the ground-truth fields:",
        "- metrics.ltp = ltp, metrics.mcap = marketCap, metrics.pe = pe, metrics.divYield = divYield,",
        "  metrics.roce = roce, metrics.roe = roe.",
        "- metrics.qoq and metrics.yoy must equal the qoq/yoy objects exactly.",
        "- metrics.valuation.ltp must equal ltp.",
        "",
        "Now use your analysis (and web search if helpful) to fill ONLY the remaining fields:",
        "- badges (2-5 short UPPERCASE tags), action (BUY | SELL | HOLD | EXIT),",
        "- valuation.status / percent / fairValue (your fair-value estimate vs the given ltp),",
        "- cfoPat, piotroski (compute the F-score 0-9), performance (Excellent | Good | Bad).",
        "- summary, sector (name/tailwind/reason),",
        "- linkedCompanies (2-4 key links), bigOrders (recent orders/allotments),",
        "- catalysts (2-4), risks (2-5). Cite a REAL source URL for each item.",
        ""
      );
    } else {
      lines.push(
        "STEP 1 - YOU MUST USE THE WEB SEARCH / BROWSE TOOL. Do NOT answer from memory.",
        "Live prices and ratios change every day, so open these pages for \"" + symbol + "\" (" + ex + ") now:",
        "- " + screenerConsolidated,
        "- " + screener,
        "- a live quote page (NSE/BSE, Moneycontrol or Google Finance) for the current price.",
        "Note the date you saw the price.",
        "",
        "STEP 2 - READ THE REAL NUMBERS FROM THOSE PAGES:",
        "- LTP (current price), Market Cap, Stock P/E (TTM), Dividend Yield, ROCE and ROE from screener's summary.",
        "- Quarterly Results (CONSOLIDATED if available): Sales, Operating Profit and Net Profit for the last ~8 quarters.",
        "",
        "STEP 3 - COMPUTE QoQ AND YoY (mandatory, real numbers):",
        "- QoQ = latest reported quarter vs the immediately previous quarter.",
        "- YoY = latest reported quarter vs the SAME quarter one year earlier.",
        "",
        "STEP 4 - GATHER STORY & QUALITATIVE SNAPSHOTS (with real source URLs):",
        "- summary: 1-3 sentences on what the business does and the key call.",
        "- sector: name, whether it is a structural tailwind, and a one-line reason.",
        "- linkedCompanies: 2-4 material links (suppliers, brands stocked, acquisitions) with source URLs.",
        "- bigOrders: 1-3 recent orders/large deals/allotments with approximate value, date and source.",
        "- catalysts: 2-4 concrete upcoming/recent triggers for the stock.",
        "- risks: 2-5 concrete risks from the filings/page content.",
        "",
        "STEP 5 - COMPUTE THE PIOTROSKI F-SCORE (integer 0-9).",
        "Score one point for each true test: positive net income; positive operating cash flow; rising ROA;",
        "operating cash flow greater than net income; falling leverage; rising current ratio; no new share issuance;",
        "rising gross margin; rising asset turnover. metrics.piotroski MUST be a number 0-9, never null.",
        ""
      );
    }

    lines.push(
      "Return ONLY one valid JSON object. No markdown, no code fences, no explanation before or after.",
      "Use this exact schema (replace descriptive comments with real values):",
      JSON.stringify(SCHEMA, null, 2),
      "",
      "Rules:",
      "- qoq/yoy netProfit, sales, profit must be strings with the % change, e.g. \"+12.5%\" or \"-4.2%\".",
      "- DO NOT output \"N/A\" or null for qoq, yoy or piotroski if the data is available.",
      "- Numeric fields must be plain numbers (no units, no commas). Use null only when genuinely unknown.",
      "- badges: 2 to 5 short UPPERCASE tags that best describe the business.",
      "- linkedCompanies, bigOrders, catalysts and risks: arrays of objects; each object MUST include a real source URL.",
      "- summary: write it for a retail investor (plain English, concrete, no boilerplate).",
      "- action: your call for a retail investor right now.",
      "- valuation.status must be compared against the current LTP and fairValue.",
      "- Output the JSON object only."
    );

    return lines.join("\n");
  }

  return { buildPrompt: buildPrompt, SCHEMA: SCHEMA };
});
