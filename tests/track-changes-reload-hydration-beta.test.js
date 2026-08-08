const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const review = fs.readFileSync(path.join(root, 'review.js'), 'utf8');
const comments = fs.readFileSync(path.join(root, 'comments.js'), 'utf8');

// Reload must not use an early empty/partial CollabTeX editor buffer as the
// previous document value. Bootstrap states are queued until metadata and a
// final live editor state have both been obtained.
assert.match(review, /let initialEditorHydrationPending = true;/);
assert.match(review, /if \(initialEditorHydrationPending && !applyingTrackedHistory\) \{[\s\S]*latestInitialEditorState = next;[\s\S]*return;/);
assert.match(review, /const remote = await readRemoteReviewState\(\);[\s\S]*bridgeRequest\("getState", \{\}, 5000\)[\s\S]*initialEditorHydrationPending = false;[\s\S]*seedInitialEditorState\(settledState\)/);

// Previously generated whole-document phantom insertions are recognized and
// removed, with ranges shifted back before normal rendering/navigation.
assert.match(review, /function repairInitialWholeDocumentInsertArtifact/);
assert.match(review, /change\.type === "insert"[\s\S]*change\.start === 0[\s\S]*comparableMoveText\(change\.text\) === comparableMoveText\(value\)/);
assert.match(review, /repairHydratedChangeRanges\(fileName, nextValue\)/);

// The integrated pane explicitly labels Track Changes as beta.
assert.match(comments, /<strong>track changes \(beta\)<\/strong>/);

console.log('track changes reload hydration and beta label checks passed');
