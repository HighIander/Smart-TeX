const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const review = fs.readFileSync(path.join(root, "review.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");

// The bridge exposes the editor line height together with range rectangles so
// multiline move-source strike-through markup can be repeated per visual line.
assert.match(bridge, /const lineHeight = Math\.max\(2, Number\(anchor\?\.lineHeight\) \|\| 16\)/);
assert.match(bridge, /\{ rects, lineHeight, gutterX \}/);
assert.match(bridge, /function editorGutterBoundaryX\(\)/);
assert.match(review, /function lineRectsForStrike\(rects, lineHeightValue\)/);
assert.match(review, /for \(const rect of lineRectsForStrike\(fromRects, fromResponse\.lineHeight\)\)/);

// Pasting a moved block exactly at the edge of an existing insertion must not
// make that blue insertion range absorb the moved text. The insertion remains
// wholly before/after the green moved block according to its original side.
assert.match(review, /function keepAdjacentInsertionsOutsideMove\(/);
assert.match(review, /if \(before\.start === splice\.start\) \{[\s\S]*transformed\.start = before\.start \+ addedLength;[\s\S]*transformed\.end = before\.end \+ addedLength;/);
assert.match(review, /else if \(before\.end === splice\.start\) \{[\s\S]*transformed\.start = before\.start;[\s\S]*transformed\.end = before\.end;/);
assert.match(review, /moveCandidate\?\.id \|\| null/);

console.log("move rendering and adjacent-boundary regression checks passed");
