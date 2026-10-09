import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

test("package.json version matches manifest version", () => {
  assert.equal(pkg.version, manifest.version);
});

test("manifest is valid MV3", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.background.service_worker);
  assert.ok(Array.isArray(manifest.permissions));
});

test("all referenced files exist", () => {
  const refs = [];
  refs.push(manifest.background.service_worker);
  refs.push(manifest.action.default_popup);
  for (const key of Object.keys(manifest.icons)) refs.push(manifest.icons[key]);
  for (const cs of manifest.content_scripts) {
    for (const js of cs.js) refs.push(js);
  }
  for (const rel of refs) {
    const p = path.join(rootDir, rel);
    assert.ok(fs.existsSync(p), "missing file: " + rel);
  }
});

test("content scripts match the four supported sites plus chatgpt", () => {
  const allMatches = manifest.content_scripts.flatMap((cs) => cs.matches);
  for (const host of [
    "kite.zerodha.com",
    "screener.in",
    "chartink.com",
    "tradingview.com",
    "chatgpt.com"
  ]) {
    assert.ok(
      allMatches.some((m) => m.includes(host)),
      "no content script match for " + host
    );
  }
});

test("host_permissions cover chatgpt and supported sites", () => {
  const hp = manifest.host_permissions.join(" ");
  for (const host of ["chatgpt.com", "kite.zerodha.com", "screener.in", "chartink.com", "tradingview.com"]) {
    assert.ok(hp.includes(host), "missing host permission for " + host);
  }
});
