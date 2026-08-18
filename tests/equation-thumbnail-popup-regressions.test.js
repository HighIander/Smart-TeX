/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const references = fs.readFileSync(path.join(root, "reference-autocomplete.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

assert.match(
  references,
  /SmartTeX task aborted:[\s\S]*?targetHydrationQueue\.push\(task\)|loading indicators[\s\S]*?targetHydrationQueue\.push\(task\)/
);
assert.match(
  css,
  /\.smarttex-document-reference-popup\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/
);
assert.match(
  css,
  /\.smarttex-document-reference-popup \.smarttex-reference-popup-target\s*\{[\s\S]*?overflow:\s*auto;/
);

console.log("Equation thumbnail retry and popup scroll regression checks passed.");
