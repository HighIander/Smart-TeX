/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const optionsHtml = fs.readFileSync(path.join(root, "options.html"), "utf8");
const optionsJs = fs.readFileSync(path.join(root, "options.js"), "utf8");
const consent = fs.readFileSync(path.join(root, "privacy-consent.js"), "utf8");
const consentContent = fs.readFileSync(path.join(root, "privacy-consent-content.js"), "utf8");

assert.equal(manifest.version, "2.1.0");
assert.match(background, /"privacy-consent\.js"\s*,\s*"privacy-consent-content\.js"/);
assert.match(background, /details\.reason === "install"[\s\S]*runtime\.openOptionsPage\(\)/);
assert.match(optionsHtml, /smartioz\.com\/smartTex\/dataprotection\.php/);
assert.match(optionsHtml, /smartioz\.com\/smartTex\/impressum\.php/);
assert.match(optionsHtml, /<script src="privacy-consent\.js"><\/script>/);
assert.match(optionsJs, /SmartTeXPrivacyConsent\?\.showIfNeeded\(\)/);
assert.match(consentContent, /SmartTeXPrivacyConsent\?\.showIfNeeded\(\)/);
assert.match(consent, /smarttex:privacy-consent:v1/);
assert.match(consent, /Accept and continue/);
assert.match(consent, /acceptedAt: new Date\(\)\.toISOString\(\)/);

console.log("Privacy-consent installation and CollabTeX-load regression test passed.");
