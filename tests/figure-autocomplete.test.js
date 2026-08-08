/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const background = read("background.js");
const bridge = read("page-bridge.js");
const autocomplete = read("figure-autocomplete.js");
const content = read("content.js");
const css = read("content.css");

assert.match(background, /"figure-autocomplete\.js"/);
assert.match(bridge, /request\.type === "listProjectFigures"/);
assert.match(bridge, /request\.type === "replaceFigureToken"/);
assert.match(bridge, /setFigureAutocompleteActive/);
assert.match(autocomplete, /findFigureContext[\s\S]*\\includegraphics/);
assert.match(autocomplete, /Only show figures not yet included/);
assert.match(autocomplete, /record\.included \? "✓" : ""/);
assert.match(autocomplete, /left\.path\.localeCompare\(right\.path/);
assert.doesNotMatch(autocomplete, /Sort alphabetically/);
assert.match(autocomplete, /item\.dataset\.smarttexFigurePath = record\.path/);
assert.match(content, /smarttex:graphic-autocomplete-selection-change/);
assert.match(content, /dataset\?\.smarttexFigurePath/);
assert.match(css, /\.smarttex-figure-autocomplete-list\s*\{[\s\S]*overflow:\s*auto/);
assert.match(css, /\.smarttex-figure-autocomplete-check\s*\{[\s\S]*color:\s*#17833f/);

console.log("Figure autocomplete regression checks passed.");
