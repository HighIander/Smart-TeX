"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const reference = fs.readFileSync(path.join(root, "reference-autocomplete.js"), "utf8");
const citation = fs.readFileSync(path.join(root, "citation-autocomplete.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

assert.match(reference, /Math\.min\(430,[\s\S]*availableSideSpace/);
assert.match(citation, /Math\.min\(460,[\s\S]*availableSideSpace/);
assert.match(css, /\.smarttex-reference-autocomplete-list\s*\{[\s\S]*overflow:\s*auto[\s\S]*scrollbar-gutter:\s*stable/);
assert.match(css, /\.smarttex-citation-list\s*\{[\s\S]*overflow:\s*auto[\s\S]*scrollbar-gutter:\s*stable/);

console.log("reference list scrolling regression test passed");
