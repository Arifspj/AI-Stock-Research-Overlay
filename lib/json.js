/*
 * Robust JSON extraction from an LLM chat reply.
 * Handles ```json fences, leading/trailing prose, and nested braces.
 * Usable as a content-script global and as a CommonJS module for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.StockResearch = root.StockResearch || {};
  root.StockResearch.json = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function tryParse(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return undefined;
    }
  }

  // Scan for a balanced {...} block, ignoring braces inside strings.
  function findBalancedObject(text, fromIndex) {
    const start = text.indexOf("{", fromIndex);
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  /**
   * @param {string} text
   * @returns {object|null}
   */
  function extractJson(text) {
    if (!text) return null;
    const str = String(text);

    // 1) fenced blocks first (most reliable)
    const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = fenceRe.exec(str)) !== null) {
      const parsed = tryParse(m[1].trim());
      if (parsed && typeof parsed === "object") return parsed;
    }

    // 2) whole string
    let parsed = tryParse(str.trim());
    if (parsed && typeof parsed === "object") return parsed;

    // 3) first balanced object
    let searchFrom = 0;
    while (searchFrom < str.length) {
      const candidate = findBalancedObject(str, searchFrom);
      if (!candidate) break;
      parsed = tryParse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
      searchFrom = str.indexOf(candidate, searchFrom) + candidate.length;
    }

    return null;
  }

  /**
   * Merge a parsed payload with a safe, fully-shaped default so the UI
   * never has to guard for missing fields.
   */
  function normalizePayload(payload, fallbackSymbol) {
    const p = payload && typeof payload === "object" ? payload : {};
    const metrics = p.metrics && typeof p.metrics === "object" ? p.metrics : {};
    const val = metrics.valuation && typeof metrics.valuation === "object" ? metrics.valuation : {};
    const qoq = metrics.qoq && typeof metrics.qoq === "object" ? metrics.qoq : {};
    const yoy = metrics.yoy && typeof metrics.yoy === "object" ? metrics.yoy : {};

    const asNum = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
      return isNaN(n) ? null : n;
    };
    const asStr = (v) => (v === null || v === undefined || v === "" ? null : String(v));

    const asList = (v) => {
      if (!Array.isArray(v)) return [];
      return v
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const out = {};
          for (const k of Object.keys(item)) {
            const val = item[k];
            if (Array.isArray(val)) {
              out[k] = val.map((x) => asStr(x));
            } else {
              out[k] = asStr(val);
            }
          }
          return out;
        })
        .filter((item) => Object.keys(item).length > 0);
    };
    const asSector = (s) => {
      const o = s && typeof s === "object" ? s : {};
      return {
        name: asStr(o.name),
        tailwind: o.tailwind === true,
        reason: asStr(o.reason)
      };
    };

return {
      symbol: asStr(p.symbol) || fallbackSymbol || "-",
      name: asStr(p.name) || asStr(p.companyName) || asStr(p.symbol) || fallbackSymbol || "-",
      source: asStr(p.source) || "chatgpt",
      screenerOnly: p.screenerOnly === true,
      generatedAt: asStr(p.generatedAt) || new Date().toISOString(),
      summary: asStr(p.summary),
      sector: asSector(p.sector),
      linkedCompanies: asList(p.linkedCompanies),
      bigOrders: asList(p.bigOrders),
      catalysts: asList(p.catalysts),
      risks: asList(p.risks),
      raw: p,
      metrics: {
        badges: Array.isArray(metrics.badges) ? metrics.badges.map(String) : [],
        ltp: asNum(metrics.ltp),
        action: (asStr(metrics.action) || "").toUpperCase() || null,
        qoq: {
          netProfit: asStr(qoq.netProfit),
          sales: asStr(qoq.sales),
          profit: asStr(qoq.profit)
        },
        yoy: {
          netProfit: asStr(yoy.netProfit),
          sales: asStr(yoy.sales),
          profit: asStr(yoy.profit)
        },
        valuation: {
          status: asStr(val.status),
          percent: asNum(val.percent),
          fairValue: asNum(val.fairValue),
          ltp: asNum(val.ltp) !== null ? asNum(val.ltp) : asNum(metrics.ltp)
        },
        mcap: asStr(metrics.mcap),
        pe: asNum(metrics.pe),
        divYield: asNum(metrics.divYield),
        roce: asNum(metrics.roce),
        roe: asNum(metrics.roe),
        cfoPat: asNum(metrics.cfoPat),
        piotroski: asNum(metrics.piotroski),
        performance: asStr(metrics.performance),
        workingCapital: metrics.workingCapital && typeof metrics.workingCapital === "object" ? metrics.workingCapital : null
      }
    };
  }

  return {
    extractJson: extractJson,
    normalizePayload: normalizePayload,
    findBalancedObject: findBalancedObject
  };
});
