"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const citation = fs.readFileSync(path.join(root, "citation-autocomplete.js"), "utf8");
const reference = fs.readFileSync(path.join(root, "reference-autocomplete.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

assert.match(
  citation,
  /smarttex-citation-exact[\s\S]*record\.key === exactKey/,
  "Citation autocomplete must mark an exact citation-key match independently of selection."
);
assert.match(
  reference,
  /smarttex-reference-autocomplete-exact[\s\S]*entry\.record\.label === currentContext\.currentLabel/,
  "Reference autocomplete must mark an exact label match independently of selection."
);
assert.match(
  css,
  /\.smarttex-citation-item\.smarttex-citation-exact\s*\{[\s\S]*box-shadow:\s*inset 3px 0 #1674d1/,
  "Exact citation matches must retain a blue marker."
);
assert.match(
  css,
  /\.smarttex-citation-item:hover,[\s\S]*\.smarttex-citation-item\.smarttex-citation-selected\s*\{\s*background:\s*#eceff3/,
  "Citation hover and keyboard selection must use light gray."
);
assert.match(
  css,
  /\.smarttex-reference-autocomplete-item:hover,[\s\S]*\.smarttex-reference-autocomplete-item\.smarttex-reference-autocomplete-selected\s*\{\s*background:\s*#eceff3/,
  "Reference hover and keyboard selection must use light gray."
);

assert.match(
  css,
  /\.smarttex-citation-item\.smarttex-citation-exact:hover,[\s\S]*\.smarttex-citation-item\.smarttex-citation-exact\.smarttex-citation-selected\s*\{\s*background:\s*#e1f0ff/,
  "Exact citation matches must remain fully blue while hovered or selected."
);
assert.match(
  css,
  /\.smarttex-reference-autocomplete-item\.smarttex-reference-autocomplete-exact:hover,[\s\S]*\.smarttex-reference-autocomplete-item\.smarttex-reference-autocomplete-exact\.smarttex-reference-autocomplete-selected\s*\{\s*background:\s*#e1f0ff/,
  "Exact reference matches must remain fully blue while hovered or selected."
);

console.log("Exact-match and neutral-selection list styling regression test passed.");
