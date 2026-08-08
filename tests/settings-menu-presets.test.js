/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const background = read("background.js");
const menu = read("settings-menu.js");
const optionsHtml = read("options.html");
const optionsJs = read("options.js");
const content = read("content.js");
const bridge = read("page-bridge.js");
const referenceAutocomplete = read("reference-autocomplete.js");
const labelGuard = read("label-reference-guard.js");

assert.equal(manifest.version, "2.0.1");
assert.match(background, /"content\.js",\s*"settings-menu\.js",\s*"figure-autocomplete\.js"/);
assert.match(optionsHtml, /<title>SmartTeX presets<\/title>/);
assert.match(optionsHtml, /<h1>SmartTeX presets<\/h1>/);
assert.match(optionsHtml, /smarttex-highlight-environment-first-line-enabled/);
assert.match(optionsHtml, /smarttex-highlight-environment-first-line-color/);
assert.match(optionsHtml, /smarttex-highlight-section-enabled/);
assert.match(optionsHtml, /smarttex-highlight-section-color/);
assert.match(optionsHtml, /data-reset-setting="environmentFirstLineHighlight"/);
assert.match(optionsHtml, /data-reset-setting="sectionHighlight"/);
assert.match(optionsJs, /environmentFirstLineEnabled/);
assert.match(optionsJs, /sectionEnabled/);

assert.match(menu, /Use extension defaults/);
assert.match(menu, /smarttex:document-overrides:v1/);
assert.match(menu, /Data protection/);
assert.match(menu, /Imprint/);
assert.match(menu, /Edit extension presets/);
assert.match(menu, /smarttex:runtime-settings/);
assert.match(menu, /environmentFirstLineEnabled/);
assert.match(menu, /sectionEnabled/);
assert.match(menu, /Reset .* to the extension preset/);
assert.doesNotMatch(menu, /Document editor sites/);

assert.match(content, /RUNTIME_SETTINGS_EVENT = "smarttex:runtime-settings"/);
assert.match(content, /environmentFirstLineEnabled/);
assert.match(content, /sectionEnabled/);
assert.match(referenceAutocomplete, /RUNTIME_SETTINGS_EVENT/);
assert.match(labelGuard, /RUNTIME_SETTINGS_EVENT/);

assert.match(bridge, /environmentFirstLineEnabled/);
assert.match(bridge, /environmentFirstLineColor/);
assert.match(bridge, /sectionEnabled/);
assert.match(bridge, /sectionColor/);
assert.match(bridge, /firstLineBottom < bottom/);
assert.match(bridge, /highlight\.kind === "section"/);

console.log("Document options menu, presets, reset controls, and separated highlight categories passed.");
