const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

assert.match(content, /includeGraphicsArgumentAtCursor/);
assert.match(content, /selectedNativeGraphicEntry/);
assert.match(content, /hoveredNativeGraphicEntry/);
assert.match(content, /graphicAutocompleteHoveredEntry/);
assert.match(content, /graphicAutocompleteActive = true;[\s\S]*hidePreview\(\)/);
assert.match(content, /SmartTeXFigureRenderer[\s\S]*createMedia/);
assert.match(css, /#smarttex-graphic-autocomplete-preview/);
assert.match(css, /smarttex-graphic-autocomplete-image[\s\S]*object-fit:\s*contain/);
console.log("includegraphics autocomplete preview regression test passed");
