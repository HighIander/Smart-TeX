/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

class FakeNode {
  constructor(tagName = "") {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.className = "";
    this._text = "";
    this.isConnected = true;
  }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  addEventListener() {}
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  get textContent() {
    if (this.tagName === "#TEXT") return this._text;
    return this._text + this.children.map((child) => child.textContent || "").join("");
  }
  set textContent(value) { this._text = String(value || ""); this.children = []; }
}

const listeners = new Map();
const sandbox = {
  console,
  queueMicrotask,
  setTimeout() { return 1; },
  clearTimeout() {},
  requestAnimationFrame(callback) { callback(); return 1; },
  CustomEvent: class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  },
  document: {
    createElement(tagName) { return new FakeNode(tagName); },
    createTextNode(value) { const node = new FakeNode("#text"); node._text = String(value); return node; },
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
  },
  katex: {
    render(latex, element) { element.textContent = `[math:${latex}]`; }
  }
};
sandbox.window = sandbox;
sandbox.top = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);
for (const file of ["latex-context.js", "label-reference-guard.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}

const api = sandbox.SmartTeXLabelReferenceGuard?.forTest;
assert.ok(api);

const source = String.raw`\section{Target}\label{sec:x}
Before \textbf{bold \customcommand{nested}} with \unit{eV} and $E=mc^2$.
See \ref{sec:x} first. Then \emph{again \ref{sec:x}} after \LaTeX{} text.`;
const analysis = api.sourceAnalysis({ fileName: "main.tex", value: source });
assert.equal(analysis.referenceUsages.length, 2);
const usage = analysis.referenceUsages[1];
const details = api.surroundingSentenceContextDetails(source, usage.sourceIndex);
const container = new FakeNode("div");
api.renderLatexFragment(container, details.text, source, details.start, usage, 0);

function flatten(node) {
  return [node, ...node.children.flatMap(flatten)];
}
const nodes = flatten(container);
const highlighted = nodes.filter((node) => String(node.className).split(/\s+/).includes("smarttex-label-guard-preview-current"));
assert.equal(highlighted.length, 1, "only the selected reference occurrence may be highlighted");
assert.doesNotMatch(container.textContent, /\\(?:textbf|customcommand|unit|emph|LaTeX)\b/);
assert.match(container.textContent, /LaTeX/);

// Exercise the complete command parser independently of the deliberately local,
// symmetric sentence window around the second reference occurrence.
const parserContainer = new FakeNode("div");
api.renderLatexFragment(parserContainer, source, source, 0, usage, 0);
assert.doesNotMatch(parserContainer.textContent, /\\(?:textbf|customcommand|unit|emph|LaTeX)\b/);
assert.match(parserContainer.textContent, /bold nested/);
assert.match(parserContainer.textContent, /eV/);
assert.match(parserContainer.textContent, /\[math:E=mc\^2\]/);
assert.match(parserContainer.textContent, /LaTeX/);

assert.equal(api.currentReferenceOccurrence(usage, usage.labelStart), true);
assert.equal(api.currentReferenceOccurrence(usage, analysis.referenceUsages[0].labelStart), false);

const renamedSource = source.replace(String.raw`\label{sec:x}`, String.raw`\label{sec:y}`);
const renamedAnalysis = api.sourceAnalysis({ fileName: "main.tex", value: renamedSource });
const renamedRecord = renamedAnalysis.references.find((record) => record.label === "sec:y");
assert.deepEqual(
  { ...api.resolveDefinitionValueRange(renamedSource, renamedRecord, "sec:y") },
  { start: renamedRecord.valueStart, end: renamedRecord.valueEnd }
);


const environmentSource = String.raw`Before sentence.
\begin{align}
A &= B. \\
C &= \ref{sec:x}. \\
D &= E.
\end{align}
After sentence.`;
const environmentCutStart = environmentSource.indexOf("C &=");
const environmentCutEnd = environmentSource.indexOf("D &=");
const environmentBounds = api.safeLatexContextBounds(
  environmentSource,
  environmentCutStart,
  environmentCutEnd
);
assert.equal(environmentBounds.start, environmentSource.indexOf(String.raw`\begin{align}`));
assert.equal(environmentBounds.end, environmentSource.indexOf(String.raw`\end{align}`) + String.raw`\end{align}`.length);

const inlineMathSource = String.raw`Before. $A. B + \ref{sec:x}. C$. After.`;
const inlineMathBounds = api.safeLatexContextBounds(
  inlineMathSource,
  inlineMathSource.indexOf("B +"),
  inlineMathSource.indexOf("C$")
);
assert.equal(
  inlineMathSource.slice(inlineMathBounds.start, inlineMathBounds.end),
  String.raw`$A. B + \ref{sec:x}. C$`
);

const commandSource = String.raw`Before. \textbf{A. B \ref{sec:x}. C}. After.`;
const commandBounds = api.safeLatexContextBounds(
  commandSource,
  commandSource.indexOf(String.raw`B \ref`),
  commandSource.indexOf("C}")
);
assert.equal(
  commandSource.slice(commandBounds.start, commandBounds.end),
  String.raw`\textbf{A. B \ref{sec:x}. C}`
);


const documentWrappedSource = String.raw`\begin{document}
DOCUMENT-BEGIN-SENTINEL. Prefix one. Prefix two. Prefix three. Prefix four. Prefix five.
Local sentence one. Local sentence two. See \ref{sec:x} here. Local sentence three. Local sentence four.
\end{document}`;
const documentReferenceIndex = documentWrappedSource.indexOf(String.raw`\ref{sec:x}`);
const documentDetails = api.surroundingSentenceContextDetails(
  documentWrappedSource,
  documentReferenceIndex
);
assert.doesNotMatch(documentDetails.text, /DOCUMENT-BEGIN-SENTINEL/);
assert.doesNotMatch(documentDetails.text, /\\begin\{document\}/);
assert.match(documentDetails.text, /See \\ref\{sec:x\} here/);
assert.ok(documentDetails.start > documentWrappedSource.indexOf("DOCUMENT-BEGIN-SENTINEL"));


const largeMinipageSource = String.raw`Before zero. Before one. Before two. Before three. Before four.
\begin{minipage}{0.9\textwidth}
Inside zero. Inside one. Inside two. Inside three. See \ref{sec:x} exactly here. After one. After two. After three. After four. After five.
\end{minipage}
Outside one. Outside two.`;
const largeReferenceStart = largeMinipageSource.indexOf(String.raw`\ref{sec:x}`);
const largeReferenceEnd = largeReferenceStart + String.raw`\ref{sec:x}`.length;
const largeDetails = api.surroundingSentenceContextDetails(
  largeMinipageSource,
  largeReferenceStart,
  4,
  4,
  largeReferenceEnd
);
assert.doesNotMatch(largeDetails.text, /\\begin\{minipage\}|\\end\{minipage\}/);
assert.doesNotMatch(largeDetails.text, /Before zero|Outside two/);
assert.match(largeDetails.text, /See \\ref\{sec:x\} exactly here/);
assert.ok(largeDetails.beforeSentences <= 4 && largeDetails.afterSentences <= 4);
const beforeLength = largeReferenceStart - largeDetails.start;
const afterLength = largeDetails.end - largeReferenceEnd;
assert.ok(
  Math.max(beforeLength, afterLength) / Math.max(1, Math.min(beforeLength, afterLength)) < 1.8,
  `context should be approximately symmetric (${beforeLength} before, ${afterLength} after)`
);

const wrappedAnalysis = api.sourceAnalysis({ fileName: "main.tex", value: documentWrappedSource });
assert.equal(wrappedAnalysis.referenceUsages.length, 1);
assert.equal(
  Object.prototype.hasOwnProperty.call(wrappedAnalysis.referenceUsages[0], "contextExcerpt"),
  false,
  "expensive context extraction must be deferred until hover"
);

console.log("Label-reference rich LaTeX preview tests passed.");
