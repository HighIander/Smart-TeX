const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");
const guard = fs.readFileSync(path.join(root, "label-reference-guard.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.version, "1.4.34");
assert.match(content, /function popupSpinnerButtonPosition\(\)/);
assert.match(content, /optionsButton\?\.getBoundingClientRect/);
assert.doesNotMatch(content, /function popupPointerPosition\(/);
assert.match(css, /\.smarttex-popup-loading-spinner[\s\S]*?margin:\s*0;/);
assert.match(guard, /maximumEnvironmentLength:\s*0/);
assert.match(guard, /beforeCount = 3/);
assert.match(guard, /afterCount = 3/);
assert.match(guard, /leftLength > rightLength \* 1\.55/);
console.log("SmartTeX 1.4.34 feature checks passed.");
