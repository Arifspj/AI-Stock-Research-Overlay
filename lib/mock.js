/*
 * Demo / mock research payload so the overlay UI can be tested without
 * touching ChatGPT. Deterministic-ish values derived from the symbol.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.StockResearch = root.StockResearch || {};
  root.StockResearch.mock = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  const ACTIONS = ["BUY", "SELL", "HOLD", "EXIT"];
  const PERF = ["Excellent", "Good", "Bad"];
  const VAL = ["Undervalued", "Overvalued", "Fair"];

  function getMock(symbol, exchange) {
    const sym = (symbol || "DEMO").toUpperCase();
    const h = hash(sym);
    const pick = (arr, salt) => arr[(h + (salt || 0)) % arr.length];
    const num = (min, max, salt) => +(min + ((h + (salt || 0) * 977) % (max - min))).toFixed(2);

    const ltp = +num(50, 4200, 1);
    const status = pick(VAL, 3);
    const pct = +num(3, 35, 4);
    const fairValue = status === "Undervalued" ? +(ltp * (1 + pct / 100)).toFixed(2)
      : status === "Overvalued" ? +(ltp * (1 - pct / 100)).toFixed(2)
        : +ltp.toFixed(2);

    const badgesPool = ["DEBT FREE", "QUALITY BUSINESS", "ROCE STAR", "HIGH GROWTH", "LOW PEG", "CASH RICH", "DIVIDEND PLAY", "TURNAROUND"];
    const badges = [];
    const count = 2 + (h % 3);
    for (let i = 0; i < count; i++) {
      const b = badgesPool[(h + i * 7) % badgesPool.length];
      if (badges.indexOf(b) === -1) badges.push(b);
    }

    const sign = (n) => (n >= 0 ? "+" : "") + n + "%";
    const sector = pick(["Consumer Electronics Retail", "IT Services", "Pharmaceuticals", "Fast-Moving Consumer Goods", "Auto Components"], 19);

    return {
      symbol: sym,
      name: sym + " Ltd",
      source: "demo",
      generatedAt: new Date().toISOString(),
      summary:
        sym +
        " operates in the " +
        sector +
        " space. The key call is execution: the business is growing, but watches out for margin pressure and share-count changes.",
      sector: {
        name: sector,
        tailwind: false,
        reason:
          "Competitive " +
          sector.toLowerCase() +
          " is not a structural tailwind; growth depends on execution, margins and store/business expansion."
      },
      linkedCompanies: [
        {
          name: "supplier brands",
          relation: "Key product brands stocked/sourced by " + sym + "; agreements not independently confirmed.",
          source: "https://www.screener.in/company/" + sym + "/"
        }
      ],
      bigOrders: [
        {
          desc: "Sample large order/allotment used for demo purposes only.",
          value: "\u20b9" + num(1, 100, 20).toFixed(2) + " crore",
          date: "Current quarter",
          source: "https://www.screener.in/company/" + sym + "/"
        }
      ],
      catalysts: [
        {
          point: "Sample: business expansion and new store/storefront addition could lift revenue.",
          source: "https://www.screener.in/company/" + sym + "/"
        },
        {
          point: "Sample: margins as the key swing factor for the quarter.",
          source: "https://www.screener.in/company/" + sym + "/"
        }
      ],
      risks: [
        {
          point: "Sample: competition and discounting can compress margins.",
          source: "https://www.screener.in/company/" + sym + "/"
        },
        {
          point: "Sample: dilution / promoter holding changes may affect existing shareholders.",
          source: "https://www.screener.in/company/" + sym + "/"
        }
      ],
      metrics: {
        badges: badges,
        ltp: ltp,
        action: pick(ACTIONS, 2),
        qoq: {
          netProfit: sign(num(-20, 40, 5)),
          sales: sign(num(-15, 35, 6)),
          profit: sign(num(-20, 40, 7))
        },
        yoy: {
          netProfit: sign(num(-30, 80, 8)),
          sales: sign(num(-20, 60, 9)),
          profit: sign(num(-30, 80, 10))
        },
        valuation: {
          status: status,
          percent: pct,
          fairValue: fairValue,
          ltp: ltp
        },
        mcap: num(500, 250000, 11).toLocaleString("en-IN") + " Cr",
        pe: +num(8, 90, 12),
        divYield: +num(0, 4, 13),
        roce: +num(5, 45, 14),
        roe: +num(4, 38, 15),
        cfoPat: +num(0.4, 1.8, 16),
        piotroski: num(3, 9, 17),
        performance: pick(PERF, 18)
      }
    };
  }

  return { getMock: getMock };
});
