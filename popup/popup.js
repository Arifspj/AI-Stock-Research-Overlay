"use strict";

const DEFAULTS = { demo: false, autoResearch: true, autoOpen: true };

function $(id) {
  return document.getElementById(id);
}

function load() {
  chrome.storage.local.get(DEFAULTS, (s) => {
    $("demo").checked = !!s.demo;
    $("autoResearch").checked = !!s.autoResearch;
    $("autoOpen").checked = !!s.autoOpen;
  });
}

function save(key, value) {
  chrome.storage.local.set({ [key]: value });
}

["demo", "autoResearch", "autoOpen"].forEach((key) => {
  $(key).addEventListener("change", (e) => save(key, e.target.checked));
});

$("openChatgpt").addEventListener("click", () => {
  try {
    const p = chrome.runtime.sendMessage({ type: "OPEN_CHATGPT" });
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
  window.close();
});

$("clear").addEventListener("click", () => {
  chrome.storage.local.set(DEFAULTS, load);
});

load();
