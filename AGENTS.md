# AI Stock Research Overlay

Chrome extension (Manifest V3) that extracts the stock from supported sites
(Zerodha, Screener, Chartink, TradingView), researches it by automating a
logged-in chatgpt.com tab, scrapes the JSON reply, and renders a metrics
overlay. No OpenAI API key, no build step — Chrome loads the folder directly.

## Hard rules (MUST do on EVERY change)

1. **VERSION PUMP** — bump the version on every code change (patch by default):
   - `manifest.json` → `"version"`
   - `package.json` → `"version"`
   Both must match; `test/manifest.test.mjs` enforces this.
2. The ChatGPT content-script re-injection guard keys off
   `chrome.runtime.getManifest().version`, so the pump is what forces fresh
   content scripts after reloading the extension.
3. **RUN CHECKS BEFORE COMMITTING**:
   - `npm test` — all tests must pass.
   - `node --check <file>` — on every changed script.
4. **COMMIT AND PUSH** — after every change commit with a concise message and
   `git push` to origin. Same-version changes are not allowed.

## Conventions

- MV3; `background.service_worker` is a classic script (uses `importScripts`,
  NOT `"type": "module"`).
- `lib/` files are UMD: usable as service-worker globals (`StockResearch.*`)
  and as CommonJS in tests.
- `background.js` imports `lib/screener.js` and `lib/prompt.js`.
- Overlay = shadow-DOM content script (`content/overlay.js`); cache per symbol
  in `chrome.storage.local` (`cache:<SYMBOL>`), "Hard refresh" clears it.
- ChatGPT automation = `content/chatgpt.js`.
- No build step; reload the extension at `chrome://extensions` to test.

## Test commands

- `npm test`