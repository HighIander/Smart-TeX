const assert = require("node:assert/strict");
const fs = require("node:fs");

const comments = fs.readFileSync("comments.js", "utf8");

// Background maintenance must preserve active comment interactions instead of
// rebuilding the pane and destroying focused fields / chooser DOM.
assert.match(comments, /function paneInteractionIsActive\(\)/);
assert.match(comments, /giphyPicker && !giphyPicker\.hidden/);
assert.match(comments, /emojiPicker && !emojiPicker\.hidden/);
assert.match(comments, /active\.closest\?\.\([\s\S]*textarea, input, select/);
assert.match(comments, /function renderPaneThreads\(\{ preserveInteraction = false \} = \{\}\)/);
assert.match(comments, /if \(preserveInteraction && paneInteractionIsActive\(\)\)[\s\S]*paneRenderDeferred = true[\s\S]*return false/);

// The periodic remote fallback must not render identical records, and real
// background changes must use the interaction-preserving path.
assert.match(comments, /const recordsChanged = !sameDataRecords\(merged, data\)/);
assert.match(comments, /if \(recordsChanged \|\| ownProfileChanged \|\| reattached\)[\s\S]*renderAll\(\{ preserveInteraction: true \}\)/);

// Editor source maintenance is also deferred while the user is interacting.
assert.match(comments, /Source maintenance must not tear down[\s\S]*renderAll\(\{ preserveInteraction: true \}\)/);

// Frequent same-document editor-state events update the highlight in-place;
// only a document switch requests a pane rebuild.
assert.match(comments, /function updatePaneThreadHighlights\(\)/);
assert.match(comments, /if \(fileChanged\) \{[\s\S]*renderAll\(\{ preserveInteraction: true \}\)[\s\S]*\} else \{[\s\S]*updatePaneThreadHighlights\(\)/);

// A deferred refresh is eventually applied once the protected interaction has
// ended, including chooser close and focus leaving a comment field.
assert.match(comments, /function scheduleDeferredPaneRenderFlush\(delay = 0\)/);
assert.match(comments, /document\.addEventListener\("focusout"[\s\S]*scheduleDeferredPaneRenderFlush\(\)/);
assert.match(comments, /function closeGiphyPicker[\s\S]*scheduleDeferredPaneRenderFlush\(\)/);
assert.match(comments, /function closeEmojiPicker[\s\S]*scheduleDeferredPaneRenderFlush\(\)/);


// The temporary icon-highlight timeout must also be non-destructive. It used to
// call renderPaneThreads() after 1.6 s, which closed a picker opened meanwhile.
assert.match(comments, /function focusThreadFromIcon[\s\S]*updatePaneThreadHighlights\(\)[\s\S]*setTimeout[\s\S]*updatePaneThreadHighlights\(\)/);

console.log("Comment focus and chooser lifetime stability checks passed.");
