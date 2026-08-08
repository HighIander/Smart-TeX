const fs = require("fs");
const assert = require("assert");

const bridge = fs.readFileSync("page-bridge.js", "utf8");
const review = fs.readFileSync("review.js", "utf8");

// Zero-width review anchors outside the editor viewport must be hidden rather
// than clamped to an editor edge.
assert.match(bridge, /rawBottom <= bounds\.top \|\| rawTop >= bounds\.bottom/);
assert.match(bridge, /rawRight <= bounds\.left \|\| rawLeft >= bounds\.right/);
assert.match(bridge, /return \[\];/);

// A single change-card click must verify that the editor actually revealed the
// range and automatically retry the selection reveal when it did not.
assert.match(review, /await bridgeRequest\("setSelection", selection, 3000\)/);
assert.match(review, /bridgeRequest\("getRangeRects", \{ start: anchor, end: head \}, 2500\)/);
assert.match(review, /visible\.rects\.length === 0/);
assert.match(review, /async function jumpToChange\(change, location = ""\)/);

console.log("track-changes navigation/visibility regression tests passed");
