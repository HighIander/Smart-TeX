/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const toolbar = read("editor-toolbar.js");
const background = read("background.js");
const css = read("content.css");

assert.match(background, /"content\.js",\s*"settings-menu\.js",\s*"figure-autocomplete\.js",\s*"editor-toolbar\.js",\s*"label-reference-guard\.js",\s*"project-files\.js"/);
assert.match(toolbar, /aria-label", "Bold"|"Bold"/);
assert.match(toolbar, /"Italic"/);
assert.match(toolbar, /"Underline"/);
assert.match(toolbar, /"Bulleted list"/);
assert.match(toolbar, /"Numbered list"/);
assert.match(toolbar, /"Add figure"/);
assert.match(toolbar, /"Add equation"/);
assert.match(toolbar, /"Add table"/);
assert.match(toolbar, /"Add or remove table rows and columns"/);
assert.match(toolbar, /"Move table rows or columns"/);
assert.match(toolbar, /"Table borders"/);
assert.match(toolbar, /"Beautify table source"/);
assert.match(toolbar, /tableEditor\.toggleBorder/);
assert.match(toolbar, /tableEditor\.createTable/);
assert.match(toolbar, /bridgeRequest\("replaceRange"/);
assert.match(toolbar, /NAVIGATION_PUSH_EVENT = "smarttex:navigation-history-push"/);
assert.match(toolbar, /"Back to the previous editor position"/);
assert.match(toolbar, /bridgeRequest\("setSelection"/);
assert.match(toolbar, /window\.addEventListener\(NAVIGATION_PUSH_EVENT/);
assert.match(css, /\.smarttex-document-back-button\[hidden\]/);
assert.doesNotMatch(toolbar, /document-preview-settings|liveDocumentPreview|applyLiveMode|scheduleRender/);
assert.match(css, /\.smarttex-document-editing-toolbar\s*\{/);
assert.match(css, /\.smarttex-table-dialog-overlay\s*\{/);
assert.match(css, /\.smarttex-document-toolbar-dropdown\s*\{/);

console.log("Independent editor-toolbar restoration checks passed.");
