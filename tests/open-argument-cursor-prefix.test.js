/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} was not found`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} has no body`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} has an unterminated body`);
}

function loadContextFinder(fileName, finderName, pattern) {
  const source = fs.readFileSync(path.join(root, fileName), "utf8");
  const matchingClose = extractFunction(source, "matchingArgumentClose");
  const finder = extractFunction(source, finderName);
  const patternName = finderName === "findReferenceContext"
    ? "REFERENCE_COMMAND"
    : "CITE_COMMAND";
  return Function(
    patternName,
    `"use strict"; ${matchingClose}; ${finder}; return ${finderName};`
  )(pattern);
}

const referencePattern = /\\(eqref|ref|pageref|autoref|cref|Cref|vref|Vref|nameref)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/;
const citationPattern = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/i;

const findReferenceContext = loadContextFinder(
  "reference-autocomplete.js",
  "findReferenceContext",
  referencePattern
);
const findCitationContext = loadContextFinder(
  "citation-autocomplete.js",
  "findCitationContext",
  citationPattern
);

function state(value, cursorIndex) {
  return {
    value,
    cursorIndex,
    focused: true,
    fileName: "main.tex"
  };
}

{
  const value = String.raw`Text \ref{fig:alpha`;
  const cursorIndex = value.indexOf("alpha");
  const context = findReferenceContext(state(value, cursorIndex));
  assert.equal(context.fragment, "fig:");
  assert.equal(context.currentLabel, "fig:");
  assert.equal(context.fragmentEnd, cursorIndex);
}

{
  const value = String.raw`Text \ref{fig:alpha}`;
  const cursorIndex = value.indexOf("alpha");
  const context = findReferenceContext(state(value, cursorIndex));
  assert.equal(context.fragment, "fig:alpha");
  assert.equal(context.currentLabel, "fig:alpha");
  assert.equal(context.fragmentEnd, value.indexOf("}"));
}

{
  const value = String.raw`Text \cite{Einstein1916`;
  const cursorIndex = value.indexOf("stein");
  const context = findCitationContext(state(value, cursorIndex));
  assert.equal(context.fragment, "Ein");
  assert.equal(context.fragmentEnd, cursorIndex);
}

{
  const value = String.raw`Text \cite{Kluge2024,Einstein1916}`;
  const cursorIndex = value.indexOf("stein");
  const context = findCitationContext(state(value, cursorIndex));
  assert.equal(context.fragment, "Einstein1916");
  assert.equal(context.fragmentEnd, value.indexOf("}"));
}

{
  const source = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
  const matchingClose = extractFunction(source, "matchingArgumentClose");
  const completion = extractFunction(source, "completionTokenAtCursor");
  let editorState = null;
  const completionTokenAtCursor = Function(
    "getEditorState",
    `"use strict"; ${matchingClose}; ${completion}; return completionTokenAtCursor;`
  )(() => editorState);

  const openValue = String.raw`Text \ref{fig:alpha`;
  const openCursor = openValue.indexOf("alpha");
  editorState = { value: openValue, cursorIndex: openCursor };
  const openToken = completionTokenAtCursor(/\\(?:ref)\s*\{([^{}]*)$/);
  assert.equal(openToken.fragment, "fig:");
  assert.equal(openToken.end, openCursor);

  const closedValue = String.raw`Text \ref{fig:alpha}`;
  const closedCursor = closedValue.indexOf("alpha");
  editorState = { value: closedValue, cursorIndex: closedCursor };
  const closedToken = completionTokenAtCursor(/\\(?:ref)\s*\{([^{}]*)$/);
  assert.equal(closedToken.fragment, "fig:alpha");
  assert.equal(closedToken.end, closedValue.indexOf("}"));
}

console.log("Open argument cursor-prefix tests passed.");
