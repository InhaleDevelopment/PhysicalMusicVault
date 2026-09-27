const {
  convertCurrency,
  normaliseCurrency,
  normaliseFormat,
  normaliseStatus,
  parseMoney
} = require("./catalog-model");

const MAX_PRICE_HISTORY = 20000;
const MAX_SMART_COLLECTIONS = 40;
const MAX_PURCHASES = 10000;

const DEFAULT_SMART_COLLECTIONS = Object.freeze([
  {
    id: "priority-five-available",
    name: "Priority 5 available",
    description: "Essential Wanted albums with a verified seller listing.",
    rules: { status: "wanted", availability: "available", minPriority: 5, format: "any", priceMode: "any", currency: "AUD", foundWithinDays: 0 }
  },
  {
    id: "inside-my-budget",
    name: "Inside my price range",
    description: "Wanted albums whose delivered price is inside the album budget.",
    rules: { status: "wanted", availability: "available", minPriority: 1, format: "any", priceMode: "within-budget", currency: "AUD", foundWithinDays: 0 }
  },
  {
    id: "recently-found",
    name: "Recently found",
    description: "Wanted albums with a verified listing found in the last 30 days.",
    rules: { status: "wanted", availability: "available", minPriority: 1, format: "any", priceMode: "any", currency: "AUD", foundWithinDays: 30 }
  }
]);

