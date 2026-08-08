/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const autocomplete = read("figure-autocomplete.js");
const renderer = read("figure-renderer.js");
const bridge = read("page-bridge.js");

assert.match(
  autocomplete,
  /renderedRecords\.length === 1[\s\S]*moveCursorVertical[\s\S]*direction:\s*1/
);
assert.match(
  autocomplete,
  /renderedRecords\.length === 1[\s\S]*moveCursorVertical[\s\S]*direction:\s*-1/
);
assert.match(renderer, /if \(!figure\?\.isConnected\) return null/);
assert.match(
  renderer,
  /hasMeasurablePopupGeometry[\s\S]*rect\.width > 1 && rect\.height > 1/
);
assert.match(
  renderer,
  /refresh\(\) \{[\s\S]*classList\.remove\("smarttex-figure-popup-viewport-frozen"\)[\s\S]*classList\.remove\("smarttex-figure-popup-media-pannable"\)[\s\S]*captureBaseGeometry\(true\)/
);
assert.match(bridge, /host\.appendChild\(structureHighlightLayer\)/);
assert.match(bridge, /"position:absolute"[\s\S]*"z-index:1"/);
assert.match(bridge, /\.ace_editor \.ace_text-layer,[\s\S]*z-index:\s*3 !important/);
assert.match(bridge, /\.cm-editor \.cm-content[\s\S]*z-index:\s*3 !important/);

console.log("SmartTeX popup and editor-highlight regression checks passed.");
