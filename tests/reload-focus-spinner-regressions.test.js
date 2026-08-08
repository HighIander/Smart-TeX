const assert = require('assert');
const fs = require('fs');

const comments = fs.readFileSync('comments.js', 'utf8');
const content = fs.readFileSync('content.js', 'utf8');
const bridge = fs.readFileSync('page-bridge.js', 'utf8');

// Comment/mark mutations are cached immediately so a reload inside the normal
// delayed project-write window cannot lose local work.
assert.match(comments, /LOCAL_PENDING_KEY_PREFIX/);
assert.match(comments, /function persistPendingDataSnapshot\(/);
assert.match(comments, /function loadPendingDataSnapshot\(/);
assert.match(comments, /function markDirty[\s\S]*persistPendingDataSnapshot\(\)/);
assert.match(comments, /clearPendingDataThrough\(targetRevision\)/);

// Initial hydration retries while CollabTeX is still constructing its project
// model, and the bridge no longer treats an unavailable root as "file missing".
assert.match(comments, /for \(let attempt = 0; attempt < 6 && !hydrated; attempt \+= 1\)/);
assert.match(bridge, /for \(let attempt = 0; attempt < 6 && !resolved\.item && !resolved\.entity && !resolved\.fileId; attempt \+= 1\)/);
assert.match(bridge, /if \(!rootFolderIdFromProjectModel\(\)\)[\s\S]*Could not determine the CollabTeX project root folder/);

// Starting a comment focuses its editor, and subsequent pane rerenders preserve
// that focused textarea instead of replacing it and returning focus to the editor.
assert.match(comments, /function focusDraftCommentEditor\(/);
assert.match(comments, /focusDraftCommentEditor\(\);/);
assert.match(comments, /const restoreDraftFocus = Boolean/);
assert.match(comments, /replacement\.focus\(\{ preventScroll: true \}\)/);
assert.match(comments, /replacement\.setSelectionRange/);

// The S-button spinner covers initial comment/mark hydration as well as structure
// analysis and remains active through the first overlay paint.
assert.match(comments, /smarttex:comments-initialization-state/);
assert.match(comments, /__smartTeXCommentsInitializationActive/);
assert.match(content, /COMMENTS_INITIALIZATION_STATE_EVENT/);
assert.match(content, /__smartTeXCommentsInitializationActive !== false/);
assert.match(content, /structureAnalysisActive \|\| commentsInitializationActive/);
assert.match(content, /function updateToolbarLoadingSpinner\(/);
assert.match(bridge, /Keep the global S-button spinner active through the paint/);
assert.match(bridge, /requestAnimationFrame\(\(\) => setStructureAnalysisState\(false\)\)/);

console.log('Reload persistence, comment focus, and global loading-spinner checks passed.');
