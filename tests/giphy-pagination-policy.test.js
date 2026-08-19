const assert = require("node:assert/strict");
const fs = require("node:fs");

const integration = fs.readFileSync("giphy-integration.js", "utf8");
const comments = fs.readFileSync("comments.js", "utf8");
const css = fs.readFileSync("content.css", "utf8");

assert.match(integration, /const GIPHY_PAGE_SIZE = 50/);
assert.match(integration, /const GIPHY_MAX_OFFSET = 4999/);
assert.match(integration, /limit: String\(GIPHY_PAGE_SIZE\)/);
assert.match(integration, /offset: String\(pageOffset\)/);
assert.match(integration, /results\.pagination = Object\.freeze/);
assert.match(integration, /results\.usesBundledKey = usesBundledKey/);
assert.match(integration, /if \(usesBundledKey\) await recordApiCall\(\)/);

assert.match(comments, /button\.textContent = "Load more"/);
assert.match(comments, /usesBundledKey \|\| typeof IntersectionObserver !== "function"/);
assert.match(comments, /giphyPaginationObserver = new IntersectionObserver/);
assert.match(comments, /rootMargin: "0px 0px 240px 0px"/);
assert.match(comments, /renderGiphyPickerResults\(results \|\| \[\], \{ append \}\)/);
assert.match(css, /\.smarttex-comment-giphy-pagination/);
assert.match(css, /\.smarttex-comment-giphy-load-more/);
assert.match(comments, /smarttex-comment-giphy-pagination-spinner/);
assert.match(comments, /setGiphyPaginationLoading\(true\)/);
assert.match(comments, /setGiphyPaginationLoading\(false\)/);
assert.match(css, /\.smarttex-comment-giphy-pagination-spinner/);


console.log("GIPHY pagination policy checks passed.");
