/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const optionsHtml = fs.readFileSync(path.join(root, "options.html"), "utf8");
const optionsJs = fs.readFileSync(path.join(root, "options.js"), "utf8");
const menuJs = fs.readFileSync(path.join(root, "settings-menu.js"), "utf8");
const contentJs = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bridgeJs = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");

for (const source of [optionsJs, menuJs, bridgeJs]) {
  assert.match(source, /environmentColor:\s*"#dfedfb"/);
  assert.match(source, /environmentFirstLineColor:\s*"#c7e4ff"/);
  assert.match(source, /sectionColor:\s*"#c4a7ff"/);
  assert.match(source, /captionEnabled:\s*false/);
  assert.match(source, /captionColor:\s*"#70afea"/);
  assert.match(source, /labelEnabled:\s*false/);
  assert.match(source, /labelColor:\s*"#8fd19e"/);
  assert.match(source, /referenceEnabled:\s*true/);
  assert.match(source, /referenceColor:\s*"#bcf0c8"/);
  assert.match(source, /nonumberEnabled:\s*false/);
  assert.match(source, /nonumberColor:\s*"#ffe69a"/);
  assert.match(source, /inlineMathEnabled:\s*true/);
  assert.match(source, /inlineMathColor:\s*"#cce5ff"/);
}

assert.match(optionsHtml, /smarttex-highlight-environment-enabled" type="checkbox" checked/);
assert.match(optionsHtml, /smarttex-highlight-environment-color" type="color" value="#dfedfb"/);
assert.match(optionsHtml, /smarttex-highlight-environment-first-line-enabled" type="checkbox" checked/);
assert.match(optionsHtml, /smarttex-highlight-environment-first-line-color" type="color" value="#c7e4ff"/);
assert.match(optionsHtml, /smarttex-highlight-section-enabled" type="checkbox" checked/);
assert.match(optionsHtml, /smarttex-highlight-section-color" type="color" value="#c4a7ff"/);
assert.doesNotMatch(optionsHtml, /smarttex-highlight-caption-enabled" type="checkbox" checked/);
assert.match(optionsHtml, /smarttex-highlight-caption-color" type="color" value="#70afea"/);
assert.doesNotMatch(optionsHtml, /smarttex-highlight-label-enabled" type="checkbox" checked/);
assert.match(optionsHtml, /smarttex-highlight-label-color" type="color" value="#8fd19e"/);
assert.match(optionsHtml, /smarttex-highlight-reference-enabled" type="checkbox" checked/);
assert.match(optionsHtml, /smarttex-highlight-reference-color" type="color" value="#bcf0c8"/);
assert.doesNotMatch(optionsHtml, /smarttex-highlight-nonumber-enabled" type="checkbox" checked/);
assert.match(optionsHtml, /smarttex-highlight-nonumber-color" type="color" value="#ffe69a"/);
assert.match(optionsHtml, /smarttex-highlight-inline-math-enabled" type="checkbox" checked/);
assert.match(optionsHtml, /smarttex-highlight-inline-math-color" type="color" value="#cce5ff"/);

assert.match(contentJs, /captionEnabled:\s*settings\.captionEnabled === true/);
assert.match(contentJs, /labelEnabled:\s*settings\.labelEnabled === true/);
assert.match(contentJs, /nonumberEnabled:\s*settings\.nonumberEnabled === true/);
assert.match(contentJs, /referenceColor:\s*validColor\(settings\.referenceColor, "#bcf0c8"\)/);
assert.match(contentJs, /inlineMathColor:\s*validColor\(settings\.inlineMathColor, "#cce5ff"\)/);

assert.match(bridgeJs, /if \(!categoryEnabled\) return \(0\.10 \+ strength \* 0\.42\) \/ 3;/);
assert.match(bridgeJs, /activeAlpha\(0\.18, 0\.52, active, bodyEnabled, 3\)/);
assert.match(bridgeJs, /activeAlpha\(0\.34, 0\.72, active, firstLineEnabled, 3\)/);

console.log("Source highlight defaults and active-strength scaling checks passed.");
