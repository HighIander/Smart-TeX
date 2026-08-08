const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const comments = fs.readFileSync(path.join(root, "comments.js"), "utf8");
const toolbar = fs.readFileSync(path.join(root, "editor-toolbar.js"), "utf8");
const review = fs.readFileSync(path.join(root, "review.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

// The dormant review implementation is now loaded on actual document pages.
assert.match(background, /"comments\.js",\s*"review\.js"/);
assert.match(review, /SmartTeXPageContext\?\.isDocumentPage/);

// Track Changes is integrated above the existing Comments header.
assert.match(comments, /smarttex-comments-track-row/);
assert.match(comments, /smarttex-comments-track-toggle/);
assert.match(comments, /<option value="final">show final<\/option>/);
assert.match(comments, /<option value="markup" selected>show markup<\/option>/);
assert.match(comments, /<option value="original">show original<\/option>/);

// Tracking on/off is collaborative, while the display mode persists locally.
assert.match(review, /sharedTracking\.enabled = enable/);
assert.match(review, /snapshotCurrentDocumentAsBaseline/);
assert.match(review, /scheduleLocalSave\(0\)/);
assert.match(review, /PROJECT_POLL_MS = 20000/);
assert.match(review, /PROJECT_FULL_SYNC_FALLBACK_MS = 120000/);
assert.match(review, /probeProjectMetadataFile/);
assert.match(review, /readProjectMetadataFile/);
assert.match(review, /writeProjectMetadataFile/);

// Editor markup and cursor-linked actions cover additions, deletions and moves.
assert.match(review, /function trackedSpliceType\(splice\)/);
assert.match(review, /candidate\.type = "move"/);
assert.match(review, /smarttex-review-addition-line/);
assert.match(review, /smarttex-review-deleted-text/);
assert.match(review, /smarttex-review-deletion-line/);
assert.match(review, /retainedDeletion/);
assert.match(review, /smarttex-review-move-target/);
assert.match(review, /function updateCursorChange\(/);
assert.match(review, /data-change-popup-action="accept"/);
assert.match(review, /data-change-popup-action="reject"/);
assert.match(review, /data-change-popup-action="info"/);
assert.match(review, /data-change-popup-action="comment"/);

// Accept updates the reference; reject edits the source back; comments use the normal Comments system.
assert.match(review, /updateAcceptedBaseline\(change\.fileName/);
assert.match(review, /sourceAfterReject/);
assert.match(review, /smarttex:comments-add-range/);
assert.match(comments, /window\.addEventListener\(ADD_RANGE_COMMENT_EVENT/);

// Bridge geometry is available to the review overlay.
assert.match(bridge, /request\.type === "getRangeRects"/);
assert.match(bridge, /request\.type === "getEditorBounds"/);

// Toolbar tracking indicator and editor styling are present.
assert.match(toolbar, /smarttex-review-tracking-active/);
assert.match(css, /smarttex-review-tracking-active::before/);
assert.match(css, /smarttex-review-active-add/);
assert.match(css, /smarttex-review-active-delete/);
assert.match(css, /smarttex-review-active-move/);

console.log("SmartTeX integrated review/change-tracking checks passed.");
