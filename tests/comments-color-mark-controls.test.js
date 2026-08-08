const assert = require('assert');
const fs = require('fs');

const comments = fs.readFileSync('comments.js', 'utf8');
const bridge = fs.readFileSync('page-bridge.js', 'utf8');
const css = fs.readFileSync('content.css', 'utf8');

// Thread and mark headers get a palette control immediately before deletion.
assert.match(comments, /function paletteIconSvg\(\)/);
assert.match(comments, /attachColorPicker\(header, thread, card, "Change comment color"\)/);
assert.match(comments, /header\.append\(location, spacer, collapse, palette\.button, trash\)/);
assert.match(comments, /attachColorPicker\(header, mark, card, "Change marking color"\)/);
assert.match(comments, /header\.append\(location, text, spacer, palette\.button, remove\)/);

// The palette button opens a real SmartTeX in-window picker instead of trying
// to activate an invisible native color input.
assert.match(comments, /function ensureColorPickerOverlay\(\)/);
assert.match(comments, /id = "smarttex-comment-color-overlay"/);
assert.match(comments, /smarttex-comment-color-swatches/);
assert.match(comments, /type="color" class="smarttex-comment-color-native"/);
assert.match(comments, /function openColorPicker\(/);
assert.match(comments, /bindImmediateButtonAction\(button, \(\) => openColorPicker/);
assert.match(comments, /target\.record\.updatedAt = now\(\);[\s\S]*markDirty\(\)/);
assert.match(css, /#smarttex-comment-color-overlay/);
assert.match(css, /\.smarttex-comment-color-picker/);

// Empty first comments on a text range degrade to a mark, both for new drafts
// and for editing the only comment in an existing thread.
assert.match(comments, /if \(!text\)[\s\S]*Number\(draft\.end\) > Number\(draft\.start\)[\s\S]*createMarkFromAnchor/);
assert.match(comments, /aliveComments\.length === 1[\s\S]*convertThreadToMark\(thread\)/);

// Comment icons move away from the current text caret when they would overlap.
assert.match(bridge, /function moveCommentIconAwayFromCaret\(/);
assert.match(bridge, /\(\{ x, y \} = moveCommentIconAwayFromCaret\(x, y, 20, 20, bounds\)\)/);

console.log('Comment color/mark display-control checks passed.');
