const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("giphy-integration.js", "utf8");
const storage = new Map();
const extensionApi = {
  storage: {
    local: {
      async get(key) {
        if (Array.isArray(key)) return Object.fromEntries(key.map((entry) => [entry, storage.get(entry)]));
        return { [key]: storage.get(key) };
      },
      async set(values) { for (const [key, value] of Object.entries(values)) storage.set(key, value); },
      async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) storage.delete(key); }
    },
    onChanged: { addListener() {} }
  },
  runtime: {
    getURL: (path) => `chrome-extension://smarttex/${path}`,
    openOptionsPage: async () => {},
    sendMessage: async () => ({ ok: true })
  }
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
  Promise,
  setTimeout,
  clearTimeout,
  CustomEvent: class CustomEvent {},
  fetch: async () => { throw new Error("No network request expected in quota test"); }
};
sandbox.globalThis = sandbox;
vm.runInContext(source, vm.createContext(sandbox), { filename: "giphy-integration.js" });

(async () => {
  const api = sandbox.SmartTeXGiphyIntegration;
  const effective = await api.effectiveApiKey();
  assert.equal(effective.apiKey, "4kDYisPJ86gyWUqz7DFqYiYhk1ZBv5c2");
  assert.equal(effective.usesBundledKey, true);
  assert.equal(api.BUNDLED_INSERT_SOFT_PROMPT_AFTER, 5);
  assert.equal(api.BUNDLED_INSERT_HOURLY_HARD_LIMIT, 10);
  assert.equal(api.BUNDLED_API_CALL_SOFT_PROMPT_AFTER, 10);
  assert.equal(api.BUNDLED_API_CALL_HOURLY_HARD_LIMIT, 20);
  assert.equal(api.BUNDLED_TOTAL_INSERT_HARD_LIMIT, 50);
  assert.equal(api.GIPHY_PAGE_SIZE, 50);

  const base = 1_800_000_000_000;

  // Insertions 1-5 are silent. Before insertion 6 the insertion-specific soft prompt applies.
  for (let i = 0; i < 5; i += 1) {
    const before = await api.bundledUsageState(base + i * 1000);
    assert.equal(before.requiresPersonalKey, false);
    assert.equal(await api.ensureGifInsertionAllowed({ prompt: false, now: base + i * 1000 }), true);
    await api.recordGifInsertion(base + i * 1000);
  }
  let state = await api.bundledUsageState(base + 5_000);
  assert.equal(state.insertionCount, 5);
  assert.equal(state.shouldSuggestPersonalKey, true);
  assert.equal(state.requiresPersonalKey, false);
  assert.equal(await api.ensureGifInsertionAllowed({ prompt: false, now: base + 5_000 }), true);

  // API calls 1-10 are allowed. Before call 11 the API-call-specific soft prompt applies.
  for (let i = 0; i < 10; i += 1) {
    assert.equal(await api.ensureApiCallAllowed({ prompt: false, now: base + 10_000 + i * 1000 }), true);
    await api.recordApiCall(base + 10_000 + i * 1000);
  }
  state = await api.bundledUsageState(base + 20_000);
  assert.equal(state.apiCallCount, 10);
  assert.equal(state.requiresPersonalKey, false);
  assert.equal(await api.ensureApiCallAllowed({ prompt: false, now: base + 20_000 }), true);

  // The 10th insertion itself is allowed; insertion 11 is blocked.
  for (let i = 5; i < 10; i += 1) {
    const t = base + 21_000 + (i - 5) * 1000;
    assert.equal(await api.ensureGifInsertionAllowed({ prompt: false, now: t }), true);
    await api.recordGifInsertion(t);
  }
  state = await api.bundledUsageState(base + 30_000);
  assert.equal(state.insertionCount, 10);
  assert.equal(state.requiresPersonalKey, true);
  assert.equal(await api.ensureGifInsertionAllowed({ prompt: false, now: base + 30_000 }), false);

  // Let the insertion window expire, then exercise the API-call hard limit independently.
  const apiWindowBase = base + api.BUNDLED_USAGE_WINDOW_MS + 60_000;
  for (let i = 0; i < 20; i += 1) {
    const t = apiWindowBase + i * 1000;
    assert.equal(await api.ensureApiCallAllowed({ prompt: false, now: t }), true);
    await api.recordApiCall(t);
  }
  state = await api.bundledUsageState(apiWindowBase + 21_000);
  assert.equal(state.apiCallCount, 20);
  assert.equal(state.requiresPersonalKey, true);
  assert.equal(await api.ensureApiCallAllowed({ prompt: false, now: apiWindowBase + 21_000 }), false);

  // After the hourly windows expire, total insertions still accumulate toward 50.
  let t = apiWindowBase + api.BUNDLED_USAGE_WINDOW_MS + 60_000;
  state = await api.bundledUsageState(t);
  assert.equal(state.insertionCount, 0);
  assert.equal(state.apiCallCount, 0);
  assert.equal(state.totalInsertions, 10);
  for (let i = 0; i < 40; i += 1) {
    assert.equal(await api.ensureGifInsertionAllowed({ prompt: false, now: t }), true);
    await api.recordGifInsertion(t);
    t += api.BUNDLED_USAGE_WINDOW_MS + 1000;
  }
  state = await api.bundledUsageState(t);
  assert.equal(state.totalInsertions, 50);
  assert.equal(state.requiresPersonalKey, true);
  assert.equal(await api.ensureGifInsertionAllowed({ prompt: false, now: t }), false);
  assert.equal(await api.ensureApiCallAllowed({ prompt: false, now: t }), false,
    "A hard shared-key threshold blocks any further shared-key GIPHY use.");

  // A personal key bypasses SmartTeX's shared-key policy entirely.
  await api.saveSettings({ apiKey: "personal-test-key" });
  const personal = await api.effectiveApiKey();
  assert.equal(personal.apiKey, "personal-test-key");
  assert.equal(personal.usesBundledKey, false);
  const personalState = await api.bundledUsageState(t);
  assert.equal(personalState.allowed, true);
  assert.equal(personalState.usesBundledKey, false);
  assert.equal(await api.ensureApiCallAllowed({ prompt: false, now: t }), true);

  console.log("GIPHY bundled-key insertion/API-call quota checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
