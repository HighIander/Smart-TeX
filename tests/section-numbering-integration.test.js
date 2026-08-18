"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const pageBridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const latexContext = fs.readFileSync(path.join(root, "latex-context.js"), "utf8");

assert.match(latexContext, /function sectionNumbering\(/);
assert.match(latexContext, /event\.kind === "appendix"[\s\S]*counters\.section = 0/);
assert.match(latexContext, /templates\.set\("section", "\\\\Alph\{section\}"\)/);
assert.match(latexContext, /numberwithin[\s\S]*counterwithin[\s\S]*counterwithout/);
assert.match(latexContext, /\\\\\(arabic\|roman\|Roman\|alph\|Alph\)/);
assert.match(pageBridge, /latexContext\?\.sectionNumbering\?\.\(source\)/);
assert.match(pageBridge, /latexContext\?\.figurePreviewNumber\?\.\(source, context\)/);
assert.match(pageBridge, /latexContext\?\.tablePreviewNumber\?\.\(source, context\)/);
assert.doesNotMatch(
  pageBridge,
  /counters\[base\]\s*\+=\s*1/,
  "Figure and table badges must use the shared document counter analysis."
);
assert.doesNotMatch(
  pageBridge,
  /sectionCounters\[level\]\s*\+=\s*1/,
  "The page badge renderer must not maintain a second section counter implementation."
);

console.log("section numbering integration regression test passed");
