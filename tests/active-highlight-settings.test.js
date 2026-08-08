/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const optionsHtml = fs.readFileSync(path.join(root, "options.html"), "utf8");
const optionsJs = fs.readFileSync(path.join(root, "options.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");

assert.match(optionsHtml, /smarttex-highlight-active-enabled/);
assert.match(optionsHtml, /smarttex-highlight-active-strength/);
assert.match(optionsHtml, /still shown in gray/);
assert.match(optionsJs, /activeEnabled:\s*true/);
assert.match(optionsJs, /activeStrength:\s*55/);
assert.match(optionsJs, /control\.type === "range"/);
assert.match(content, /activeStrength:\s*Math\.max/);
assert.match(bridge, /cursorIndex >= Number\(highlight\.start/);
assert.match(bridge, /: "#8b949e"/);
assert.match(bridge, /activeAlpha\(0\.18, 0\.52/);
assert.match(bridge, /activeEnabled:\s*detail\.activeEnabled/);
console.log("Active field/environment highlight settings checks passed.");
