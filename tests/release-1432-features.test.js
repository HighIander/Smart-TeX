/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const content = read("content.js");
const css = read("content.css");
const bridge = read("page-bridge.js");
const guard = read("label-reference-guard.js");
const toolbar = read("editor-toolbar.js");
const reference = read("reference-autocomplete.js");
const figure = read("figure-autocomplete.js");

assert.equal(manifest.version, "2.1.0");

assert.match(bridge, /overlayOcclusionObserver/);
assert.match(bridge, /attributeFilter:\s*\["hidden", "class", "style", "open", "aria-hidden"\]/);
assert.match(bridge, /scheduleOverlayRender\(\)/);

assert.match(content, /smarttex-graphic-autocomplete-figure/);
assert.match(content, /ensurePopupZoom\?\.\(figure\)/);
assert.match(css, /smarttex-graphic-autocomplete-viewport\.smarttex-figure-popup-zoomed/);

assert.match(content, /smarttex-preview-loading-indicator/);
assert.match(content, /showPreviewLoading/);
assert.match(reference, /Gathering reference targets/);
assert.match(figure, /Gathering figure files/);
assert.match(css, /smarttex-figure-popup-placeholder\.smarttex-figure-popup-resolving::before/);

assert.match(guard, /Restore previous label/);
assert.match(guard, /restorePreviousLabel/);
assert.match(guard, /safeLatexContextBounds/);
assert.match(guard, /currentReferenceOccurrence\(usage, absoluteLabelStart\)/);

assert.match(toolbar, /smarttex-toolbar-sigma[^>]*[^\n]*Σ/);
assert.doesNotMatch(toolbar, /M18\.5 4H7l5 8-5 8/);

console.log("SmartTeX 1.4.32 feature regression checks passed.");
