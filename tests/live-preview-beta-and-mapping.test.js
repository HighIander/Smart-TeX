/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const optionsHtml = fs.readFileSync(path.join(root, "options.html"), "utf8");
const optionsJs = fs.readFileSync(path.join(root, "options.js"), "utf8");
const previewJs = fs.readFileSync(path.join(root, "document-preview.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  optionsHtml.includes('id="smarttex-feature-live-document-preview"') &&
    /Beta/i.test(optionsHtml),
  "The options page must expose the S Live beta checkbox."
);
assert(
  /liveDocumentPreview:\s*false/.test(optionsJs),
  "The S Live button must be hidden by default."
);
assert(
  previewJs.includes("applyLiveDocumentPreviewButtonVisibility") &&
    previewJs.includes("features?.liveDocumentPreview === true"),
  "The document preview must apply the stored beta-button visibility setting."
);
assert(
  previewJs.includes("fastVisibleOffsetForSourceCursor") &&
    previewJs.includes("fastSourceIndexForTextSegment") &&
    previewJs.includes("fastTextPartForCursor"),
  "Fast bidirectional cursor mapping must be enabled."
);
assert(
  previewJs.includes("schedulePreviewHover") &&
    previewJs.includes("requestIdleCallback"),
  "Preview hover rendering must be deferred away from the pointer event."
);
assert(
  previewJs.includes("textSegmentByNode") &&
    previewJs.includes("textSegmentForDomPoint") &&
    previewJs.includes("reindexTextSegments"),
  "Preview clicks must use the direct DOM-node-to-source-segment index."
);
assert(
  previewJs.includes("while (low < high)") &&
    previewJs.includes("low - 3") &&
    previewJs.includes("low + 3"),
  "The fallback click hit test must use logarithmic text-offset lookup instead of measuring every character."
);
assert(
  previewJs.includes("segmentStart - padding") &&
    previewJs.includes("Math.abs(left - coarse)"),
  "Preview-to-editor cursor mapping must search near the clicked segment and choose the nearest duplicate."
);
assert(
  previewJs.includes("source.slice(start, end)") &&
    !/function cursorIsInsideCitationCommand\(\)[\s\S]*?maskIgnoredLatex\(source\);/.test(previewJs),
  "Citation hover checks must not mask the complete manuscript."
);
assert(
  previewJs.includes("smarttexFigurePreviewData") &&
    previewJs.includes("__smarttexFigureKey"),
  "Figure hover previews must reuse parse results and popup content."
);

console.log("Live preview beta and mapping regression tests passed.");
