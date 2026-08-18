"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const autocomplete = fs.readFileSync(path.join(root, "figure-autocomplete.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");

assert.match(
  autocomplete,
  /const argumentEnd = closeIndex >= 0 \? closeIndex : cursor;[\s\S]*state\.value\.slice\(openIndex \+ 1, argumentEnd\)[\s\S]*currentPath: fullArgument/,
  "Figure exact-match state must use the whole includegraphics argument independently of caret position."
);
assert.match(
  autocomplete,
  /function isExactCurrentPath\(path\)[\s\S]*String\(path \|\| ""\)\.trim\(\) === currentPath/,
  "Figure exact matching must compare literal complete paths instead of accepting normalized partial equivalents."
);
assert.match(
  content,
  /function fitGraphicAutocompletePreviewToMedia\(media\)[\s\S]*mediaHeight = mediaWidth \/ aspect[\s\S]*graphicAutocompleteOutput\.style\.height/,
  "Figure autocomplete preview must size its media box from the resolved figure aspect ratio."
);
assert.match(
  content,
  /await resolvedMedia\.decode\?\.\(\)[\s\S]*fitGraphicAutocompletePreviewToMedia\(resolvedMedia\)/,
  "Preview sizing must run after intrinsic image dimensions are available."
);

console.log("includegraphics caret-independent exact highlight and aspect-fit preview checks passed.");
