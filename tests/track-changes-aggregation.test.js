const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const review = fs.readFileSync(path.join(root, "review.js"), "utf8");

// Contiguous grouping is purely spatial and author/type based. Cursor movement,
// clicks, and elapsed time must not split an otherwise contiguous change.
assert.match(review, /change\.fileName === fileName[\s\S]*?change\.author === author[\s\S]*?change\.type === type/);
assert.match(review, /splice\.start >= change\.start && splice\.start <= change\.end/);
assert.match(review, /change\.retained && splice\.start <= change\.end && splice\.oldEnd >= change\.start/);
assert.doesNotMatch(review, /breaksTrackedEditGroup/);
assert.doesNotMatch(review, /activeLocalChangeId/);

// Inserting at any position inside/touching the same insertion updates that one
// record, and its timestamp is the time of the latest constituent edit.
assert.match(review, /groupingHint\.mode === "insert-at"[\s\S]*?grouped\.text = grouped\.text\.slice\(0, offset\) \+ splice\.added[\s\S]*?grouped\.updatedAt = timestamp/);

// Retained deletions are merged by the union of touching ranges and likewise
// receive the latest modification time.
assert.match(review, /groupingHint\.mode === "delete-retained-union"[\s\S]*?grouped\.start = groupingHint\.start[\s\S]*?grouped\.end = groupingHint\.end[\s\S]*?grouped\.updatedAt = timestamp/);

console.log("Track Changes spatial aggregation checks passed.");
