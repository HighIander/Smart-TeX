const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const comments = fs.readFileSync("comments.js", "utf8");
const css = fs.readFileSync("content.css", "utf8");
const harness = fs.readFileSync("tests/comments-emoji-reactions-harness.html", "utf8");

// Emoji text is rendered with explicit color-font fallbacks and a single
// grapheme-sized emoji comment receives the enlarged presentation.
assert.match(css, /#smarttex-comments-pane[\s\S]*"Segoe UI Emoji"[\s\S]*"Apple Color Emoji"[\s\S]*"Noto Color Emoji"/);
assert.match(comments, /function isEmojiOnlyText\(/);
assert.match(comments, /smarttex-comment-text-emoji-only/);
assert.match(css, /smarttex-comment-text\.smarttex-comment-text-emoji-only[\s\S]*font-size:\s*3em/);

// Draft, edit, and reply textareas share the same picker trigger and insert at
// the current selection rather than appending blindly.
assert.match(comments, /function emojiInputShell\(textarea\)/);
assert.match(comments, /textarea\.setRangeText\(emoji, start, end, "end"\)/);
assert.match(comments, /row\.append\(heading, emojiInputShell\(textarea\), actions\)/);
assert.match(comments, /wrapper\.append\(emojiInputShell\(textarea\), actions\)/);
assert.match(comments, /card\.append\(heading, emojiInputShell\(textarea\), actions\)/);
assert.match(css, /\.smarttex-comment-emoji-trigger[\s\S]*position:\s*absolute[\s\S]*right:\s*7px[\s\S]*bottom:\s*7px/);

// Reactions are synchronized per emoji and actor. Independent actors are
// merged separately, and inactive records remain as removal tombstones.
assert.match(comments, /reactions:\s*cleanReactions\(value\.reactions\)/);
assert.match(comments, /function mergeReactions\(/);
assert.match(comments, /for \(const actorKey of new Set\(/);
assert.match(comments, /latestReaction\(left\[emoji\]\?\.\[actorKey\], right\[emoji\]\?\.\[actorKey\]\)/);
assert.match(comments, /active:\s*current\?\.active === false \|\| !current/);
assert.match(comments, /markDirty\(250, realtimeDataForRecords\(thread\)\)/);

// Finished comments expose reaction chips, numeric badges, contributor
// tooltips, and switch the add control from a smiley to a plus once populated.
assert.match(comments, /function renderCommentReactions\(/);
assert.match(comments, /smarttex-comment-reaction-count/);
assert.match(comments, /smarttex-comment-reaction-tooltip/);
assert.match(comments, /smarttex-comment-reaction-add-plus/);
assert.match(css, /\.smarttex-comment-reaction-count[\s\S]*position:\s*absolute/);
assert.match(css, /\.smarttex-comment-reaction:hover \.smarttex-comment-reaction-tooltip/);
assert.match(comments, /for \(const reaction of actors\)/);
assert.doesNotMatch(comments, /actors\.slice\(0,\s*12\)/);
assert.match(comments, /classList\.add\("smarttex-comment-reaction-tooltip-visible"\)/);
assert.match(comments, /classList\.remove\("smarttex-comment-reaction-tooltip-visible"\)/);
assert.match(css, /\.smarttex-comment-reaction-tooltip\.smarttex-comment-reaction-tooltip-visible\s*\{[\s\S]*display:\s*block/);
for (const match of harness.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  new vm.Script(match[1], { filename: "comments-emoji-reactions-harness.inline.js" });
}

// Exercise the real normalizer/merge implementation without initializing the
// page UI. Two peers reacting concurrently must survive the merge, and a later
// per-user tombstone must remove only that user's reaction.
const mergeBoundary = comments.indexOf("\n  function alive(record)");
assert.ok(mergeBoundary > 0, "The comments merge boundary must remain discoverable.");
const testSource = `${comments.slice(0, mergeBoundary)}
  globalThis.__reactionTestApi = { cleanComment, mergeData, sameDataRecords, realtimeCorrectionForIncoming };
})();`;
const testWindow = { addEventListener() {}, setTimeout, clearTimeout };
testWindow.top = testWindow;
const context = vm.createContext({
  console,
  window: testWindow,
  location: { pathname: "/project/test", origin: "https://example.test" },
  Intl,
  Date,
  Math,
  Object,
  String,
  Number,
  RegExp,
  Set,
  Map,
  JSON,
  structuredClone,
  CustomEvent: class CustomEvent {},
  SmartTeXPageContext: { isDocumentPage: () => true }
});
vm.runInContext(testSource, context, { filename: "comments-reaction-merge-slice.js" });
const { cleanComment, mergeData, sameDataRecords, realtimeCorrectionForIncoming } = context.__reactionTestApi;
const reaction = (actorKey, authorName, active, updatedAt) => ({
  actorKey,
  authorId: actorKey,
  authorName,
  authorColor: "#268bd2",
  active,
  updatedAt
});
const comment = (reactions) => ({
  id: "comment-1",
  authorName: "Alice",
  authorColor: "#268bd2",
  authorId: "alice",
  text: "Hello",
  reactions,
  createdAt: 100,
  updatedAt: 100
});
const thread = (reactions, updatedAt) => ({
  id: "thread-1",
  fileName: "main.tex",
  start: 0,
  end: 1,
  quote: "x",
  color: "#268bd2",
  createdAt: 100,
  updatedAt,
  comments: { "comment-1": comment(reactions) }
});
const state = (reactions, updatedAt) => ({
  schemaVersion: 2,
  updatedAt,
  threads: { "thread-1": thread(reactions, updatedAt) },
  marks: {}
});
const alice = { "👍": { alice: reaction("alice", "Alice", true, 200) } };
const bob = { "👍": { bob: reaction("bob", "Bob", true, 300) } };
const concurrent = mergeData(state(alice, 200), state(bob, 300));
assert.deepEqual(
  Object.keys(concurrent.threads["thread-1"].comments["comment-1"].reactions["👍"]).sort(),
  ["alice", "bob"]
);
const aliceRemoved = { "👍": { alice: reaction("alice", "Alice", false, 400) } };
const toggled = mergeData(concurrent, state(aliceRemoved, 400));
assert.equal(toggled.threads["thread-1"].comments["comment-1"].reactions["👍"].alice.active, false);
assert.equal(toggled.threads["thread-1"].comments["comment-1"].reactions["👍"].bob.active, true);

// If Bob changes his own reaction from a stale snapshot after Alice has just
// removed hers, the merged record must actively repair Bob's incoming full
// thread snapshot. Otherwise Alice's stale active record can survive remotely.
const bobAfterStaleRead = {
  "👍": {
    alice: reaction("alice", "Alice", true, 200),
    bob: reaction("bob", "Bob", true, 500)
  }
};
const localWithAliceRemoval = mergeData(toggled, state({
  "👍": {
    alice: reaction("alice", "Alice", false, 400),
    bob: reaction("bob", "Bob", true, 500)
  }
}, 500));
const staleIncoming = state(bobAfterStaleRead, 500);
const repairedMerge = mergeData(localWithAliceRemoval, staleIncoming);
const correction = realtimeCorrectionForIncoming(staleIncoming, repairedMerge);
assert.equal(correction.threads["thread-1"].comments["comment-1"].reactions["👍"].alice.active, false);
assert.equal(sameDataRecords(correction, staleIncoming), false);
const converged = mergeData(staleIncoming, correction);
assert.equal(converged.threads["thread-1"].comments["comment-1"].reactions["👍"].alice.active, false);
assert.equal(converged.threads["thread-1"].comments["comment-1"].reactions["👍"].bob.active, true);

assert.deepEqual(Object.keys(cleanComment({ text: "x", reactions: { nope: { alice: reaction("alice", "Alice", true, 1) } } }).reactions), []);

console.log("Comment emoji picker and synchronized reaction checks passed.");
