const STATUSES = Object.freeze({
  WANTED: "wanted",
  OWNED: "owned",
  EXCLUDED: "excluded"
});

const CURRENCIES = Object.freeze(["AUD", "USD", "GBP", "EUR"]);
const FORMATS = Object.freeze(["cd", "vinyl", "cassette"]);

const DIGITAL_ONLY_HOSTS = Object.freeze([
  "7digital.com",
  "beatport.com",
  "deezer.com",
  "hdtracks.com",
  "junodownload.com",
  "music.apple.com",
  "prostudiomasters.com",
  "qobuz.com",
  "spotify.com",
  "tidal.com"
]);

function clampPriority(value, fallback = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function normaliseStatus(value) {
  const status = String(value || "").trim().toLowerCase().replace(/[ _]+/g, "-");
  if (status === "owned") return STATUSES.OWNED;
  if (["excluded", "ignore", "ignored", "not-interested", "not-wanted", "skip"].includes(status)) {
    return STATUSES.EXCLUDED;
  }
  return STATUSES.WANTED;
}

function albumPriority(album) {
  if (String(album?.status || "").toLowerCase() === "most-wanted") return 5;
  return clampPriority(album?.priority, 3);
}

function albumStatus(album) {
  return normaliseStatus(album?.status);
}

function isSearchEligible(album) {
  return Boolean(album && !album.missing && albumStatus(album) === STATUSES.WANTED);
}

function normaliseCurrency(value, fallback = "AUD") {
  const currency = String(value || "").trim().toUpperCase();
  return CURRENCIES.includes(currency) ? currency : fallback;
}

function normaliseFormat(value, fallback = "cd") {
  const format = String(value || "").trim().toLowerCase();
  if (format === "compact disc") return "cd";
  if (["lp", "record"].includes(format)) return "vinyl";
  if (format === "tape") return "cassette";
  return FORMATS.includes(format) ? format : fallback;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function convertCurrency(amount, fromCurrency, toCurrency, ratesToAud) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  const from = normaliseCurrency(fromCurrency);
  const to = normaliseCurrency(toCurrency);
  const fromRate = Number(ratesToAud?.[from]);
  const toRate = Number(ratesToAud?.[to]);
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) return null;
  return Number(((numeric * fromRate) / toRate).toFixed(2));
}

function normaliseAlbum(album = {}) {
  const legacyMostWanted = String(album.status || "").toLowerCase() === "most-wanted";
  const status = normaliseStatus(album.status);
  return {
    ...album,
    status,
    priority: legacyMostWanted ? 5 : albumPriority(album),
    format: normaliseFormat(album.format),
    budgetCurrency: normaliseCurrency(album.budgetCurrency || album.priceCurrency || album.currency || "AUD"),
    minPrice: parseMoney(album.minPrice ?? album.priceMin),
    maxPrice: parseMoney(album.maxPrice ?? album.priceMax ?? album.targetPrice)
  };
}

function isKnownDigitalOnlyUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
    return DIGITAL_ONLY_HOSTS.some(blocked => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

function compareScanPriority(a, b) {
  const priorityDiff = albumPriority(b) - albumPriority(a);
  if (priorityDiff) return priorityDiff;
  const scanDiff = String(a.lastAvailabilityScanAt || "").localeCompare(String(b.lastAvailabilityScanAt || ""));
  return scanDiff
    || String(a.artist || "").localeCompare(String(b.artist || ""))
    || String(a.album || "").localeCompare(String(b.album || ""));
}

function listingTimestamp(listing) {
  return listing?.lastVerifiedAt || listing?.listingFoundAt || listing?.availableAt || listing?.lastChecked || "";
}

function compareAvailableAlbums(a, b) {
  const priorityDiff = albumPriority(b.album) - albumPriority(a.album);
  if (priorityDiff) return priorityDiff;
  const dateDiff = String(listingTimestamp(b.listing)).localeCompare(String(listingTimestamp(a.listing)));
  if (dateDiff) return dateDiff;
  return String(a.album?.artist || "").localeCompare(String(b.album?.artist || ""))
    || String(a.album?.album || "").localeCompare(String(b.album?.album || ""));
}

module.exports = {
  CURRENCIES,
  DIGITAL_ONLY_HOSTS,
  FORMATS,
  STATUSES,
  albumPriority,
  albumStatus,
  clampPriority,
  compareAvailableAlbums,
  compareScanPriority,
  convertCurrency,
  isSearchEligible,
  isKnownDigitalOnlyUrl,
  listingTimestamp,
  normaliseAlbum,
  normaliseCurrency,
  normaliseFormat,
  normaliseStatus,
  parseMoney
};
