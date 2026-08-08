const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const review = fs.readFileSync(path.join(root, "review.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

// Undo/redo must restore the editor value together with the review metadata,
// rather than feeding the native undo result back through normal change tracking.
assert.match(review, /const trackedHistoryByFile = new Map\(\)/);
assert.match(review, /function performTrackedHistory\(direction\)/);
assert.match(review, /event\.inputType === "historyUndo"/);
assert.match(review, /event\.inputType === "historyRedo"/);
assert.match(review, /restoreTrackedSnapshot\(currentFile, snapshot\)/);
assert.match(review, /suppressedMode = "history"/);

// A pending deletion is restored into the physical editor content and represented
// as metadata over a real range. This preserves cursor navigation and paragraphs.
assert.match(review, /function restoreRetainedDeletion\(previousValue, nextValue, splice\)/);
assert.match(review, /text: splice\.removed/);
assert.match(review, /retained: type === "delete" && retainedDeletion/);
assert.match(review, /change\.retained && change\.end > change\.start/);
assert.match(review, /smarttex-review-deletion-line/);
assert.match(css, /\.smarttex-review-deletion-line/);
assert.match(css, /#dc2626/);

// Rejecting a retained deletion removes metadata only; accepting it removes the
// actual retained range from the editor.
assert.match(review, /change\.type === "delete" && change\.retained[\s\S]*?start: change\.start[\s\S]*?end: change\.end[\s\S]*?text: ""/);
assert.match(review, /The pending deletion is still physically present in the editor/);

console.log("Track Changes undo/redo and retained-deletion checks passed.");
