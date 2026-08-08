const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const comments = fs.readFileSync(path.join(root, "comments.js"), "utf8");
const review = fs.readFileSync(path.join(root, "review.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const toolbar = fs.readFileSync(path.join(root, "editor-toolbar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

assert.match(comments, /const SYNC_INTERVAL_MS = 20000;/);
assert.match(comments, /const FULL_SYNC_FALLBACK_MS = 120000;/);
assert.match(comments, /smarttex-comments-track-row/);
assert.match(comments, /<option value="final">show final<\/option>/);
assert.match(comments, /<option value="markup" selected>show markup<\/option>/);
assert.match(comments, /<option value="original">show original<\/option>/);
assert.match(comments, /smarttex:comments-add-range/);
assert.match(review, /const PROJECT_POLL_MS = 20000;/);
assert.match(review, /snapshotCurrentDocumentAsBaseline/);
assert.match(review, /sharedTracking\.enabled = enable/);
assert.match(review, /data-change-popup-action="accept"/);
assert.match(review, /data-change-popup-action="reject"/);
assert.match(review, /data-change-popup-action="info"/);
assert.match(review, /data-change-popup-action="comment"/);
assert.match(review, /updateCursorChange/);
assert.match(review, /smarttex:comments-add-range/);
assert.match(bridge, /request\.type === "getRangeRects"/);
assert.match(bridge, /request\.type === "getEditorBounds"/);
assert.match(toolbar, /smarttex-review-tracking-active/);
assert.match(background, /"review\.js"/);
assert.match(css, /smarttex-review-active-move/);
assert.match(css, /smarttex-review-deleted-text/);
assert.match(css, /smarttex-review-addition-line/);

console.log("Integrated Track Changes checks passed.");
