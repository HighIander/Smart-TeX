/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const renderer = read("figure-renderer.js");
const css = read("content.css");
const bridge = read("page-bridge.js");
const guard = read("label-reference-guard.js");

assert.equal(manifest.version, "1.4.34");

assert.match(renderer, /smarttexBaseHeightPx/);
assert.match(renderer, /smarttex-figure-popup-viewport-frozen/);
assert.match(renderer, /smarttex-figure-popup-media-pannable/);
assert.match(renderer, /this\.panY = Math\.min\(maximumY, Math\.max\(minimumY, this\.panY\)\)/);
assert.match(css, /smarttex-figure-popup-media\.smarttex-figure-popup-media-pannable/);
assert.match(css, /position:\s*absolute/);
assert.match(css, /contain:\s*layout paint/);

assert.match(bridge, /effectiveOverlaySurface/);
assert.match(bridge, /only the outer tooltip\/list\/dialog window covers editor highlights/);

assert.match(guard, /SAFE_CONTEXT_IGNORED_ENVIRONMENTS = new Set\(\["document"\]\)/);
assert.match(guard, /Rendering reference context…/);
assert.match(guard, /prepareDocumentCommandContext/);
assert.match(guard, /referenceTargets:\s*new Map\(\)/);
assert.match(guard, /citationTargets:\s*new Map\(\)/);
assert.doesNotMatch(guard, /contextExcerpt,\s*\n\s*contextStart:/);

console.log("SmartTeX 1.4.33 zoom/pan and label-preview regression checks passed.");
