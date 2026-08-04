"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const projectFiles = fs.readFileSync(path.join(root, "project-files.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");

assert.match(
  projectFiles,
  /smartTeXMenuButton\.nextElementSibling !== button[\s\S]*toolbar\.insertBefore\(button, desiredNextSibling\)/,
  "Nextcloud action must be inserted immediately after the SmartTeX menu button."
);
assert.match(
  content,
  /optionsButtonSlot\.firstElementChild !== optionsButton[\s\S]*optionsButtonSlot\.insertBefore\(optionsButton, optionsButtonSlot\.firstChild\)/,
  "SmartTeX menu button must remain the first item in its toolbar slot."
);

console.log("Nextcloud toolbar-order regression test passed.");
