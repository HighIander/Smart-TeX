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
assert.match(autocomplete, /kind:\s*"directory"/);
assert.match(autocomplete, /kind:\s*"parent"/);
assert.match(autocomplete, /activateRecord\(record\)/);
assert.match(autocomplete, /candidate\.indexOf\(query\)/);
assert.match(autocomplete, /const globalSearch = Boolean/);
assert.match(autocomplete, /const VIEW_MODE_KEY = "smarttex:figure-list-view:v1"/);
assert.match(autocomplete, /let viewMode = "grid"/);
assert.match(autocomplete, /\[VIEW_MODE_KEY\]: viewMode/);
assert.match(autocomplete, /if \(globalSearch\) \{[\s\S]*kind: "file"/);
assert.match(autocomplete, /replaceFigureToken", \{ text: record\.path \}/);
assert.match(autocomplete, /response\.complete === true\) replaceFigures\(response\.figures\)/);
assert.match(autocomplete, /function removeBasenameAliases\(records\)/);
assert.match(autocomplete, /cleanProjectPath\(path\)\.includes\("\/"\)/);
assert.match(autocomplete, /mergeFigures\(response\.figures\)/);
assert.doesNotMatch(autocomplete, /response\.figures[\s\S]{0,180}filter\([\s\S]{0,180}includes\("\/"\)/);
assert.doesNotMatch(autocomplete, /basename\.startsWith\(query\)/);
assert.match(autocomplete, /smarttex-autocomplete-match/);
assert.doesNotMatch(autocomplete, /Sort alphabetically/);
assert.match(autocomplete, /item\.dataset\.smarttexFigurePath = record\.path/);
assert.match(content, /smarttex:graphic-autocomplete-selection-change/);
assert.match(content, /popup\.addEventListener\("wheel"[\s\S]*setZoom\(scale \+ \(event\.deltaY < 0 \? 0\.25 : -0\.25\)\)/);
assert.match(content, /dataset\?\.smarttexFigurePath/);
assert.match(
  bridge,
  /paths = new Set\(withoutFigureBasenameAliases\([\s\S]*listProjectZipPaths\(archive, FIGURE_FILE_PATTERN\)/
);
assert.match(bridge, /hierarchyNames\.slice\(0, level - 1\)/);
assert.match(bridge, /function treeItemVisualIndent\(item\)/);
assert.match(bridge, /const visualFolders = \[\]/);
assert.match(bridge, /visualFolders\.map\(\(folder\) => folder\.name\)/);
assert.match(bridge, /if \(path\.includes\("\/"\)\) add\(path\)/);
assert.match(bridge, /function withoutFigureBasenameAliases\(values\)/);
assert.doesNotMatch(bridge, /add\(value\.name\)/);
assert.match(css, /\.smarttex-figure-autocomplete-list\s*\{[\s\S]*overflow:\s*auto/);
assert.match(css, /\.smarttex-figure-autocomplete-check\s*\{[\s\S]*color:\s*#17833f/);
assert.match(css, /\.smarttex-autocomplete-match\s*\{[\s\S]*font-weight:\s*900/);
assert.match(
  css,
  /#smarttex-graphic-autocomplete-preview\.smarttex-graphic-autocomplete-click-preview,[\s\S]*z-index:\s*2147483647/
);

console.log("Figure autocomplete regression checks passed.");
