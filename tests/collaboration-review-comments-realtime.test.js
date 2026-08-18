const assert = require("node:assert/strict");
const fs = require("node:fs");

const bridge = fs.readFileSync("page-bridge.js", "utf8");
const comments = fs.readFileSync("comments.js", "utf8");
const review = fs.readFileSync("review.js", "utf8");
const css = fs.readFileSync("content.css", "utf8");

// Several independent live updates can share one cursor-position packet. This
// prevents a comment mutation from overwriting a simultaneous review update.
assert.match(bridge, /const pendingCollaborationSignals = new Map\(\)/);
assert.match(bridge, /payload\.smarttexSignals = signals/);
assert.match(bridge, /payload\.smarttexSignal = signals\[0\]/);
assert.match(bridge, /payload\.smarttexSelection\.smarttexSignal = signals\[0\]/);
assert.match(bridge, /const cursorData = raw\.cursorData/);
assert.match(bridge, /Array\.isArray\(raw\.smarttexSignals \|\| cursorData\.smarttexSignals\)/);
assert.match(bridge, /payload: signal\.payload/);

// Comments and review state render from the realtime snapshot immediately;
// their hidden project files remain the durable merge/fallback path.
assert.match(comments, /kind: "comments-live"/);
assert.match(comments, /function realtimeDataForRecords\(\.\.\.records\)/);
assert.match(comments, /detail\.kind === "comments-live"[\s\S]*mergeData\(data, remote\)/);
assert.match(comments, /function nextMutationStamp\(\.\.\.records\)/);
assert.match(comments, /const stamp = nextMutationStamp\(comment, thread, aliveComments\)/);
assert.match(comments, /permanentlyDeleted: Boolean\(value\.permanentlyDeleted\)/);
assert.match(comments, /if \(left\.permanentlyDeleted \|\| right\.permanentlyDeleted\)/);
assert.match(comments, /comment\.permanentlyDeleted = true/);
assert.match(comments, /const deletingRootComment = aliveComments\[0\]\?\.id === comment\.id/);
assert.match(comments, /if \(deletingRootComment \|\| !Object\.values\(thread\.comments\)\.some\(alive\)\)/);
assert.match(comments, /!record\.permanentlyDeleted/);
assert.match(comments, /if \(!alive\(comment\) \|\| !matches\(comment, "authorColor"\)\) continue/);
assert.match(review, /kind: "review-live"/);
assert.match(review, /detail\.kind === "review-live"[\s\S]*mergeReviewStates\(reviewState, remote\)/);

// Only complete sentences may be promoted from delete+insert to Move.
assert.match(review, /function moveSized\(text\)[\s\S]*\[\.!\?\]/);
assert.match(review, /!splice\.added \|\| splice\.removed \|\| !moveSized\(splice\.added\)/);
assert.match(review, /change\.type === "delete" && change\.retained && moveSized\(change\.originalText\)/);
const moveSizedStart = review.indexOf("  function moveSized(text)");
const moveSizedEnd = review.indexOf("\n  function trackedSpliceType", moveSizedStart);
const moveSized = Function(`return (${review.slice(moveSizedStart, moveSizedEnd).trim()})`)();
assert.equal(moveSized("This is a complete sentence."), true);
assert.equal(moveSized("First sentence. Second sentence!"), true);
assert.equal(moveSized("a moved fragment"), false);
assert.equal(moveSized("\\begin{align}\na=b\n\\end{align}"), false);

// Stable author ids drive live name/color rewrites and edit ownership.
assert.match(review, /authorId: String\(value\.authorId \|\| ""\)/);
assert.match(review, /function applyReviewAuthorProfile\(/);
assert.match(comments, /function applyCommentsAuthorProfile\(/);
assert.match(comments, /function ownsComment\(comment\)/);
assert.match(comments, /!alive\(thread\) \|\| !alive\(comment\) \|\| !ownsComment\(comment\)/);

// Change cards use their author's color, and comment threads support durable
// resolve/reopen state plus a local show-resolved filter.
assert.match(comments, /--smarttex-change-author-color/);
assert.match(css, /border-left-color: var\(--smarttex-change-author-color/);
assert.match(comments, /function toggleThreadResolved\(threadId\)/);
assert.match(comments, /resolvedUpdatedAt/);
assert.match(comments, /smarttex-comments-show-resolved/);
assert.match(css, /smarttex-comment-thread-resolved/);

console.log("realtime review/comments collaboration checks passed");
