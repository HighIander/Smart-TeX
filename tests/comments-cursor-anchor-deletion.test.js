const assert = require('assert');
const fs = require('fs');

const comments = fs.readFileSync('comments.js', 'utf8');
const bridge = fs.readFileSync('page-bridge.js', 'utf8');
const css = fs.readFileSync('content.css', 'utf8');

// Cursor movement inside a commented range tracks/highlights the thread but
// does not itself open a closed Comments pane.
assert.match(comments, /function updateCursorThreadFocus\(\)/);
assert.match(comments, /cursorActiveThreadId = next/);
assert.match(comments, /if \(paneOpen && cursorFocus\.threadId && cursorFocus\.changed\)/);
assert.doesNotMatch(comments, /updateCursorThreadFocus\(\)[\s\S]{0,250}openPane\(\)/);
assert.match(comments, /smarttex-comment-thread-cursor-active/);
assert.match(css, /\.smarttex-comment-thread-cursor-active/);
// A caret exactly behind the marked text is still considered part of that
// commented range for persistent pane highlighting. Interior hits are checked
// first so a following comment at the same boundary wins naturally.
assert.match(comments, /ranged\.find\(\(thread\) => cursor >= thread\.start && cursor < thread\.end\)[\s\S]*ranged\.find\(\(thread\) => cursor === thread\.end\)/);


// Explicit comment-icon activation still opens, scrolls to, and highlights the
// corresponding thread, and it acts on pointerdown (first physical press).
assert.match(comments, /Explicit icon activation[\s\S]*focusThreadFromIcon\(threadId\)[\s\S]*openPane\(\)[\s\S]*scrollThreadIntoView\(threadId\)/);
assert.match(bridge, /smarttex-comment-anchor-icon[\s\S]*addEventListener\("pointerdown"[\s\S]*activate\(event\)/);

// When all selected text disappears, plain marks are tombstoned while comment
// threads collapse to point anchors (vertical-line representation).
assert.match(comments, /const isFullRangeDeletion = \(record\)/);
assert.match(comments, /if \(isFullRangeDeletion\(mark\)\)[\s\S]*mark\.deletedAt = stamp/);
assert.match(comments, /if \(isFullRangeDeletion\(thread\)\)[\s\S]*thread\.start = point;[\s\S]*thread\.end = point/);

// Cancelling a brand-new selection comment discards its temporary marking.
const cancelStart = comments.indexOf("function cancelDraftThread()");
const cancelEnd = comments.indexOf("function toggleMark", cancelStart);
assert.ok(cancelStart >= 0 && cancelEnd > cancelStart);
assert.doesNotMatch(comments.slice(cancelStart, cancelEnd), /createMarkFromAnchor|uid\("mark"\)/);

// Legacy #editor and its Ace wrapper are explicitly constrained so the pane
// reserves space immediately rather than waiting for a window resize.
assert.match(css, /#editor\.smarttex-comments-editor-docked/);
assert.match(css, /#editor\.smarttex-comments-editor-docked > \.ace-editor-wrapper/);

console.log('Cursor/comment anchor deletion checks passed.');

// Full-range anchor deletion is reversible. The pre-deletion source and anchor
// are retained in memory; returning to that source (editor undo) revives a
// tombstoned mark or restores a point-collapsed comment range with a newer
// updatedAt timestamp so the restoration also wins on the next sync.
assert.match(comments, /const anchorDeletionRecoveries = \[\]/);
assert.match(comments, /function rememberAnchorDeletionRecovery\(kind, record, beforeSource, afterSource\)/);
assert.match(comments, /beforeSource: String\(beforeSource \|\| ""\)/);
assert.match(comments, /function restoreAnchorDeletionRecoveries\(fileName, source\)/);
assert.match(comments, /recovery\.beforeSource !== source/);
assert.match(comments, /record\.deletedAt = 0;[\s\S]*record\.updatedAt = Math\.max/);
assert.match(comments, /rememberAnchorDeletionRecovery\("mark", mark, previous, source\)/);
assert.match(comments, /rememberAnchorDeletionRecovery\("thread", thread, previous, source\)/);
assert.match(comments, /recovery\.restoredMarks\.has\(mark\.id\)/);
assert.match(comments, /recovery\.restoredThreads\.has\(thread\.id\)/);
