const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendPriceHistory,
  normalisePurchase,
  normaliseSmartCollection,
  normaliseSmartCollections,
  purchaseTotalInCurrency
} = require("../outputs/intelligence-model");

const settings = {
  timeZone: "Australia/Sydney",
  exchangeRatesToAud: { AUD: 1, USD: 1.5, GBP: 1.9, EUR: 1.65 }
};

function albumWithPrice(audPrice, observedAt) {
  return {
    id: "artist-album",
    artist: "Artist",
    album: "Album",
    format: "cd",
    listings: [{
      url: "https://seller.example/artist-album",
      marketplace: "Seller",
      audPrice,
      deliveryConvertedPrices: { AUD: 5 },
      lastVerifiedAt: observedAt
    }]
  };
}

test("price history keeps daily observations and immediate price changes", () => {
  let history = appendPriceHistory([], [albumWithPrice(20, "2026-09-01T01:00:00Z")], settings);
  assert.equal(history.length, 1);
  assert.equal(history[0].audTotal, 25);

  history = appendPriceHistory(history, [albumWithPrice(20, "2026-09-01T04:00:00Z")], settings);
  assert.equal(history.length, 1);

  history = appendPriceHistory(history, [albumWithPrice(18, "2026-09-01T05:00:00Z")], settings);
  assert.equal(history.length, 2);
  assert.equal(history[1].audTotal, 23);

  history = appendPriceHistory(history, [albumWithPrice(18, "2026-09-02T05:00:00Z")], settings);
  assert.equal(history.length, 3);
});

test("smart collections provide useful defaults and bounded rules", () => {
  const defaults = normaliseSmartCollections(undefined);
  assert.equal(defaults.length, 3);
  assert.equal(defaults[0].id, "priority-five-available");

  const collection = normaliseSmartCollection({
    id: "vinyl-under-50",
    name: "Vinyl under 50",
    rules: {
      status: "wanted",
      availability: "available",
      minPriority: 9,
      format: "vinyl",
      priceMode: "under",
      maxPrice: "49.95",
      currency: "AUD",
      foundWithinDays: 30
    }
  });
  assert.equal(collection.rules.minPriority, 5);
  assert.equal(collection.rules.maxPrice, 49.95);
  assert.equal(collection.rules.format, "vinyl");
});

test("purchase ledger records delivered total and converts currencies", () => {
  const album = { id: "artist-album", artist: "Artist", album: "Album", format: "vinyl" };
  const purchase = normalisePurchase({
    id: "purchase-1",
    itemCost: "20.00",
    deliveryCost: "5.50",
    currency: "USD",
    purchaseDate: "2026-09-27",
    seller: "Shop",
    orderStatus: "received"
  }, {}, album, new Date("2026-09-27T10:00:00Z"));

  assert.equal(purchase.totalCost, 25.5);
  assert.equal(purchase.format, "vinyl");
  assert.equal(purchaseTotalInCurrency(purchase, "AUD", settings.exchangeRatesToAud), 38.25);
  assert.throws(() => normalisePurchase({ itemCost: 10 }, {}, {}), /Choose an album/);
});
