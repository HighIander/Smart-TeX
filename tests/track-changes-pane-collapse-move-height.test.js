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
  /const runtimeReviewState = globalThis\.__smartTeXReviewState;[\s\S]*!runtimeReviewState\.tracking[\s\S]*trackSectionCollapsed = true;[\s\S]*applyReviewSectionLayout\(\);/
);

// Because review.js initializes after comments.js, a late "tracking off" state
// must also collapse an already-open Track Changes section.
assert.match(
  comments,
  /if \(paneOpen && !reviewUiState\.tracking && !trackSectionCollapsed\) \{[\s\S]*trackSectionCollapsed = true;[\s\S]*applyReviewSectionLayout\(\);/
);

// The move target is one continuous marker spanning from the first visible
// moved line to the last rather than one disconnected bar per visual line.
assert.match(review, /const moveTargetBounds = targetLineRects\.reduce/);
assert.match(review, /top: Math\.min\(bounds\.top, to\.top\)/);
assert.match(review, /bottom: Math\.max\(bounds\.bottom, to\.bottom\)/);
assert.match(review, /moveTargetBounds\.left - 6[\s\S]*moveTargetBounds\.top[\s\S]*moveTargetBounds\.bottom[\s\S]*smarttex-review-move-target/);
assert.doesNotMatch(review, /for \(const to of targetLineRects\) \{\s*addRect\(markupLayer, \{ \.\.\.to, left: to\.left - 6/);

console.log('track changes pane collapse and move target height checks passed');
