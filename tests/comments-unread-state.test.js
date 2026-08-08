const assert = require('assert');
const fs = require('fs');

const comments = fs.readFileSync('comments.js', 'utf8');
const toolbar = fs.readFileSync('editor-toolbar.js', 'utf8');
const css = fs.readFileSync('content.css', 'utf8');

// Read/unread is per local user/project and is not part of synchronized JSON.
assert.match(comments, /unreadTrackingInitializedV1/);
assert.match(comments, /readActivity: Object\.fromEntries/);
assert.match(comments, /function isOwnActivity\(/);
assert.match(comments, /authorId: String\(value\.authorId \|\| ""\)/);
assert.match(comments, /AUTHOR_ID_KEY = "smarttex:comment-author-id:v1"/);

// Existing metadata becomes the baseline once on upgrade, while later remote
// messages/marks are compared against locally stored read stamps.
assert.match(comments, /function markAllExistingActivityReadAsBaseline\(/);
assert.match(comments, /if \(!unreadTrackingInitialized\) markAllExistingActivityReadAsBaseline\(\)/);
assert.match(comments, /function isCommentUnread\(/);
assert.match(comments, /function isMarkUnread\(/);

// Individual message/mark dots and toolbar aggregate dot are rendered.
assert.match(comments, /smarttex-comments-unread-dot/);
assert.match(comments, /smarttex-comment-unread/);
assert.match(comments, /smarttex-comment-mark-unread/);
assert.match(toolbar, /smarttex:comments-unread-state/);
assert.match(toolbar, /smarttex-comments-has-unread/);
assert.match(css, /#smarttex-comments-toggle-button\.smarttex-comments-has-unread::after/);
assert.match(css, /\.smarttex-comments-unread-dot/);

// Clicking a specific message only marks that message read. Closing with
// unread activity asks whether to mark all read or preserve the unread state.
assert.match(comments, /markCommentRead\(thread, comment, \{ refresh: false \}\)/);
assert.match(comments, /if \(!event\.target\.closest\("\.smarttex-comment-entry"\)\) markThreadRead\(thread\)/);
assert.match(comments, /function finishClosePane\(\{ markAllRead = false \} = \{\}\)/);
assert.match(comments, /if \(markAllRead\) markCurrentFileRead\(\{ refresh: false \}\)/);
assert.match(comments, /title: "Mark unread activity as read\?"/);
assert.match(comments, /confirmLabel: "Mark all read"/);
assert.match(comments, /cancelLabel: "Keep unread"/);
assert.match(comments, /onCancel: \(\) => finishClosePane\(\{ markAllRead: false \}\)/);

console.log('Comment unread/read-state checks passed.');
