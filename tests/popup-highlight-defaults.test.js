/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const content = read("content.js");
const options = read("options.js");
const optionsHtml = read("options.html");
const menu = read("settings-menu.js");

// Cursor-triggered reference/citation popups are the built-in/reset default.
assert.match(options, /DEFAULT_POPUPS = Object\.freeze\(\{ trigger: "cursor", environmentTrigger: "cursor" \}\)/);
assert.match(menu, /referencePopupTrigger:\s*"cursor"/);
assert.match(menu, /environmentPopupTrigger:\s*"cursor"/);
assert.match(content, /let referencePopupTrigger = "cursor";\s*let environmentPopupTrigger = "cursor";/);
assert.doesNotMatch(content, /\.catch\(\(\) => \{\s*referencePopupTrigger = "hover";/);
assert.match(optionsHtml, /<select id="smarttex-reference-popup-trigger">\s*<option value="cursor">/);

console.log("Reference popup cursor-default regression tests passed.");
