"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const citation = fs.readFileSync(path.join(root, "citation-autocomplete.js"), "utf8");
const reference = fs.readFileSync(path.join(root, "reference-autocomplete.js"), "utf8");
const figure = fs.readFileSync(path.join(root, "figure-autocomplete.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

assert.doesNotMatch(reference, /Rendering equation…/);
assert.match(reference, /inlineLoadingSpinner\("Rendering equation"\)/);
assert.match(reference, /const EQUATION_VIEW_MODE_KEY = "smarttex:equation-reference-list-view:v1"/);
assert.match(reference, /let viewMode = "grid"/);
assert.match(reference, /\[EQUATION_VIEW_MODE_KEY\]: viewMode/);

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
  /\.smarttex-citation-item:hover:not\(\.smarttex-citation-exact\),[\s\S]*\.smarttex-citation-item\.smarttex-citation-selected:not\(\.smarttex-citation-exact\)\s*\{\s*background:\s*#eceff3\s*!important/,
  "Citation hover and keyboard selection must use light gray."
);
assert.match(
  css,
  /\.smarttex-reference-autocomplete-item:hover:not\(\.smarttex-reference-autocomplete-exact\),[\s\S]*\.smarttex-reference-autocomplete-item\.smarttex-reference-autocomplete-selected:not\(\.smarttex-reference-autocomplete-exact\)\s*\{\s*background:\s*#eceff3\s*!important/,
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

assert.match(
  figure,
  /smarttex-figure-autocomplete-exact[\s\S]*isExactCurrentPath\(record\.path\)/,
  "Figure autocomplete must mark a literal exact filename match independently of keyboard selection."
);
assert.match(
  css,
  /\.smarttex-figure-autocomplete-item\.smarttex-figure-autocomplete-exact\s*\{[\s\S]*background:\s*#e1f0ff/,
  "An exact includegraphics filename must use the light-blue exact-match highlight."
);
assert.match(
  css,
  /\.smarttex-figure-autocomplete-item:hover:not\(\.smarttex-figure-autocomplete-exact\),[\s\S]*\.smarttex-figure-autocomplete-item\.smarttex-figure-autocomplete-selected:not\(\.smarttex-figure-autocomplete-exact\)\s*\{\s*background:\s*#eceff3\s*!important/,
  "Non-exact figure hover/keyboard selection must remain neutral gray."
);

assert.match(
  figure,
  /String\(path \|\| ""\)\.trim\(\) === currentPath/,
  "Figure exact highlighting must require literal complete path text equality."
);

console.log("Exact-match and neutral-selection list styling regression test passed.");
