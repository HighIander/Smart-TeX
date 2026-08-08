"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const figure = fs.readFileSync(path.join(root, "figure-autocomplete.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

assert.match(
  figure,
  /setAutocompleteContextActive\(Boolean\(nextContext\)\)/,
  "Native autocomplete ownership must follow includegraphics context, not popup visibility."
);
assert.doesNotMatch(
  figure,
  /function hidePopup[\s\S]{0,500}setBridgeActive\(false\)/,
  "Temporarily hiding the SmartTeX popup must not release native-autocomplete suppression."
);
assert.match(
  figure,
  /smarttex-figure-autocomplete-context-active/,
  "Figure autocomplete must apply immediate DOM-level native-completer suppression."
);
assert.match(
  css,
  /body\.smarttex-figure-autocomplete-context-active \.ace_autocomplete_popup[\s\S]*display:\s*none !important/,
  "The CollabTeX/Ace filename popup must be hidden for the whole includegraphics context."
);

console.log("Includegraphics autocomplete ownership regression checks passed.");
