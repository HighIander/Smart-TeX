const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const review = fs.readFileSync(path.join(root, "review.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");

// A project sync must merge the asynchronously read remote metadata into the
// latest local state. Capturing serializableReviewState() before the await can
// overwrite a change created while the remote read is in flight.
assert.match(review, /remote = await readRemoteReviewState\(\)[\s\S]*const merged = mergeReviewStates\(reviewState, remote\)/);
assert.doesNotMatch(review, /let merged = serializableReviewState\(\)[\s\S]*await readRemoteReviewState\(\)[\s\S]*mergeReviewStates\(merged, remote\)/);

// Edits made while the metadata write is pending must force another sync pass.
assert.match(review, /if \(projectSyncInProgress\) \{[\s\S]*projectSyncPending = true;[\s\S]*return;/);
assert.match(review, /finally \{[\s\S]*projectSyncInProgress = false;[\s\S]*if \(projectSyncPending\)[\s\S]*scheduleProjectSave\(0\)/);

// The move target x position comes from the actual editor gutter boundary, not
// from coalesced multiline range rectangles whose left edge may be the viewport.
assert.match(bridge, /function editorGutterBoundaryX\(\)/);
assert.match(bridge, /\.cm-gutters/);
assert.match(bridge, /\.ace_gutter/);
assert.match(bridge, /\{ rects, lineHeight, gutterX \}/);
assert.match(review, /const gutterX = Number\(response\.gutterX\)/);

console.log("concurrent review sync and gutter marker regression checks passed");
