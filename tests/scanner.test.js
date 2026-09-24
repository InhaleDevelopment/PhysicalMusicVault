const test = require("node:test");
const assert = require("node:assert/strict");
const {
  googleQuery,
  deliveryEvidence,
  hasPhysicalFormat,
  hasSelectedFormat,
  hasPurchaseAction,
  identityVerification,
  parsePrice,
  marketEligibility,
  productPageEvidence
} = require("../outputs/availability-scanner");

test("uses the exact required Google query", () => {
  assert.equal(googleQuery({ artist: "Acherontas", album: "Ta Tvam Asi (Universal Omniscience)" }), "Acherontas - Ta Tvam Asi (Universal Omniscience) cd buy");
  assert.equal(googleQuery({ artist: "Acherontas", album: "Ta Tvam Asi" }, { searchFormat: "vinyl" }), "Acherontas - Ta Tvam Asi vinyl buy");
  assert.equal(googleQuery({ artist: "Acherontas", album: "Ta Tvam Asi" }, { searchFormat: "cassette" }), "Acherontas - Ta Tvam Asi cassette OR tape buy");
  assert.equal(
    googleQuery({ artist: "Acherontas", album: "Ta Tvam Asi" }, { searchFormat: "cd", marketScope: "country", marketCountry: "AU" }),
    "Acherontas - Ta Tvam Asi cd buy Australia"
  );
});

test("extracts website shipping rates and confirms the selected market", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    offers: {
      shippingDetails: {
        shippingRate: { value: 7.5, currency: "USD" },
        shippingDestination: { addressCountry: "AU" }
      }
    }
  })}</script><main>Ships to Australia</main>`;
  const settings = {
    marketScope: "country",
    marketCountry: "AU",
    marketRegion: "oceania",
    currency: "AUD",
    exchangeRatesToAud: { AUD: 1, USD: 1.5, GBP: 1.9, EUR: 1.6 }
  };
  const delivery = deliveryEvidence(html, "https://shop.example/item", { format: "cd", budgetCurrency: "AUD" }, settings);
  assert.equal(delivery.amount, 7.5);
  assert.equal(delivery.accuracy, "site-rate");
  assert.equal(delivery.convertedPrices.AUD, 11.25);
  assert.equal(marketEligibility(delivery, settings).accepted, true);
});

test("labels fallback delivery as an estimate", () => {
  const settings = {
    marketScope: "worldwide",
    marketCountry: "AU",
    marketRegion: "oceania",
    exchangeRatesToAud: { AUD: 1, USD: 1.5, GBP: 1.9, EUR: 1.6 }
  };
  const delivery = deliveryEvidence("<main>No shipping quote until checkout</main>", "https://shop.co.uk/item", { format: "vinyl", budgetCurrency: "AUD" }, settings);
  assert.equal(delivery.amount, 38);
  assert.equal(delivery.currency, "AUD");
  assert.equal(delivery.accuracy, "estimated");
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
  assert.equal(hasSelectedFormat("<title>Album vinyl LP</title><main>Browse CDs</main>", "https://shop.example/album-lp", "cd"), false);
  assert.equal(hasSelectedFormat("<title>Album digipak CD</title><main>Add to cart</main>", "https://shop.example/album-cd", "cd"), true);
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
