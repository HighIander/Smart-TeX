/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

// The stable 1.4.20 architecture remains in use: no worker/client state layer may
// become a correctness dependency. Cooperative cancellation is loaded before the
// existing parser and UI modules in both JavaScript worlds.
assert.doesNotMatch(background, /analysis-worker\.js|analysis-client\.js|editor-state-client\.js/);
assert.match(background, /js:\s*\["interaction-tasks\.js",\s*"latex-context\.js",\s*"page-bridge\.js"\]/);
assert.match(background, /"interaction-tasks\.js",\s*\n\s*"font-loader\.js"/);
assert.equal(manifest.version, "1.4.34");
assert.match(content, /activeStrength/);
assert.match(bridge, /activeAlpha/);
assert.match(content, /popup-preview-render/);
assert.match(bridge, /structure-highlight-analysis/);

for (const forbidden of ["analysis-worker.js", "analysis-client.js", "editor-state-client.js"]) {
  assert.equal(fs.existsSync(path.join(root, forbidden)), false, `${forbidden} must remain absent`);
}

console.log("Stable architecture with cooperative cancellation checks passed.");
