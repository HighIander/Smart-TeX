const assert = require('assert');
const fs = require('fs');

const read = (name) => fs.readFileSync(name, 'utf8');

const comments = read('comments.js');
const content = read('content.js');
const bridge = read('page-bridge.js');
const toolbar = read('editor-toolbar.js');
const css = read('content.css');
const popupGate = read('popup-gate.js');
const background = read('background.js');
const bootstrap = read('editor-bootstrap.js');

// On legacy/current CollabTeX, comments are mounted inside the layout=pdf
// container, between its source center pane and PDF east pane. Only the source
// pane width is reduced, so its left edge remains after the project file tree.
// Redesigned variants retain the body-mounted geometry fallback.
assert.match(comments, /function pdfLayoutContainer\(\)/);
assert.match(comments, /pdf-preview/);
assert.match(comments, /function sourceLayoutPane\(/);
assert.match(comments, /function applyLegacyLayoutPaneGeometry\(/);
assert.match(comments, /host\.appendChild\(pane\)/);
assert.match(comments, /smarttex-comments-source-pane-docked/);
assert.match(comments, /directLayoutChild\(host, "ui-layout-resizer-east"\)/);
assert.match(comments, /document\.body\.appendChild\(pane\)/);
assert.match(css, /\.smarttex-comments-source-pane-docked/);
assert.match(css, /\.smarttex-comments-pdf-pane-docked/);
assert.match(css, /\.smarttex-comments-resizer[\s\S]*left: -3px/);
assert.match(toolbar, /document\.dispatchEvent\(new CustomEvent\("smarttex:comments-toggle-pane"/);

// SmartTeX editor scripts are registered directly again. The temporary
// editor-bootstrap gate was removed because it could miss a CollabTeX document
// during initial React mounting and leave the whole extension unloaded. The old
// persistent bootstrap registration is explicitly unregistered during update.
assert.match(background, /LEGACY_BOOTSTRAP_SCRIPT_ID/);
assert.match(background, /id: BRIDGE_SCRIPT_ID/);
assert.match(background, /id: DEPENDENCY_SCRIPT_ID/);
assert.match(background, /id: CONTENT_SCRIPT_ID/);
assert.match(background, /"content\.js"/);
assert.doesNotMatch(background, /message\?\.type === "smarttex-initialize-editor"/);

// Page-type checks may still suppress UI/work when an editor is definitely
// absent, but they must not be the sole mechanism by which scripts are loaded.
assert.match(content, /#ide-redesign-panel-source-editor \.cm-editor/);
assert.match(bridge, /#ide-redesign-panel-source-editor \.cm-editor/);
assert.match(popupGate, /isReady: \(\) => true/);

// Structure cache rebuilds must signal both active and ready states, while the
// isolated-world button keeps a short paintable spinner interval.
assert.match(bridge, /setStructureAnalysisState\(true\)/);
assert.match(bridge, /setStructureAnalysisState\(false\)/);
assert.match(content, /STRUCTURE_SPINNER_MIN_VISIBLE_MS = 140/);
assert.match(content, /data-smarttex-structure-analysis/);
assert.match(content, /structureAnalysisStateObserver/);

// The Comments control is the last item in the style toolbar, separated from
// the table tools by its own divider.
const toolbarAppendStart = toolbar.indexOf("toolbar.append(");
const toolbarAppendEnd = toolbar.indexOf(");", toolbarAppendStart);
const toolbarAppend = toolbar.slice(toolbarAppendStart, toolbarAppendEnd);
assert.ok(toolbarAppend.indexOf("beautifyTable") < toolbarAppend.indexOf("comments"));
assert.match(toolbarAppend, /beautifyTable,\s*divider\(\),\s*comments/);

// Aborted or stale structure analyses must always clear the global S-button
// spinner before a retry can be scheduled.
assert.match(bridge, /finally\s*\{[\s\S]*setStructureAnalysisState\(false\)/);


// The source layout pane stays full-width so the formatting toolbar spans the
// combined editor + comments area. Only the editor surface below that toolbar
// is narrowed, and it is explicitly asked to recalculate its viewport.
assert.match(comments, /Keep CollabTeX's source layout pane at its native full width/);
assert.match(comments, /smarttex-comments-editor-docked/);
assert.match(comments, /toolbarRect\.bottom - hostRect\.top/);
assert.match(css, /ace_editor\.smarttex-comments-editor-docked[\s\S]*calc\(100% - var\(--smarttex-comments-dock-width/);
assert.match(comments, /bridgeRequest\("resizeEditor"/);
assert.match(bridge, /request\.type === "resizeEditor"/);

// Location and destructive comment controls act on pointer-down so CollabTeX
// cannot consume the first click while shifting focus. Deletion is confirmed.
assert.match(comments, /function bindImmediateButtonAction\(/);
assert.match(comments, /function ensureRemovalConfirmationOverlay\(/);
assert.match(comments, /smarttex-comments-confirm-overlay/);
assert.match(comments, /title: "Delete comment\?"/);
assert.match(comments, /title: "Delete comment thread\?"/);
assert.doesNotMatch(comments, /window\.confirm/);
assert.match(css, /smarttex-comments-source-pane-docked > \.editor-container > \.vertical-resizable-top/);

console.log('Comments pane, project-page, and structure-spinner regression checks passed.');
