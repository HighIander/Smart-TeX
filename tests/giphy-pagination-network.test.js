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
    sendMessage: async () => ({ ok: true }),
    openOptionsPage: async () => {}
  }
};

function gif(index) {
  return {
    id: `gif-${index}`,
    title: `GIF ${index}`,
    url: `https://giphy.com/gifs/gif-${index}`,
    embed_url: `https://giphy.com/embed/gif-${index}`,
    images: {
      fixed_width: { url: `https://media.giphy.com/media/gif-${index}/200.gif`, width: "200", height: "120" },
      original: { url: `https://media.giphy.com/media/gif-${index}/giphy.gif`, width: "500", height: "300" }
    }
  };
}

async function fakeFetch(input) {
  const url = new URL(String(input));
  fetchCalls.push(url);
  if (url.pathname === "/v1/randomid") {
    return { ok: true, status: 200, async json() { return { data: { random_id: "shared_customer_id" } }; } };
  }
  if (url.pathname === "/v1/gifs/search") {
    const offset = Number(url.searchParams.get("offset"));
    const data = Array.from({ length: 50 }, (_, i) => gif(offset + i));
    return {
      ok: true,
      status: 200,
      async json() {
        return { meta: { status: 200 }, data, pagination: { offset, count: 50, total_count: 175 } };
      }
    };
  }
  throw new Error(`Unexpected fetch: ${url.href}`);
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
  await api.acceptConsent();

  const first = await api.search("cats", { offset: 0 });
  assert.equal(first.length, 50);
  assert.equal(first.pageSize, 50);
  assert.equal(first.usesBundledKey, true);
  assert.equal(first.pagination.nextOffset, 50);
  assert.equal(first.pagination.hasMore, true);

  const second = await api.search("cats", { offset: first.pagination.nextOffset });
  assert.equal(second.length, 50);
  assert.equal(second.pagination.offset, 50);
  assert.equal(second.pagination.nextOffset, 100);

  const contentCalls = fetchCalls.filter((url) => url.pathname === "/v1/gifs/search");
  assert.equal(contentCalls.length, 2);
  assert.equal(contentCalls[0].searchParams.get("limit"), "50");
  assert.equal(contentCalls[0].searchParams.get("offset"), "0");
  assert.equal(contentCalls[1].searchParams.get("limit"), "50");
  assert.equal(contentCalls[1].searchParams.get("offset"), "50");

  const usage = await api.bundledUsageState();
  assert.equal(usage.apiCallCount, 2, "Each shared-key Search/Trending page request counts once.");
  assert.equal(usage.insertionCount, 0);

  console.log("GIPHY 50-result pagination network checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
