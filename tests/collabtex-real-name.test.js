/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

(async () => {
  const stored = {};
  const storage = {
    async get(key) { return { [key]: stored[key] }; },
    async set(value) { Object.assign(stored, value); }
  };
  const context = vm.createContext({ console, Math, Object, String, RegExp });
  vm.runInContext(read("comment-profile.js"), context, { filename: "comment-profile.js" });
  const api = context.SmartTeXCommentProfile;

  const generated = await api.ensure(storage);
  assert.equal(generated.nameSource, "generated");
  assert.ok(api.ANIMALS.includes(generated.name));
  assert.equal(api.isFallbackProfile(generated), true);
  assert.equal(await api.fallbackNoticeShown(storage), false);
  await api.markFallbackNoticeShown(storage);
  assert.equal(await api.fallbackNoticeShown(storage), true);

  const detected = await api.applyDetectedName(storage, "Alice Example");
  assert.equal(detected.name, "Alice Example");
  assert.equal(detected.nameSource, "collabtex");
  assert.equal(detected.color, generated.color, "Host-name discovery must not change the user color.");

  await storage.set({
    [api.KEY]: api.normalize({ name: "Preferred Name", color: generated.color, nameSource: "manual" })
  });
  const preserved = await api.applyDetectedName(storage, "Alice Renamed");
  assert.equal(preserved.name, "Preferred Name", "A manually chosen name must never be overwritten.");
  assert.equal(preserved.nameSource, "manual");

  const legacyAnimal = api.normalize({ name: api.ANIMALS[0], color: generated.color });
  assert.equal(legacyAnimal.nameSource, "generated", "Old animal fallbacks must remain eligible for host-name upgrade.");
  const legacyCustom = api.normalize({ name: "Legacy Custom", color: generated.color });
  assert.equal(legacyCustom.nameSource, "manual", "Old non-animal names must be treated as intentional.");

  const bridge = read("page-bridge.js");
  assert.match(bridge, /smarttex:collabtex-local-identity/);
  assert.match(bridge, /function findLocalCollabtexUser\(users, socket\)/);
  assert.match(bridge, /clientTracking\.getConnectedUsers/);
  assert.match(bridge, /findLocalCollabtexUser\(users, socket\)/);
  assert.match(bridge, /publishLocalCollabtexIdentity\(localUser\)/);
  assert.match(bridge, /socket\?\.publicId/);
  assert.match(bridge, /meta\[name="ol-user"\]/);
  assert.match(bridge, /globalThis\.OL\?\.currentUser/);
  assert.match(bridge, /identityFromPageBootstrap/);
  assert.match(bridge, /identityFromAccountUi/);
  assert.match(bridge, /new URL\("\/user\/settings", location\.origin\)/);
  assert.match(bridge, /smarttex:collabtex-identity-refresh/);

  const settings = read("settings-menu.js");
  assert.match(settings, /manualName \? "manual" : commentProfile\.nameSource/);
  assert.match(settings, /maybeShowFallbackNameNoticeInMenu/);
  assert.match(settings, /smarttex:open-settings-menu/);
  assert.match(settings, /focusUserName/);
  const comments = read("comments.js");
  assert.match(comments, /maybeShowFallbackNameNoticeForDraft/);
  assert.match(comments, /smarttex:collabtex-identity-refresh/);
  const css = read("content.css");
  assert.match(css, /\.smarttex-fallback-name-notice/);
  const options = read("options.js");
  assert.match(options, /commentNameEdited \? "manual" : commentProfileState\?\.nameSource/);

  console.log("CollabTeX real-name identity checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
