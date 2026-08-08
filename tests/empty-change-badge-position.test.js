const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const comments = fs.readFileSync(path.join(root, "comments.js"), "utf8");
const review = fs.readFileSync(path.join(root, "review.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");

assert(comments.includes('return lineBreaks === 1 ? "↵ line break" : `↵ ${lineBreaks} line breaks`;'),
  "Whitespace-only line changes must be described explicitly instead of as empty changes.");
assert(comments.includes('reviewUiState.changes.filter(isDisplayableReviewChange)'),
  "The Track Changes pane must defensively hide stale zero-length change records.");
assert(!comments.includes('(empty change)'),
  "The integrated Track Changes pane must not expose the misleading empty-change label.");
assert(!review.includes('(empty change)'),
  "The legacy review renderer must not expose the misleading empty-change label either.");
assert(bridge.includes('"right:16px"'),
  "Source-number badges should be shifted slightly left from the editor edge.");
assert(bridge.includes('top - bounds.top - 1'),
  "Source-number badges should be shifted slightly upward for row alignment.");

console.log("Empty-change labeling and source-badge positioning checks passed.");
