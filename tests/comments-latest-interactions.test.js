const assert = require('assert');
const fs = require('fs');

const comments = fs.readFileSync('comments.js', 'utf8');
const bridge = fs.readFileSync('page-bridge.js', 'utf8');
const css = fs.readFileSync('content.css', 'utf8');

// Persistent editor icons default to 100% opacity and are controlled from
// from a settings section controlled by the gear button in the Comments header.
assert.match(comments, /let editorIconOpacity = 1/);
assert.match(comments, /smarttex-comments-settings/);
assert.match(comments, /smarttex-comments-display-controls\" hidden/);
assert.match(comments, /setPaneSettingsExpanded\(false\)/);
assert.match(comments, /smarttex-comments-icons-toggle/);
assert.match(comments, /smarttex-comments-opacity/);
assert.match(comments, /icons: \{ visible: editorIconsVisible, opacity: editorIconOpacity \}/);
assert.match(bridge, /let commentIconOpacity = 1/);
assert.match(bridge, /opacity:\$\{commentIconOpacity\}/);
assert.match(css, /\.smarttex-comments-settings/);
assert.match(css, /\.smarttex-comments-display-controls\[hidden\]/);

// Marked-text visibility/opacity has its own aligned control row.
assert.match(comments, /let editorMarkOpacity = 0\.30/);
assert.match(comments, /let editorMarksVisible = true/);
assert.match(comments, />Marks on</);
assert.match(comments, /smarttex-comments-mark-opacity/);
assert.match(comments, /marks: \{ visible: editorMarksVisible, opacity: editorMarkOpacity \}/);
assert.match(bridge, /let commentMarksVisible = true/);
assert.match(bridge, /let commentMarkOpacity = 0\.30/);
assert.match(css, /grid-template-columns: 72px minmax\(0, 1fr\)/);

// Marker removal acts on pointer-down, and mark->comment remains usable for at
// least one second after the pointer leaves/re-rendering occurs.
assert.match(bridge, /button\.addEventListener\("pointerdown"[\s\S]*dispatchAction\(event\)/);
assert.match(bridge, /markerConvertHoverUntil\.set\(markId, Date\.now\(\) \+ 1000\)/);
assert.match(bridge, /group\.addEventListener\("pointermove", keepAlive/);
assert.match(comments, /bindImmediateButtonAction\(remove, \(\) => \{[\s\S]*deleteMark\(mark\.id\)/);

// The pane lives below the formatting toolbar while the editor is visible,
// and only the editor surface is narrowed so the toolbar remains full width.
assert.match(comments, /toolbarRect\.bottom - hostRect\.top/);
assert.match(comments, /Keep CollabTeX's source layout pane at its native full width/);
assert.match(css, /\.ace_editor\.smarttex-comments-editor-docked[\s\S]*calc\(100% - var\(--smarttex-comments-dock-width/);

// The + button uses the current selection when available.
assert.match(comments, /const selection = currentSelection\(\);[\s\S]*startCommentAt\(selection\.start, selection\.end\)/);

// The + button is part of the scrolling list below all positioned entries (or
// above the empty-state message), while a new draft joins the same positional
// sort immediately and is scrolled fully into view.
assert.doesNotMatch(comments, /smarttex-comments-header[\s\S]{0,500}class="smarttex-comments-add"/);
assert.match(comments, /kind: "draft", start: draftThread\.start, createdAt: draftThread\.createdAt/);
assert.match(comments, /\.sort\(\(a, b\) => a\.start - b\.start \|\| a\.createdAt - b\.createdAt\)/);
assert.match(comments, /fragment\.appendChild\(renderAddCommentControl\(\)\);[\s\S]*if \(!entries\.length\)/);
assert.match(comments, /function ensureDraftCommentEditorVisible\(\)[\s\S]*list\.scrollTop \+= delta/);
assert.match(css, /\.smarttex-comments-add-row[\s\S]*justify-content: center/);

// Auto-open only considers actual comment threads, not marker-only metadata.
assert.match(comments, /function hasActualCommentsForCurrentDocument\(\)/);
assert.match(comments, /Object\.values\(thread\.comments \|\| \{\}\)\.some/);
assert.match(comments, /if \(hasActualCommentsForCurrentDocument\(\)\) \{[\s\S]*openPane\(\)/);

console.log('Latest comments interaction checks passed.');
