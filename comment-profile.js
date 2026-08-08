/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.SmartTeXCommentProfile) return;

  const KEY = "smarttex:comment-profile:v1";
  const ANIMALS = Object.freeze([
    "Albatross", "Badger", "Beaver", "Bison", "Capybara", "Caracal", "Dolphin",
    "Falcon", "Fox", "Gecko", "Heron", "Ibex", "Jaguar", "Koala", "Lemur",
    "Lynx", "Marmot", "Narwhal", "Octopus", "Orca", "Otter", "Owl", "Panda",
    "Penguin", "Quokka", "Raven", "Salamander", "Seal", "Stoat", "Tapir",
    "Tern", "Tiger", "Toucan", "Turtle", "Wombat", "Yak"
  ]);
  const COLORS = Object.freeze([
    "#e5534b", "#d97706", "#b58900", "#5f9f45", "#2f9e72", "#159eaf",
    "#268bd2", "#4f7fe8", "#7455d9", "#9b59b6", "#c94f9d", "#d94f70"
  ]);

  function validColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""));
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)] || items[0];
  }

  function randomProfile() {
    return { name: randomItem(ANIMALS), color: randomItem(COLORS) };
  }

  function normalize(value, fallback = null) {
    const base = fallback || randomProfile();
    const rawName = String(value?.name || "").trim();
    return {
      name: rawName.slice(0, 80) || base.name,
      color: validColor(value?.color) ? String(value.color).toLowerCase() : base.color
    };
  }

  async function ensure(storageArea) {
    const generated = randomProfile();
    if (!storageArea?.get || !storageArea?.set) return generated;
    let stored = {};
    try {
      stored = await storageArea.get(KEY) || {};
    } catch (_error) {
      return generated;
    }
    const existing = stored?.[KEY];
    if (existing?.name && validColor(existing?.color)) return normalize(existing, generated);
    const profile = normalize(existing, generated);
    try { await storageArea.set({ [KEY]: profile }); } catch (_error) { /* local fallback remains usable */ }
    return profile;
  }

  globalThis.SmartTeXCommentProfile = Object.freeze({
    KEY,
    ANIMALS,
    COLORS,
    validColor,
    randomProfile,
    normalize,
    ensure
  });
})();
