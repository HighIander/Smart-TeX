const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const comments = fs.readFileSync(path.join(root, 'comments.js'), 'utf8');
const review = fs.readFileSync(path.join(root, 'review.js'), 'utf8');

// Disabling tracking is decided by the authoritative review engine, not a
// potentially stale pane render. Only real/effective pending changes request
// the confirmation flow; an empty state stops immediately.
assert.match(comments, /dispatchReviewControl\("request-stop"\)/);
assert.match(review, /detail\.action === "request-stop"\) requestStopTracking\(\)/);
assert.match(review, /function requestStopTracking\(\)[\s\S]*pruneIneffectiveChanges\(\)[\s\S]*reviewState\.changes\.some\(isEffectiveChange\)[\s\S]*REVIEW_STOP_CONFIRM_EVENT[\s\S]*stopTrackingWithoutChanges\(\)/);
assert.match(review, /function stopTrackingWithoutChanges\(\)[\s\S]*pruneIneffectiveChanges\(\)[\s\S]*if \(reviewState\.changes\.some\(isEffectiveChange\)\) return;[\s\S]*clearAllReviewReferencesAndChanges\(\)/);

// Change action buttons must run on pointerdown so editor blur/rerender cannot eat the first click.
assert.match(comments, /bindImmediateButtonAction\(card\.querySelector\("\.smarttex-track-change-accept"\)[\s\S]*dispatchReviewControl\("accept", \{ id: change\.id \}\)/);
assert.match(comments, /bindImmediateButtonAction\(card\.querySelector\("\.smarttex-track-change-reject"\)[\s\S]*dispatchReviewControl\("reject", \{ id: change\.id \}\)/);

console.log('track changes stop/first-click regression checks passed');
