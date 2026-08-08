/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

assert.equal(
  fs.existsSync(path.join(root, "document-preview.js")),
  false,
  "The full-document preview implementation must not be shipped."
);

const background = read("background.js");
const optionsHtml = read("options.html");
const optionsJs = read("options.js");
const content = read("content.js");
const css = read("content.css");
const manifest = JSON.parse(read("manifest.json"));

assert.doesNotMatch(background, /["']document-preview\.js["']/);
assert.doesNotMatch(optionsHtml, /S Live|live-document-preview|full-document preview/i);
assert.doesNotMatch(optionsJs, /liveDocumentPreview|live-document-preview/);
assert.doesNotMatch(content, /smarttex-document-preview|liveDocumentPreview|scheduleRenderDocument/);
assert.doesNotMatch(css, /smarttex-document-preview(?!-settings)|smarttex-document-activity-spinner/);
assert.match(background, /["']editor-toolbar\.js["']/);
assert.equal(fs.existsSync(path.join(root, "editor-toolbar.js")), true);
assert.doesNotMatch(manifest.description, /full-document|PDF pane/i);
assert.match(background, /removeLegacyDocumentPreviewSettings/);
assert.match(background, /smarttex:document-preview-settings:v1/);

console.log("Full-document live preview removal checks passed.");
