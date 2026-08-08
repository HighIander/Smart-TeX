const fs = require('node:fs');
const assert = require('node:assert');

const comments = fs.readFileSync('comments.js', 'utf8');
const review = fs.readFileSync('review.js', 'utf8');
const css = fs.readFileSync('content.css', 'utf8');

assert.match(comments, /Review &amp; comments/);
assert.match(comments, /smarttex-track-section/);
assert.match(comments, /smarttex-comments-section/);
assert.match(comments, /smarttex-review-horizontal-splitter/);
assert.match(comments, /reviewSplitRatio = 0\.5/);
assert.match(comments, /trackSectionCollapsed/);
assert.match(comments, /commentsSectionCollapsed/);
assert.match(comments, /Accept all changes/);
assert.match(comments, /Reject all changes/);
assert.match(comments, /Do really want to stop tracking changes for all authors\?/);
assert.match(comments, /Do you really want to accept all changes\?/);
assert.match(comments, /Do you really want to reject all changes\?/);
assert.match(comments, /hasTrackedChangesForCurrentDocument/);
assert.match(comments, /dispatchReviewControl\("jump"/);
assert.match(review, /stopTrackingAndAcceptAll/);
assert.match(review, /stopTrackingAndRejectAll/);
assert.match(review, /baselineClearedAt/);
assert.match(review, /changes\n\s*};/);
assert.match(css, /smarttex-review-pane-titlebar/);
assert.match(css, /background: #344454/);
assert.match(css, /background: #d8ecff/);
assert.match(css, /smarttex-track-change-move/);

console.log('Review pane layout and stop-tracking checks passed.');
