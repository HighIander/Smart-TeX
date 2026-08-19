const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("giphy-integration.js", "utf8");
const storage = new Map();
const fetchCalls = [];

const extensionApi = {
  storage: {
    local: {
      async get(key) {
        if (Array.isArray(key)) {
          return Object.fromEntries(key.map((entry) => [entry, storage.get(entry)]));
        }
        return { [key]: storage.get(key) };
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) storage.set(key, value);
      },
      async remove(keys) {
        for (const key of (Array.isArray(keys) ? keys : [keys])) storage.delete(key);
      }
    },
    onChanged: { addListener() {} }
  },
  runtime: {
    getURL: (path) => `chrome-extension://smarttex/${path}`,
    sendMessage: async () => ({ ok: true }),
    openOptionsPage: async () => {}
  }
};

let randomIdCounter = 0;
async function fakeFetch(input, options = {}) {
  const url = String(input);
  fetchCalls.push({ url, options });
  if (url.startsWith("https://api.giphy.com/v1/randomid?")) {
    randomIdCounter += 1;
    return {
      ok: true,
      status: 200,
      async json() { return { data: { random_id: `random_customer_${randomIdCounter}` } }; }
    };
  }
  if (url.startsWith("https://api.giphy.com/v1/gifs/search?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          meta: { status: 200 },
          data: [{
            id: "abc123",
            title: "Test GIF",
            url: "https://giphy.com/gifs/abc123",
            embed_url: "https://giphy.com/embed/abc123",
            username: "artist",
            source_tld: "example.org",
            source_post_url: "https://example.org/post",
            images: {
              fixed_width: { url: "https://media.giphy.com/media/abc123/200.gif", width: "200", height: "120" },
              original: { url: "https://media.giphy.com/media/abc123/giphy.gif", width: "500", height: "300" }
            },
            analytics: {
              onload: { url: "https://giphy-analytics.giphy.com/v2/pingback_simple?event=view" },
              onclick: { url: "https://giphy-analytics.giphy.com/v2/pingback_simple?event=click" },
              onsent: { url: "https://giphy-analytics.giphy.com/v2/pingback_simple?event=send" }
            }
          }]
        };
      }
    };
  }
  if (url.startsWith("https://api.giphy.com/v1/gifs/trending?")) {
    return { ok: true, status: 200, async json() { return { meta: { status: 200 }, data: [] }; } };
  }
  if (url.startsWith("https://giphy-analytics.giphy.com/")) {
    return { ok: true, status: 200, async json() { return {}; } };
  }
  throw new Error(`Unexpected fetch: ${url}`);
}

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
  fetch: fakeFetch
};
sandbox.globalThis = sandbox;
vm.runInContext(source, vm.createContext(sandbox), { filename: "giphy-integration.js" });

(async () => {
  const api = sandbox.SmartTeXGiphyIntegration;
  await api.saveSettings({ apiKey: "test-api-key" });

  await assert.rejects(() => api.search("cats"), /consent is required/i);
  assert.equal(fetchCalls.length, 0, "No GIPHY network request may occur before consent.");

  await api.acceptConsent();
  const results = await api.search("cats", { limit: 18 });
  assert.equal(results.length, 1);
  assert.equal(results[0].attachment.id, "abc123");
  assert.equal(results[0].previewUrl, "https://media.giphy.com/media/abc123/200.gif");

  assert.equal(fetchCalls.length, 2, "First search should obtain a random customer ID, then search.");
  const randomRequest = new URL(fetchCalls[0].url);
  assert.equal(randomRequest.pathname, "/v1/randomid");
  assert.equal(randomRequest.searchParams.get("api_key"), "test-api-key");
  const searchRequest = new URL(fetchCalls[1].url);
  assert.equal(searchRequest.pathname, "/v1/gifs/search");
  assert.equal(searchRequest.searchParams.get("q"), "cats");
  assert.equal(searchRequest.searchParams.get("customer_id"), "random_customer_1");
  assert.equal(searchRequest.searchParams.get("bundle"), "messaging_non_clips");
  assert.equal(fetchCalls[1].options.cache, "no-store");
  assert.equal(fetchCalls[1].options.credentials, "omit");

  await api.search("dogs");
  assert.equal(fetchCalls.filter((entry) => entry.url.includes("/v1/randomid?")).length, 1,
    "The random GIPHY customer ID should be reused locally after consent.");

  api.pingAnalytics(results[0].analytics.onsent);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const analyticsRequest = fetchCalls.map((entry) => entry.url)
    .findLast((url) => url.startsWith("https://giphy-analytics.giphy.com/"));
  assert.ok(analyticsRequest, "GIPHY action analytics should be sent after consent.");
  const analyticsUrl = new URL(analyticsRequest);
  assert.equal(analyticsUrl.searchParams.get("customer_id"), "random_customer_1");
  assert.match(analyticsUrl.searchParams.get("ts") || "", /^\d{10,}$/);

  const beforeWithdraw = fetchCalls.length;
  await api.withdrawConsent();
  assert.equal(storage.has(api.CONSENT_KEY), false);
  assert.equal(storage.has(api.CLIENT_ID_KEY), false);
  api.pingAnalytics(results[0].analytics.onclick);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fetchCalls.length, beforeWithdraw, "Analytics must stop after consent withdrawal.");

  console.log("GIPHY consent, random customer ID, search, and analytics network checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
