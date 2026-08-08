const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const review = fs.readFileSync(path.join(root, 'review.js'), 'utf8');

// A retained delete is promoted to move when matching text is inserted elsewhere.
// The delayed project sync must never downgrade that same id back to delete.
assert.match(review, /previous\.type === "move" && item\.type === "delete"/);
assert.match(review, /previous\.type === "delete" && item\.type === "move"/);
assert.match(review, /Never[\s\S]*stale deletion downgrade a move/);

// If project merge changes visible review state, repaint immediately so source
// and destination markup stay consistent after synchronization.
assert.match(review, /mergeChangedVisibleState/);
assert.match(review, /if \(mergeChangedVisibleState\) \{[\s\S]*renderPane\(\);[\s\S]*scheduleOverlayRender\(\)/);

console.log('move sync stability regression checks passed');
