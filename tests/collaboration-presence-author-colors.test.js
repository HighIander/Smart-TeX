const assert = require("node:assert/strict");
const fs = require("node:fs");

const bridge = fs.readFileSync("page-bridge.js", "utf8");
const comments = fs.readFileSync("comments.js", "utf8");
const review = fs.readFileSync("review.js", "utf8");
const css = fs.readFileSync("content.css", "utf8");

// Cursor and selection presence ride CollabTeX's existing realtime channel;
// durable review/comment data remains in the mergeable project metadata files.
assert.match(bridge, /clientTracking\.updatePosition/);
assert.match(bridge, /smarttexSelection: \{ anchor, head \}/);
assert.match(bridge, /clientTracking\.clientUpdated/);
assert.match(bridge, /clientTracking\.getConnectedUsers/);
assert.match(review, /smarttex-collaborator-selection/);
assert.match(review, /smarttex-collaborator-cursor/);
assert.match(css, /#smarttex-collaboration-presence-layer/);
assert.match(review, /Always paint the SmartTeX caret and label, including a collapsed range/);
assert.doesNotMatch(review, /const nativeCursorVisible/);

// Presence geometry is clipped to the editor viewport. In particular, an
// off-screen cursor must not pin its collaborator label to the browser edge.
assert.match(bridge, /\{ rects, lineHeight, gutterX, bounds \}/);
assert.match(bridge, /Boolean\(screen && bounds\), \{ screen, bounds \}/);
assert.match(review, /function clipPresenceRect\(rect, bounds\)/);
assert.match(review, /const visibleCursor = clipPresenceRect/);
assert.doesNotMatch(review, /Math\.max\(0, top - 18\)/);

// A successful write broadcasts only an invalidation hint; receivers perform
// the normal merge instead of trusting ephemeral socket data.
assert.match(comments, /detail: JSON\.stringify\(\{[\s\S]*?kind: "comments"/);
assert.match(review, /detail: JSON\.stringify\(\{[\s\S]*?kind: "review"/);
assert.match(bridge, /typeof event\.detail === "string"[\s\S]*JSON\.parse\(event\.detail/);
assert.match(bridge, /smarttexSignal/);
assert.match(comments, /writeResponse\?\.result\?\.fileId/);
assert.match(comments, /readRemote\(options\)/);
assert.match(bridge, /const hintedFileId = likelyFileId\(options\.fileId/);
assert.match(bridge, /fetchMetadataEntityText\(projectId, hintedFileId, hintedEntityType\)/);
assert.match(bridge, /fileId: String\(signal\.fileId/);

// Every tracked-change visual uses the recorded author's color. Moves use a
// tint and side marker, with no underline/strike decoration.
assert.match(review, /--smarttex-review-author-color/);
assert.match(css, /smarttex-review-addition-line[\s\S]*var\(--smarttex-review-author-color/);
assert.match(css, /smarttex-review-deletion-line[\s\S]*var\(--smarttex-review-author-color/);
assert.match(css, /smarttex-review-move-deletion-line[\s\S]*background: var\(--smarttex-review-author-soft/);
assert.doesNotMatch(
  css.match(/\.smarttex-review-move-deletion-line \{[\s\S]*?\n\}/)?.[0] || "",
  /text-decoration|48%/
);
assert.match(css, /smarttex-review-move-destination/);

console.log("collaboration presence and per-author markup checks passed");
