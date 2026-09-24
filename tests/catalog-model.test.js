const test = require("node:test");
const assert = require("node:assert/strict");
const {
  albumPriority,
  albumStatus,
  convertCurrency,
  isKnownDigitalOnlyUrl,
  isSearchEligible,
  normaliseAlbum,
  normaliseFormat
} = require("../outputs/catalog-model");

test("normalises the three catalogue statuses and legacy priority", () => {
  assert.equal(albumStatus({ status: "owned" }), "owned");
  assert.equal(albumStatus({ status: "not interested" }), "excluded");
  assert.equal(albumStatus({ status: "most-wanted" }), "wanted");
  assert.equal(albumPriority({ status: "most-wanted" }), 5);
});

test("search eligibility requires a present Wanted album", () => {
  assert.equal(isSearchEligible({ status: "wanted", missing: false }), true);
  assert.equal(isSearchEligible({ status: "owned", missing: false }), false);
  assert.equal(isSearchEligible({ status: "excluded", missing: false }), false);
  assert.equal(isSearchEligible({ status: "wanted", missing: true }), false);
});

test("normalises priority, currency and price limits", () => {
  const album = normaliseAlbum({ status: "wanted", priority: 9, format: "CD", budgetCurrency: "gbp", minPrice: "$5", maxPrice: "20.50" });
  assert.equal(album.priority, 5);
  assert.equal(album.format, "cd");
  assert.equal(album.budgetCurrency, "GBP");
  assert.equal(album.minPrice, 5);
  assert.equal(album.maxPrice, 20.5);
});

test("only supports CD, vinyl and cassette as target formats", () => {
  assert.equal(normaliseFormat("Compact Disc"), "cd");
  assert.equal(normaliseFormat("LP"), "vinyl");
  assert.equal(normaliseFormat("tape"), "cassette");
  assert.equal(normaliseFormat("box set"), "cd");
});

test("converts through AUD reference rates", () => {
  const rates = { AUD: 1, USD: 1.5, GBP: 1.9, EUR: 1.6 };
  assert.equal(convertCurrency(10, "USD", "AUD", rates), 15);
  assert.equal(convertCurrency(10, "USD", "EUR", rates), 9.38);
});

test("recognises digital-only storefronts as non-physical sources", () => {
  assert.equal(isKnownDigitalOnlyUrl("https://www.qobuz.com/album/example"), true);
  assert.equal(isKnownDigitalOnlyUrl("https://music.apple.com/album/example"), true);
  assert.equal(isKnownDigitalOnlyUrl("https://www.discogs.com/sell/item/123"), false);
  assert.equal(isKnownDigitalOnlyUrl("https://artist.bandcamp.com/album/example"), false);
});
