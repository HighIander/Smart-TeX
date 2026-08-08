const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const comments = fs.readFileSync(path.join(root, 'comments.js'), 'utf8');
const review = fs.readFileSync(path.join(root, 'review.js'), 'utf8');

// Opening the pane while the authoritative runtime reports tracking off must
// override a previously expanded persisted Track Changes section.
assert.match(
  comments,
  /const runtimeReviewState = globalThis\.__smartTeXReviewState;[\s\S]*paneAwaitingInitialReviewState = !\([\s\S]*!runtimeReviewState\.tracking[\s\S]*trackSectionCollapsed = true;[\s\S]*applyReviewSectionLayout\(\);/
);

// If the pane opens before review.js has published its initial state, only that
// first late state may make the open-time collapse decision. A later transition
// to tracking-off must preserve the user's current section layout.
assert.match(comments, /let paneAwaitingInitialReviewState = false;/);
assert.match(
  comments,
  /if \(paneOpen && paneAwaitingInitialReviewState\) \{[\s\S]*paneAwaitingInitialReviewState = false;[\s\S]*!reviewUiState\.tracking[\s\S]*trackSectionCollapsed = true;/
);
assert.doesNotMatch(
  comments,
  /if \(paneOpen && !reviewUiState\.tracking && !trackSectionCollapsed\)/
);

// The move target is one continuous marker spanning from the first visible
// moved line to the last rather than one disconnected bar per visual line.
assert.match(review, /const moveTargetBounds = targetLineRects\.reduce/);
assert.match(review, /top: Math\.min\(bounds\.top, to\.top\)/);
assert.match(review, /bottom: Math\.max\(bounds\.bottom, to\.bottom\)/);
assert.match(review, /const gutterX = Number\(response\.gutterX\)/);
assert.match(review, /left: markerLeft[\s\S]*right: markerLeft \+ 4[\s\S]*moveTargetBounds\.top[\s\S]*moveTargetBounds\.bottom[\s\S]*smarttex-review-move-target/);
assert.doesNotMatch(review, /for \(const to of targetLineRects\) \{\s*addRect\(markupLayer, \{ \.\.\.to, left: to\.left - 6/);

console.log('track changes pane collapse and move target height checks passed');
