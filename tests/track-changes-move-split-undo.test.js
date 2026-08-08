const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const review = fs.readFileSync(path.join(root, 'review.js'), 'utf8');
const comments = fs.readFileSync(path.join(root, 'comments.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'content.css'), 'utf8');

// Undo/redo first synchronizes against the live editor state, so a Ctrl-Z that
// arrives before the ordinary editor-state event cannot miss the latest edit.
assert.match(review, /async function synchronizeEditorStateBeforeHistory\(\)[\s\S]*bridgeRequest\("getState"/);
assert.match(review, /function queueTrackedHistory\(direction\)[\s\S]*synchronizeEditorStateBeforeHistory\(\)[\s\S]*performTrackedHistory\(direction\)/);
assert.match(review, /historyDirection && trackingEnabled\(\) && currentFile[\s\S]*queueTrackedHistory\(historyDirection\)/);
assert.match(review, /pendingRetainedRestore/);

// A matching deletion/insertion pair is represented by one retained move with
// a real source range and target range.
assert.match(review, /candidate\.type = "move"/);
assert.match(review, /candidate\.fromStart = sourceStart/);
assert.match(review, /candidate\.fromEnd = sourceEnd/);
assert.match(review, /candidate\.toStart = splice\.start/);
assert.match(review, /candidate\.toEnd = splice\.start \+ splice\.added\.length/);
assert.match(review, /change\.type === "move" && change\.retained/);

// Markup is green strike-through at the source and a green target bar.
assert.match(review, /smarttex-review-move-deletion-line/);
assert.match(review, /smarttex-review-move-target/);
assert.match(css, /\.smarttex-review-move-deletion-line[\s\S]*#16a34a/);

// The change list has separate navigation links for move origin and target.
assert.match(comments, /data-change-location="from"/);
assert.match(comments, /data-change-location="to"/);
assert.match(comments, /bindImmediateButtonAction\(link[\s\S]*dispatchReviewControl\("jump", \{ id: change\.id, location: link\.dataset\.changeLocation \}\)/);
assert.match(review, /location === "from"[\s\S]*changeMoveSourceRange\(change\)/);

// An insertion inside a retained deleted block splits that deletion around the
// new modification, rather than leaving one deletion spanning another change.
assert.match(review, /function splitRetainedDeletionsBrokenByInsertion/);
assert.match(review, /splice\.start > before\.start && splice\.start < before\.end/);
assert.match(review, /start: splice\.start \+ addedLength/);
assert.match(review, /splitRetainedDeletionsBrokenByInsertion\(fileName, splice, recordsBeforeTransform\)/);

console.log('track changes move/split/undo regression checks passed');
