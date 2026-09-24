const test = require("node:test");
const assert = require("node:assert/strict");
const {
  googleQuery,
  hasPhysicalFormat,
  hasPurchaseAction,
  identityVerification,
  parsePrice,
  productPageEvidence
} = require("../outputs/availability-scanner");

test("uses the exact required Google query", () => {
  assert.equal(googleQuery({ artist: "Acherontas", album: "Ta Tvam Asi (Universal Omniscience)" }), "Acherontas - Ta Tvam Asi (Universal Omniscience) buy");
});

test("requires a live purchase action", () => {
  assert.equal(hasPurchaseAction("In stock - Add to Cart"), true);
  assert.equal(hasPurchaseAction("Sold out - Add to Cart"), false);
  assert.equal(hasPurchaseAction("Price available on request"), false);
});

test("checks the selected physical format", () => {
  assert.equal(hasPhysicalFormat("Format: Compact Disc", "cd"), true);
  assert.equal(hasPhysicalFormat("Digital download only", "cd"), false);
  assert.equal(hasPhysicalFormat("Limited cassette edition", "cassette"), true);
});

test("parses seller currency and creates all display conversions", () => {
  const price = parsePrice("Price: EUR 10.00", { priceCurrency: "EUR" }, "https://vendor.example/item", { AUD: 1, USD: 1.5, GBP: 1.9, EUR: 1.6 }, "GBP");
  assert.equal(price.currency, "EUR");
  assert.equal(price.aud, 16);
  assert.equal(price.budgetCurrency, "GBP");
  assert.equal(price.budgetAmount, 8.42);
  assert.equal(price.convertedPrices.USD, 10.67);
});

test("identity validation requires a matching Discogs record", () => {
  const album = { artist: "Acherontas", album: "Tat Tvam Asi" };
  const valid = identityVerification(album, {
    results: [{ title: "Acherontas - Tat Tvam Asi", url: "https://www.discogs.com/release/1", snippet: "" }]
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.source, "Discogs");
  assert.equal(valid.sources.length, 1);

  const missing = identityVerification(album, { results: [] });
  assert.equal(missing.ok, false);
});

test("product evidence is taken from seller product content, not unrelated navigation", () => {
  const evidence = productPageEvidence(`
    <html><head><title>Acherontas - Ta Tvam Asi CD</title><meta property="og:description" content="Compact Disc"></head>
    <body><nav>Thousands of other records</nav><main><h1>Acherontas - Ta Tvam Asi</h1><p>Format: CD</p></main></body></html>`);
  assert.match(evidence, /Acherontas - Ta Tvam Asi/);
  assert.match(evidence, /Format: CD/);
  assert.equal(evidence.includes("Thousands of other records"), false);
});
