"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const pageBridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const latexContext = fs.readFileSync(path.join(root, "latex-context.js"), "utf8");

assert.match(latexContext, /function sectionNumbering\(/);
assert.match(latexContext, /\\\\appendix\\b[\s\S]*counters\.fill\(0\)/);
assert.match(latexContext, /appendix[\s\S]*alphaNumber\(counters\[0\]\)/);
assert.match(pageBridge, /latexContext\?\.sectionNumbering\?\.\(source\)/);
assert.doesNotMatch(
  pageBridge,
  /sectionCounters\[level\]\s*\+=\s*1/,
  "The page badge renderer must not maintain a second section counter implementation."
);

console.log("section numbering integration regression test passed");