function cleanText(value, maximum = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function safeHttpUrl(value) {
  const url = cleanText(value, 2000);
  return /^https?:\/\//i.test(url) ? url : "";
}

function validIsoDate(value, fallback = "") {
  const text = cleanText(value, 100);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : fallback;
}

function localDateKey(value, timeZone = "UTC") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function amountInAud(amount, currency, ratesToAud) {
  const numeric = parseMoney(amount);
  if (numeric === null) return null;
  return convertCurrency(numeric, normaliseCurrency(currency), "AUD", ratesToAud);
}

function listingAmountsInAud(listing = {}, settings = {}) {
  const rates = settings.exchangeRatesToAud || { AUD: 1, USD: 1.52, EUR: 1.65, GBP: 1.95 };
  const originalCurrency = normaliseCurrency(listing.originalCurrency || listing.currency || listing.budgetCurrency || "AUD");
  const item = parseMoney(listing.audPrice ?? listing.convertedPrices?.AUD)
    ?? amountInAud(listing.originalAmount ?? listing.currentCost ?? listing.price, originalCurrency, rates);
  const deliveryCurrency = normaliseCurrency(listing.deliveryCurrency || originalCurrency);
  const delivery = parseMoney(listing.deliveryConvertedPrices?.AUD)
    ?? amountInAud(listing.deliveryCost, deliveryCurrency, rates)
    ?? 0;
  const delivered = parseMoney(listing.deliveredConvertedPrices?.AUD)
    ?? (item === null ? null : Number((item + delivery).toFixed(2)));
  return {
    item: item === null ? null : Number(item.toFixed(2)),
    delivery: Number(delivery.toFixed(2)),
    delivered: delivered === null ? null : Number(delivered.toFixed(2)),
    originalAmount: parseMoney(listing.originalAmount ?? listing.currentCost ?? listing.price),
    originalCurrency
  };
}

function priceObservationFromListing(album = {}, listing = {}, settings = {}, observedAt = new Date().toISOString()) {
  const amounts = listingAmountsInAud(listing, settings);
  const url = safeHttpUrl(listing.url || listing.directUrl || listing.purchaseUrl);
  if (!album.id || !url || amounts.item === null) return null;
  const timestamp = validIsoDate(
    listing.lastVerifiedAt || listing.listingFoundAt || observedAt,
    observedAt
  );
  return {
    albumId: cleanText(album.id, 300),
    artist: cleanText(album.artist, 500),
    album: cleanText(album.album, 500),
    format: normaliseFormat(listing.format || album.format || "cd"),
    seller: cleanText(listing.marketplace || listing.host || listing.seller || "Seller", 300),
    listingUrl: url,
    observedAt: timestamp,
    audItem: amounts.item,
    audDelivery: amounts.delivery,
    audTotal: amounts.delivered,
    originalAmount: amounts.originalAmount,
    originalCurrency: amounts.originalCurrency,
    deliveryAccuracy: ["exact", "estimated", "free"].includes(listing.deliveryAccuracy) ? listing.deliveryAccuracy : ""
  };
}

function normalisePriceObservation(value = {}) {
  const audItem = parseMoney(value.audItem);
  const listingUrl = safeHttpUrl(value.listingUrl);
  const observedAt = validIsoDate(value.observedAt);
  if (!value.albumId || !listingUrl || !observedAt || audItem === null) return null;
  const audDelivery = parseMoney(value.audDelivery) ?? 0;
  return {
    albumId: cleanText(value.albumId, 300),
    artist: cleanText(value.artist, 500),
    album: cleanText(value.album, 500),
    format: normaliseFormat(value.format || "cd"),
    seller: cleanText(value.seller || "Seller", 300),
    listingUrl,
    observedAt,
    audItem,
    audDelivery,
    audTotal: parseMoney(value.audTotal) ?? Number((audItem + audDelivery).toFixed(2)),
    originalAmount: parseMoney(value.originalAmount),
    originalCurrency: normaliseCurrency(value.originalCurrency || "AUD"),
    deliveryAccuracy: ["exact", "estimated", "free"].includes(value.deliveryAccuracy) ? value.deliveryAccuracy : ""
  };
}

function appendPriceHistory(history, albums, settings = {}) {
  const existing = (Array.isArray(history) ? history : [])
    .map(normalisePriceObservation)
    .filter(Boolean)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const byListing = new Map();
  for (const row of existing) byListing.set(`${row.albumId}\n${row.listingUrl}`, row);
  for (const album of albums || []) {
    for (const listing of album.listings || []) {
      const row = priceObservationFromListing(album, listing, settings);
      if (!row) continue;
      const key = `${row.albumId}\n${row.listingUrl}`;
      const previous = byListing.get(key);
      const sameDay = previous && localDateKey(previous.observedAt, settings.timeZone) === localDateKey(row.observedAt, settings.timeZone);
      const samePrice = previous && Number(previous.audTotal) === Number(row.audTotal);
      if (previous && sameDay && samePrice) continue;
      if (previous && previous.observedAt === row.observedAt && samePrice) continue;
      existing.push(row);
      byListing.set(key, row);
    }
  }
  return existing
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .slice(-MAX_PRICE_HISTORY);
}

function normaliseSmartCollection(value = {}, existing = {}) {
  const rules = { ...(existing.rules || {}), ...(value.rules || {}) };
  const status = ["all", "wanted", "owned", "excluded"].includes(rules.status) ? rules.status : "all";
  const availability = ["any", "available", "unavailable"].includes(rules.availability) ? rules.availability : "any";
  const format = ["any", "cd", "vinyl", "cassette"].includes(rules.format) ? rules.format : "any";
  const priceMode = ["any", "within-budget", "under"].includes(rules.priceMode) ? rules.priceMode : "any";
  const foundWithinDays = Math.max(0, Math.min(3650, Math.round(Number(rules.foundWithinDays) || 0)));
  return {
    ...existing,
    id: cleanText(value.id || existing.id, 100),
    name: cleanText(value.name ?? existing.name, 80),
    description: cleanText(value.description ?? existing.description, 240),
    rules: {
      status,
      availability,
      minPriority: Math.max(1, Math.min(5, Math.round(Number(rules.minPriority) || 1))),
      format,
      priceMode,
      maxPrice: parseMoney(rules.maxPrice),
      currency: normaliseCurrency(rules.currency || "AUD"),
      foundWithinDays
    },
    createdAt: existing.createdAt || validIsoDate(value.createdAt) || new Date().toISOString(),
    updatedAt: validIsoDate(value.updatedAt) || new Date().toISOString()
  };
}

function normaliseSmartCollections(value) {
  const source = Array.isArray(value) ? value : DEFAULT_SMART_COLLECTIONS;
  return source
    .map(item => normaliseSmartCollection(item))
    .filter(item => item.id && item.name)
    .slice(0, MAX_SMART_COLLECTIONS);
}

function normalisePurchase(value = {}, existing = {}, album = {}, now = new Date()) {
  if (!album.id || !album.artist || !album.album) throw new Error("Choose an album from the collection.");
  const itemCost = parseMoney(value.itemCost ?? existing.itemCost);
  if (itemCost === null) throw new Error("Enter the item price.");
  const deliveryCost = parseMoney(value.deliveryCost ?? existing.deliveryCost) ?? 0;
  const purchaseDate = cleanText(value.purchaseDate || existing.purchaseDate || now.toISOString().slice(0, 10), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || !Number.isFinite(Date.parse(`${purchaseDate}T00:00:00Z`))) {
    throw new Error("Enter a valid purchase date.");
  }
  const condition = ["new", "sealed", "mint", "near-mint", "very-good", "good", "unknown"].includes(value.condition)
    ? value.condition
    : existing.condition || "unknown";
  const orderStatus = ["ordered", "shipped", "received", "cancelled"].includes(value.orderStatus)
    ? value.orderStatus
    : existing.orderStatus || "ordered";
  const timestamp = now.toISOString();
  return {
    ...existing,
    id: cleanText(value.id || existing.id, 100),
    albumId: album.id,
    artist: cleanText(album.artist, 500),
    album: cleanText(album.album, 500),
    format: normaliseFormat(value.format || existing.format || album.format || "cd"),
    seller: cleanText(value.seller ?? existing.seller, 200),
    itemCost,
    deliveryCost,
    totalCost: Number((itemCost + deliveryCost).toFixed(2)),
    currency: normaliseCurrency(value.currency || existing.currency || "AUD"),
    purchaseDate,
    condition,
    orderStatus,
    purchaseUrl: safeHttpUrl(value.purchaseUrl ?? existing.purchaseUrl),
    notes: cleanText(value.notes ?? existing.notes, 2000),
    createdAt: existing.createdAt || timestamp,
    updatedAt: timestamp
  };
}

function normalisePurchases(value, albums = []) {
  const byId = new Map((albums || []).map(album => [album.id, album]));
  return (Array.isArray(value) ? value : []).flatMap(item => {
    try {
      const album = byId.get(item.albumId) || { id: item.albumId, artist: item.artist, album: item.album, format: item.format };
      return item.id ? [normalisePurchase(item, item, album, new Date(item.updatedAt || item.createdAt || Date.now()))] : [];
    } catch {
      return [];
    }
  }).slice(0, MAX_PURCHASES);
}

function purchaseTotalInCurrency(purchase, currency, ratesToAud) {
  return convertCurrency(purchase.totalCost, purchase.currency, currency, ratesToAud);
}

module.exports = {
  DEFAULT_SMART_COLLECTIONS,
  MAX_PRICE_HISTORY,
  MAX_PURCHASES,
  MAX_SMART_COLLECTIONS,
  appendPriceHistory,
  listingAmountsInAud,
  localDateKey,
  normalisePriceObservation,
  normalisePurchase,
  normalisePurchases,
  normaliseSmartCollection,
  normaliseSmartCollections,
  priceObservationFromListing,
  purchaseTotalInCurrency
};
