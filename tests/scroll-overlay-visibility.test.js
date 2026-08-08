/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const listeners = new Map();
const timers = new Map();
let timerId = 0;
const classes = new Set();
const scrollStates = [];

const editorTarget = {
  scrollTop: 0,
  scrollLeft: 0,
  matches(selector) { return String(selector).includes(".ace_scroller"); },
  closest(selector) { return String(selector).includes(".ace_") ? this : null; },
  querySelector() { return this; },
  parentElement: null
};

class CustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}

const sandbox = {
  console,
  CustomEvent,
  scrollX: 0,
  scrollY: 0,
  navigator: { scheduling: { isInputPending() { return false; } } },
  document: {
    activeElement: editorTarget,
    scrollingElement: null,
    documentElement: {
      classList: {
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }
      }
    }
  },
  addEventListener(type, callback) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
  },
  dispatchEvent(event) {
    if (event.type === "smarttex:editor-scroll-state") scrollStates.push(event.detail);
    for (const callback of listeners.get(event.type) || []) callback(event);
    return true;
  },
  setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
  requestAnimationFrame(callback) { callback(); return 1; },
  cancelAnimationFrame() {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "interaction-tasks.js"), "utf8"), sandbox, {
  filename: "interaction-tasks.js"
});

function emit(type, target = editorTarget) {
  for (const callback of listeners.get(type) || []) {
    callback({ type, target, composedPath: () => [target] });
  }
}

const popupTarget = {
  closest(selector) { return String(selector).includes("#smarttex-reference-autocomplete-popup") ? this : null; },
  parentElement: null
};
const generationBeforePopupWheel = sandbox.SmartTeXInteractionTasks.generation();
emit("wheel", popupTarget);
assert.equal(
  sandbox.SmartTeXInteractionTasks.generation(),
  generationBeforePopupWheel,
  "scrolling inside a SmartTeX popup must not hide or cancel the popup"
);

// Keyboard input and wheel intent cancel background work, but must not hide UI.
emit("keydown");
assert.equal(classes.has("smarttex-editor-scrolling"), false);
emit("wheel");
assert.equal(classes.has("smarttex-editor-scrolling"), false);

// A spurious scroll event at an unchanged offset must not hide overlays.
emit("scroll");
assert.equal(classes.has("smarttex-editor-scrolling"), false);

// Only an actual viewport displacement starts the hidden-scroll state.
editorTarget.scrollTop = 48;
emit("scroll");
assert.equal(classes.has("smarttex-editor-scrolling"), true);
assert.equal(sandbox.SmartTeXInteractionTasks.isScrolling(), true);
assert.equal(scrollStates.at(-1)?.active, true);

for (const callback of [...timers.values()]) callback();
assert.equal(classes.has("smarttex-editor-scrolling"), false);
assert.equal(sandbox.SmartTeXInteractionTasks.isScrolling(), false);
assert.equal(scrollStates.at(-1)?.active, false);

const css = fs.readFileSync(path.join(root, "content.css"), "utf8");
for (const selector of [
  "#smarttex-source-structure-highlights",
  "#smarttex-source-number-badges",
  "#smarttex-equation-preview",
  ".smarttex-document-reference-popup",
  "#smarttex-reference-autocomplete-popup",
  "#smarttex-citation-popup",
  "#smarttex-figure-autocomplete-popup"
]) {
  assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
assert.match(content, /popupsSuppressedAfterEditorScroll = true/);
assert.match(content, /Popups are intentionally not restored after scrolling/);
assert.doesNotMatch(content, /active !== false[\s\S]{0,300}scheduleRender\(\)/);
for (const file of ["reference-autocomplete.js", "citation-autocomplete.js", "figure-autocomplete.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.match(source, /editor-scroll-state[\s\S]{0,260}scrollSuppressed = true[\s\S]{0,120}hidePopup\(\)/);
}
assert.match(fs.readFileSync(path.join(root, "page-bridge.js"), "utf8"), /smarttex:editor-scroll-state/);

console.log("Actual editor-scroll overlay visibility tests passed.");
