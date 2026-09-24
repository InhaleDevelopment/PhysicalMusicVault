const test = require("node:test");
const assert = require("node:assert/strict");
const { directResultUrl, parseBingHtml, parseDuckDuckGoHtml } = require("../outputs/web-search");

test("extracts direct seller URLs from keyless search HTML", () => {
  const direct = "https://seller.example/artist/album";
  const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(direct)}">Artist - Album CD</a><a class="result__snippet">In stock</a></div>`;
  assert.equal(parseDuckDuckGoHtml(html)[0].url, direct);
});

test("decodes search redirect URLs and leaves direct URLs intact", () => {
  assert.equal(directResultUrl("https://example.com/item"), "https://example.com/item");
  assert.equal(directResultUrl(`https://duckduckgo.com/l/?uddg=${encodeURIComponent("https://vendor.test/release")}`), "https://vendor.test/release");
});

test("extracts direct links from fallback search HTML", () => {
  const html = `<li class="b_algo"><h2><a href="https://seller.example/item">Artist Album CD</a></h2><div class="b_caption"><p>In stock now</p></div></li>`;
  assert.deepEqual(parseBingHtml(html)[0], {
    title: "Artist Album CD",
    url: "https://seller.example/item",
    snippet: "In stock now",
    rank: 1,
    engine: "Bing"
  });
});
