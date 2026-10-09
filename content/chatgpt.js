/*
 * Runs on chatgpt.com / chat.openai.com.
 * Receives ASK_CHATGPT from the background worker, types the research
 * prompt into the composer, sends it, waits for the full streamed reply,
 * extracts the JSON object, and reports it back.
 *
 * Uses a logged-in ChatGPT web session (no API key required).
 */
(function () {
  "use strict";

  // Guard against double-injection (declarative content script + scripting fallback).
  // Keyed to the manifest version so every version bump re-registers fresh code.
  const INJECT_VERSION =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest
      ? chrome.runtime.getManifest().version
      : "dev";
  if (globalThis.__aiStockResearchChatgptInjected === INJECT_VERSION) return;
  globalThis.__aiStockResearchChatgptInjected = INJECT_VERSION;

  const JSONX = (typeof StockResearch !== "undefined" && StockResearch.json) || null;

  const SEL = {
    composer: [
      "#prompt-textarea",
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"]',
      "textarea[data-id]",
      "textarea"
    ],
    send: [
      '[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]'
    ],
    stop: [
      '[data-testid="stop-button"]',
      'button[data-testid="stop-streaming-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop"]'
    ],
    assistant: [
      '[data-message-author-role="assistant"]',
      'div[data-message-author-role="assistant"]',
      '[data-testid="assistant-message"]'
    ],
    turn: [
      '[data-testid^="conversation-turn"]',
      'article[data-testid]',
      "article"
    ]
  };

  let busy = false;
  let pingTimer = null;
  let current = { requestId: null, phase: "working", message: null };
  let cancelReq = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function q(list) {
    for (let i = 0; i < list.length; i++) {
      const el = document.querySelector(list[i]);
      if (el) return el;
    }
    return null;
  }

  function qa(list) {
    for (let i = 0; i < list.length; i++) {
      const els = document.querySelectorAll(list[i]);
      if (els && els.length) return Array.from(els);
    }
    return [];
  }

  function waitFor(fn, timeout, interval) {
    const step = interval || 250;
    const start = Date.now();
    return new Promise((resolve, reject) => {
      (function loop() {
        let val;
        try {
          val = fn();
        } catch (e) {
          val = null;
        }
        if (val) return resolve(val);
        if (Date.now() - start > timeout) return reject(new Error("Timed out waiting for ChatGPT."));
        setTimeout(loop, step);
      })();
    });
  }

  function safeSend(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      /* extension context invalidated */
    }
  }

  function sendStatus(phase, message) {
    if (phase) current.phase = phase;
    if (message) current.message = message;
    safeSend({
      type: "CHATGPT_STATUS",
      requestId: current.requestId,
      phase: current.phase,
      message: current.message
    });
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => sendStatus(), 8000);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function setComposerText(el, text) {
    el.focus();

    // Replace any existing selection/content, then insert as a single text run.
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch (e) {
      inserted = false;
    }

    const readText = () => (el.value !== undefined && el.tagName === "TEXTAREA" ? el.value : el.innerText || el.textContent || "");
    const need = Math.min(12, String(text).trim().length);

    if (!inserted || readText().trim().length < need) {
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (e) {}
    }

    if (readText().trim().length < need) {
      if (el.tagName === "TEXTAREA") {
        el.value = text;
      } else {
        el.textContent = text;
      }
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      } catch (e) {}
    }
  }

  function clickSend() {
    const btn = q(SEL.send);
    if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
      btn.click();
      return true;
    }
    const c = q(SEL.composer);
    if (c) {
      c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      return true;
    }
    return false;
  }

  async function waitForNoStream(timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (cancelReq === current.requestId) return false;
      if (!q(SEL.stop)) return true;
      await sleep(500);
    }
    return !q(SEL.stop);
  }

  function assistantText(node) {
    if (!node) return "";
    const md = node.querySelector(".markdown") || node.querySelector('[class*="markdown"]');
    return (md ? md.innerText : node.innerText) || "";
  }

  function tryJson(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  }

  function normSym(s) {
    return String(s || "")
      .toUpperCase()
      .split(":")
      .pop()
      .replace(/[^A-Z0-9]/g, "");
  }

  // Collect text from several containers. textContent is used (not innerText)
  // because it does not depend on layout, so it works in a background tab.
  function collectTextSources() {
    const parts = [];
    const push = (t) => {
      if (t && t.length) parts.push(t);
    };
    try {
      const main = document.querySelector("main");
      if (main) push(main.textContent || "");
    } catch (e) {}
    qa(SEL.assistant).forEach((n) => push(n.textContent || ""));
    qa(SEL.turn).forEach((n) => push(n.textContent || ""));
    try {
      if (document.body) push(document.body.innerText || "");
    } catch (e) {}
    return parts;
  }

  // Scan the rendered page for answer objects. The prompt's schema is valid
  // JSON (its "comments" live inside strings), so the requested symbol is what
  // distinguishes the model's real answer.
  function scanAnswerBlocks(symbol) {
    if (!JSONX) return [];
    const want = symbol ? normSym(symbol) : null;
    const seen = new Set();
    const out = [];
    const sources = collectTextSources();
    for (let s = 0; s < sources.length; s++) {
      let text = sources[s];
      if (text.length > 120000) text = text.slice(-120000);
      let from = 0;
      while (from < text.length) {
        const block = JSONX.findBalancedObject(text, from);
        if (!block) break;
        if (!seen.has(block)) {
          seen.add(block);
          const parsed = tryJson(block);
          if (parsed && typeof parsed === "object" && parsed.metrics) {
            const sym = parsed.symbol ? normSym(parsed.symbol) : null;
            if (!want || !sym || sym === want) out.push({ parsed: parsed, block: block });
          }
        }
        from = text.indexOf(block, from) + block.length;
      }
    }
    return out;
  }

  // Only accept an answer block that did not exist before the prompt was sent,
  // so a reused conversation's older answer can never be returned.
  async function waitForAnswer(symbol, beforeSet, timeout) {
    const start = Date.now();
    let lastBlock = null;
    let stableSince = null;
    let best = null;
    while (Date.now() - start < timeout) {
      if (cancelReq === current.requestId) return best;
      let candidate = null;
      const blocks = scanAnswerBlocks(symbol);
      for (let i = 0; i < blocks.length; i++) {
        if (!beforeSet.has(blocks[i].block)) candidate = blocks[i];
      }
      const block = candidate ? candidate.block : null;
      if (candidate) best = candidate;
      if (block && block === lastBlock) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince > 1200) return best;
      } else {
        stableSince = null;
        lastBlock = block;
      }
      await sleep(400);
    }
    return best;
  }

  async function runAsk(msg) {
    current = { requestId: msg.requestId, phase: "working", message: "Checking ChatGPT\u2026" };
    cancelReq = null;
    startPing();
    try {
      // Wait until any in-flight generation finishes.
      sendStatus("opening", "Waiting for ChatGPT\u2026");
      await waitForNoStream(90000);
      if (cancelReq === msg.requestId) return;

      sendStatus("opening", "Locating composer\u2026");
      let composer;
      try {
        composer = await waitFor(() => q(SEL.composer), 30000, 400);
      } catch (e) {
        throw new Error("ChatGPT composer not found. Open chatgpt.com, log in, and keep the tab open.");
      }
      if (cancelReq === msg.requestId) return;

      const before = qa(SEL.assistant).length;
      const beforeSet = new Set(scanAnswerBlocks(msg.symbol).map((b) => b.block));

      sendStatus("asking", "Sending research prompt\u2026");
      setComposerText(composer, msg.prompt);
      await sleep(300);
      if (cancelReq === msg.requestId) return;
      if (!clickSend()) {
        throw new Error("Could not press ChatGPT send button.");
      }

      // If the send did not register (button was disabled), retry with Enter.
      try {
        await waitFor(() => qa(SEL.assistant).length > before, 8000, 300);
      } catch (e) {
        const c = q(SEL.composer);
        if (c) {
          c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        }
      }

      sendStatus("reading", "Waiting for the research answer\u2026");
      const found = await waitForAnswer(msg.symbol, beforeSet, 180000);
      if (cancelReq === msg.requestId) return;

      if (found) {
        safeSend({
          type: "CHATGPT_RESULT",
          requestId: msg.requestId,
          text: found.block,
          payload: found.parsed,
          parseError: null
        });
        return;
      }

      // No JSON yet — surface whatever the assistant said, if anything.
      const nodes = qa(SEL.assistant);
      const fallbackText = assistantText(nodes[nodes.length - 1]);
      if (fallbackText && fallbackText.trim()) {
        safeSend({
          type: "CHATGPT_RESULT",
          requestId: msg.requestId,
          text: fallbackText,
          payload: null,
          parseError: "No JSON object found in the reply."
        });
        return;
      }
      throw new Error("Timed out waiting for the ChatGPT answer.");
    } catch (e) {
      if (cancelReq === msg.requestId) return; // user cancelled; no result to deliver
      safeSend({
        type: "CHATGPT_RESULT",
        requestId: msg.requestId,
        error: (e && e.message) || String(e)
      });
    } finally {
      stopPing();
      busy = false;
      cancelReq = null;
      current = { requestId: null, phase: "working", message: null };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "CHATGPT_CANCEL") {
      if (cancelReq === msg.requestId) return;
      cancelReq = msg.requestId;
      // Try to stop any in-flight generation immediately.
      try {
        const stopBtn = q(SEL.stop);
        if (stopBtn) stopBtn.click();
      } catch (e) {}
      return;
    }
    if (msg.type !== "ASK_CHATGPT") return;
    if (busy) {
      sendResponse({ ok: false });
      safeSend({
        type: "CHATGPT_RESULT",
        requestId: msg.requestId,
        error: "ChatGPT is already running another research request. Please wait."
      });
      return true;
    }
    busy = true;
    sendResponse({ ok: true });
    runAsk(msg);
    return true;
  });
})();
