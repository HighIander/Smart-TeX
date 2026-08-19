const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const comments = fs.readFileSync("comments.js", "utf8");
const integration = fs.readFileSync("giphy-integration.js", "utf8");
const options = fs.readFileSync("options.js", "utf8");
const optionsHtml = fs.readFileSync("options.html", "utf8");
const css = fs.readFileSync("content.css", "utf8");
const background = fs.readFileSync("background.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

// The GIPHY integration module is registered before comments.js and the local
// attribution mark is packaged as a web-accessible extension asset.
assert.match(background, /"giphy-integration\.js"[\s\S]*"comments\.js"/);
assert.ok(manifest.web_accessible_resources.some((entry) => entry.resources?.includes("icons/giphy-powered-by.png")));
assert.equal(fs.existsSync("icons/giphy-powered-by.png"), true);

// All comment textarea variants use the shared shell, so the GIF control sits
// beside the existing emoji control for drafts, replies, and editing.
assert.match(comments, /function emojiInputShell\(textarea\)/);
assert.match(comments, /className = "smarttex-comment-giphy-trigger"/);
assert.match(comments, /giphyButton\.textContent = "GIF"/);
assert.match(comments, /shell\.append\(textarea, giphyButton, emojiButton, preview\)/);
assert.match(css, /\.smarttex-comment-giphy-trigger[\s\S]*right:\s*36px[\s\S]*bottom:\s*7px/);
assert.match(css, /\.smarttex-comment-emoji-trigger[\s\S]*right:\s*7px[\s\S]*bottom:\s*7px/);

// GIF-only comments are valid records, including draft, edit, and reply paths.
assert.match(comments, /if \(!text && !giphy\)/);
assert.match(comments, /if \(!body && !giphy\)/);
assert.match(comments, /commitEditedComment\(thread\.id, comment\.id, textarea\.value, editingComment\?\.draftGiphy\)/);
assert.match(comments, /addReply\(thread\.id, textarea\.value, replyGiphyDrafts\.get\(thread\.id\)\)/);
assert.match(comments, /textarea\.__smarttexGiphyGet = \(\) => cleanGiphyAttachment\(draftThread\?\.giphy\)/);
assert.match(comments, /giphy:\s*cleanGiphyAttachment\(value\.giphy\)/);
assert.match(comments, /renderGiphyAttachment\(comment\.giphy\)/);

// Viewing is blocked until consent; adding requests the same GIPHY-specific
// consent before the picker can perform API calls.
assert.match(comments, /requestConsent\?\.\(\{ reason: "add" \}\)/);
assert.match(comments, /const allowed = await integration\?\.requestConsent[\s\S]*const target = resolveGiphyInput/);
assert.match(comments, /bindImmediateButtonAction\(giphyButton,[\s\S]*openGiphyPicker\(giphyButton, textarea\)/);
assert.match(comments, /requestConsent\?\.\(\{ reason: "view" \}\)/);
assert.match(comments, /maybeRequestViewingConsent\?\.\(\)/);
assert.match(integration, /SmartTeX does not request[\s\S]*GIPHY API results, analytics,[\s\S]*or media[\s\S]*before you consent/);
assert.match(integration, /viewerPromptedThisSession/);
assert.match(integration, /withdrawConsent/);

// Persisted comments keep GIPHY identity/embed/attribution metadata only. API
// rendition URLs are transient search results and are not serialized into the
// comment record.
const storage = new Map();
const extensionApi = {
  storage: {
    local: {
      async get(key) {
        if (Array.isArray(key)) return Object.fromEntries(key.map((k) => [k, storage.get(k)]));
        return { [key]: storage.get(key) };
      },
      async set(values) { for (const [key, value] of Object.entries(values)) storage.set(key, value); },
      async remove(key) { storage.delete(key); }
    },
    onChanged: { addListener() {} }
  },
  runtime: { getURL: (path) => `chrome-extension://test/${path}` }
};
const sandbox = {
  console,
  browser: extensionApi,
  chrome: undefined,
  window: { dispatchEvent() {} },
  globalThis: null,
  URL,
  URLSearchParams,
  Date,
  Math,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Array,
  JSON,
  CustomEvent: class CustomEvent {},
  fetch: async () => { throw new Error("fetch should not run in this test"); }
};
sandbox.globalThis = sandbox;
vm.runInContext(integration, vm.createContext(sandbox), { filename: "giphy-integration.js" });
const cleaned = sandbox.SmartTeXGiphyIntegration.cleanAttachment({
  id: "abc_123",
  title: "Test",
  url: "https://giphy.com/gifs/abc_123",
  embedUrl: "https://giphy.com/embed/abc_123",
  username: "creator",
  userUrl: "https://giphy.com/creator",
  sourceTld: "example.org",
  sourcePostUrl: "https://example.org/post",
  width: "480",
  height: "270",
  previewUrl: "https://media.giphy.com/media/abc_123/200.gif",
  originalUrl: "https://media.giphy.com/media/abc_123/giphy.gif"
});
assert.equal(cleaned.id, "abc_123");
assert.equal(cleaned.embedUrl, "https://giphy.com/embed/abc_123");
assert.equal(Object.hasOwn(cleaned, "previewUrl"), false);
assert.equal(Object.hasOwn(cleaned, "originalUrl"), false);
assert.doesNotMatch(JSON.stringify(cleaned), /media\.giphy\.com/);
assert.equal(sandbox.SmartTeXGiphyIntegration.cleanAttachment({
  id: "abc",
  url: "https://evil.example/x",
  embedUrl: "https://giphy.com/embed/abc"
}), null);

// Search uses direct, uncached GIPHY Web API requests only after consent and
// reports the documented analytics hooks for transient results.
assert.match(integration, /api\.giphy\.com\/v1\/gifs/);
assert.match(integration, /if \(!\(await hasConsent\(\)\)\) throw/);
assert.match(integration, /cache:\s*"no-store"/);
assert.match(integration, /credentials:\s*"omit"/);
assert.match(integration, /onload:[\s\S]*onclick:[\s\S]*onsent:/);
assert.match(integration, /\/v1\/randomid/);
assert.match(integration, /customer_id:\s*customerId/);
assert.match(integration, /ping\.searchParams\.set\("customer_id", customerId\)/);
assert.match(integration, /ping\.searchParams\.set\("ts", String\(Date\.now\(\)\)\)/);
assert.match(comments, /registerGiphySend\(giphy\)/);

// GIPHY attribution is present in both the picker and each saved attachment,
// with creator/source links when the API provides them.
assert.match(comments, /Powered by GIPHY/);
assert.match(comments, /GIF by \$\{creatorLabel/);
assert.match(comments, /Source: \$\{attachment\.sourceTld\}/);
assert.match(comments, /footer\.appendChild\(giphyBrandElement\(\)\)/);
assert.match(optionsHtml, /GIPHY Developer Dashboard/);
assert.match(optionsHtml, /icons\/giphy-powered-by\.png/);

// SmartTeX ships a shared fallback key with graduated insertion/API-call usage.
// It uses 50-result pages, manual shared-key pagination, and automatic near-bottom
// pagination only when a personal key is configured.
assert.match(optionsHtml, /id="smarttex-giphy-api-key"/);
assert.match(optionsHtml, /id="smarttex-giphy-key-help"/);
assert.match(optionsHtml, /How to get your GIPHY API key/);
assert.match(options, /\[GIPHY_SETTINGS_KEY\]/);
assert.match(options, /setGiphyKeyHelpOpen/);
assert.match(options, /withdrawConsent/);
assert.match(integration, /const BUNDLED_API_KEY = "4kDYisPJ86gyWUqz7DFqYiYhk1ZBv5c2"/);
assert.match(integration, /const BUNDLED_INSERT_SOFT_PROMPT_AFTER = 5/);
assert.match(integration, /const BUNDLED_INSERT_HOURLY_HARD_LIMIT = 10/);
assert.match(integration, /const BUNDLED_API_CALL_SOFT_PROMPT_AFTER = 10/);
assert.match(integration, /const BUNDLED_API_CALL_HOURLY_HARD_LIMIT = 20/);
assert.match(integration, /const BUNDLED_TOTAL_INSERT_HARD_LIMIT = 50/);
assert.match(integration, /const GIPHY_PAGE_SIZE = 50/);
assert.match(integration, /Continue with shared key/);
assert.match(comments, /ensureGifInsertionAllowed/);
assert.match(comments, /recordGifInsertion/);
assert.match(comments, /smarttex-comment-giphy-load-more/);
assert.match(comments, /rootMargin: "0px 0px 240px 0px"/);
assert.match(comments, /loadGiphyPickerResults\(query, \{ append: true, offset: nextOffset \}\)/);

console.log("GIPHY comment integration checks passed.");
