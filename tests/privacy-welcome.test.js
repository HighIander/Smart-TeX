/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "options.html"), "utf8");
const consent = fs.readFileSync(path.join(root, "privacy-consent.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

for (const url of [
  "https://smartioz.com/smartTex/dataprotection.php",
  "https://smartioz.com/smartTex/impressum.php"
]) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(html, new RegExp(escaped));
  assert.match(consent, new RegExp(escaped));
}
assert.match(consent, /smarttex-privacy-consent-overlay/);
assert.match(consent, /Welcome to SmartTeX/);
assert.match(consent, /smarttex:privacy-consent:v1/);
assert.match(consent, /acceptedAt/);
assert.match(background, /details\.reason === "install"/);
assert.match(background, /openOptionsPage\(\)/);

console.log("Privacy welcome regression checks passed.");
