/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const reference = fs.readFileSync(path.join(root, "reference-autocomplete.js"), "utf8");
const citation = fs.readFileSync(path.join(root, "citation-autocomplete.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "figure-renderer.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

assert.match(
  content,
  /function autocompleteListAvailableAtCursor[\s\S]*if \(autocompleteListAvailableAtCursor\(state\)\) \{[\s\S]*hideCaptionReferencePopup\(\);[\s\S]*return true;/,
  "Cursor-triggered reference previews must yield directly to autocomplete lists."
);
assert.match(
  reference,
  /immediateOpenUntil[\s\S]*Date\.now\(\) <= immediateOpenUntil[\s\S]*openForCurrentContext\(\)[\s\S]*document\.addEventListener\("pointerdown"/,
  "Reference autocomplete must open immediately after an editor click."
);
assert.match(
  citation,
  /immediateOpenUntil[\s\S]*Date\.now\(\) <= immediateOpenUntil[\s\S]*openForCurrentContext\(\)[\s\S]*document\.addEventListener\("pointerdown"/,
  "Citation autocomplete must open immediately after an editor click."
);

assert.match(
  content,
  /function referenceTargetPreviewEnabled[\s\S]*target\.type === "equation"[\s\S]*enabledFeatures\.equations[\s\S]*target\.type === "table"[\s\S]*enabledFeatures\.tables[\s\S]*target\.type === "figure"[\s\S]*enabledFeatures\.figures/,
  "Feature switches must gate equation, table, and figure previews centrally."
);
assert.match(
  content,
  /if \(!target \|\| !referenceTargetPreviewEnabled\(target\)\) \{[\s\S]*hideCaptionReferencePopup\(\)/,
  "Reference-list previews must respect disabled target types."
);
assert.match(
  content,
  /function updateGraphicAutocompletePreview\(\)[\s\S]*if \(!enabledFeatures\.figures\)/,
  "includegraphics list previews must respect the figure-preview option."
);

assert.match(
  renderer,
  /availableHeight \/ desiredHeight[\s\S]*appliedScale[\s\S]*viewport\.classList\.remove\("smarttex-figure-popup-scrollable"\)/,
  "Figure media must be scaled to available width and height instead of becoming scrollable."
);
assert.match(
  css,
  /\.smarttex-figure-popup-viewport\s*\{[\s\S]*overflow:\s*hidden/,
  "Figure viewports must not expose scrollbars."
);
assert.match(
  css,
  /\.smarttex-float-popup-caption\s*\{[\s\S]*overflow-y:\s*auto/,
  "Only long captions may scroll vertically."
);
assert.match(
  css,
  /data-smarttex-content-kind="figure"[\s\S]*width:\s*fit-content/,
  "Figure reference popups must size to the rendered figure rather than the caption."
);

assert.match(
  renderer,
  /function ensurePopupZoom[\s\S]*addEventListener\("wheel"[\s\S]*setScale[\s\S]*pointerdown[\s\S]*pointermove/,
  "Figure popups must support wheel zooming and drag panning."
);
assert.match(
  css,
  /\.smarttex-figure-popup-viewport:hover \.smarttex-figure-zoom-controls[\s\S]*opacity:\s*1/,
  "Figure zoom controls must appear on hover."
);

assert.match(
  content,
  /function announceNavigationOrigin[\s\S]*NAVIGATION_PUSH_EVENT[\s\S]*announceNavigationOrigin\(sourceIndex\)[\s\S]*bridgeRequest\("setCursor"/,
  "Following a reference target must preserve the previous editor position."
);
assert.match(
  renderer,
  /POPUP_ZOOM_OVERSAMPLE = 2[\s\S]*devicePixelRatio[\s\S]*baseWidth \* scale \* devicePixelRatio \* POPUP_ZOOM_OVERSAMPLE[\s\S]*pdfPreviewDataUrl\(source, \{[\s\S]*targetWidth/,
  "PDF figure previews must render at twice the visible zoom target."
);
assert.match(
  renderer,
  /async setScale[\s\S]*await this\.ensureResolution\(this\.requestedScale\)[\s\S]*this\.scale = nextScale/,
  "The high-resolution render must complete before the visible zoom is applied."
);
assert.match(
  renderer,
  /media\.style\.width = `\$\{baseWidth \* this\.scale\}px`/,
  "Raster figures must be zoomed through their layout size so the browser resamples the original source."
);
assert.doesNotMatch(
  renderer,
  /translate3d\([^\n]+\) scale\(/,
  "Visible figure zoom must not upscale a previously rasterized compositor layer."
);

console.log("Popup routing, feature gating, figure-layout, and zoom regression checks passed.");
