/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const listeners = new Map();
const timers = new Map();
let timerCounter = 0;
const sandbox = {
  console,
  queueMicrotask,
  setTimeout(callback) {
    const id = ++timerCounter;
    timers.set(id, callback);
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  requestAnimationFrame(callback) { callback(); return 1; },
  CustomEvent: class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  },
  document: {
    addEventListener() {},
    querySelectorAll() { return []; },
    body: { appendChild() {} }
  },
  getComputedStyle() { return { display: "block", visibility: "visible" }; },
  addEventListener(type, callback) { listeners.set(type, callback); },
  dispatchEvent() {},
  browser: {
    storage: {
      local: { get: async () => ({}) },
      onChanged: { addListener() {} }
    }
  }
};
sandbox.window = sandbox;
sandbox.top = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "latex-context.js"), "utf8"), context, {
  filename: "latex-context.js"
});
vm.runInContext(fs.readFileSync(path.join(root, "label-reference-guard.js"), "utf8"), context, {
  filename: "label-reference-guard.js"
});

const api = sandbox.SmartTeXLabelReferenceGuard?.forTest;
assert.ok(api, "The standalone label-reference guard API was not exposed");

const beforeSource = String.raw`\section{Test}\label{sec:old}
See \ref{sec:old}.
\begin{equation}
  E = mc^2 \label{eq:energy}
\end{equation}
See \eqref{eq:energy}.`;
const afterSource = beforeSource.replace("sec:old}", "sec:new}");
const before = api.sourceAnalysis({ fileName: "main.tex", value: beforeSource });
const after = api.sourceAnalysis({ fileName: "main.tex", value: afterSource });
const issues = api.changedLabelIssues(before, after);
assert.equal(issues.length, 1);
assert.equal(issues[0].oldLabel, "sec:old");
assert.equal(issues[0].newLabel, "sec:new");
assert.equal(issues[0].changed, true);
assert.equal(issues[0].usages.length, 1);
assert.equal(issues[0].usages[0].command, "ref");

const labelCursor = afterSource.indexOf("sec:new") + 3;
const activeField = api.labelFieldAtCursor({
  fileName: "main.tex",
  value: afterSource,
  cursorIndex: labelCursor
});
assert.equal(activeField?.label, "sec:new");
assert.equal(api.cursorStillEditingIssue(issues[0], {
  fileName: "main.tex",
  value: afterSource,
  cursorIndex: labelCursor
}), true);
assert.equal(api.labelFieldAtCursor({
  fileName: "main.tex",
  value: afterSource,
  cursorIndex: afterSource.indexOf("See")
}), null);
assert.equal(api.cursorStillEditingIssue(issues[0], {
  fileName: "main.tex",
  value: afterSource,
  cursorIndex: afterSource.indexOf("See")
}), false);

const verifiedIssue = api.issueForOldRecord(issues[0].oldRecord, after);
assert.equal(verifiedIssue?.newLabel, "sec:new");
assert.equal(verifiedIssue?.usages.length, 1);
const restored = api.sourceAnalysis({ fileName: "main.tex", value: beforeSource });
assert.equal(api.issueForOldRecord(issues[0].oldRecord, restored), null);

const contextSource = "First sentence. Second sentence before. See \\ref{sec:old} here. First sentence after. Second sentence after.";
const sentenceContext = api.surroundingSentenceContext(contextSource, contextSource.indexOf("\\ref"));
assert.match(sentenceContext, /First sentence\./);
assert.match(sentenceContext, /Second sentence after\./);

const deletedSource = beforeSource.replace(String.raw`\label{sec:old}`, "");
const deleted = api.changedLabelIssues(
  before,
  api.sourceAnalysis({ fileName: "main.tex", value: deletedSource })
);
assert.equal(deleted.length, 1);
assert.equal(deleted[0].changed, false);

assert.doesNotMatch(fs.readFileSync(path.join(root, "background.js"), "utf8"), /analysis-(?:client|worker)\.js|editor-state-client\.js/);
assert.match(fs.readFileSync(path.join(root, "background.js"), "utf8"), /"label-reference-guard\.js"/);
const guardSource = fs.readFileSync(path.join(root, "label-reference-guard.js"), "utf8");
assert.match(guardSource, /change\.textContent = "Update"/);
assert.doesNotMatch(guardSource, /link\.title = usage\.excerpt/);
assert.match(guardSource, /renderRichPreview/);
console.log("Stable 1.4.20-based label-reference guard tests passed.");
