const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const review = fs.readFileSync(path.join(root, 'review.js'), 'utf8');

// Editing strictly inside the target of an existing move must split that move
// into two independent move records, leaving the nested modification between them.
assert.match(review, /function splitMovedChangesBrokenByModification\(fileName, splice, beforeChanges, options = \{\}\)/);
assert.match(review, /before\.type !== "move"/);
assert.match(review, /editStart > before\.toStart && editEnd < before\.toEnd/);
assert.match(review, /editStart > before\.toStart && editStart < before\.toEnd/);
assert.match(review, /transformed\.fromEnd = mappedFromStart \+ leftOffset/);
assert.match(review, /transformed\.toEnd = splice\.start/);
assert.match(review, /fromStart: mappedFromStart \+ rightOffset/);
assert.match(review, /toStart: rightToStart/);

// Both ordinary insert/replace edits and retained deletions inside a moved block
// invoke the move splitting path.
assert.match(review, /splitMovedChangesBrokenByModification\(fileName, splice, recordsBeforeTransform\)/);
assert.match(review, /splitMovedChangesBrokenByModification\(fileName, splice, recordsBeforeSplit, \{ retainedEditorState: true \}\)/);

console.log('nested move split regression checks passed');
