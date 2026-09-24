const fs = require("fs");
const path = require("path");
const { load } = require("cheerio");
const {
  DEFAULT_DAILY_LIMIT,
  ensureDailyPlan,
  loadPlan,
  nextBatch,
  planSummary,
  recordRequest,
  recordResult,
  savePlan
} = require("./scan-plan");
const { convertCurrency, isKnownDigitalOnlyUrl, normaliseAlbum, normaliseCurrency, normaliseFormat } = require("./catalog-model");
const { searchWeb } = require("./web-search");
const { atomicWriteJson } = require("./vault-platform");

const root = __dirname;
const dataRoot = process.env.VAULT_DATA_DIR ? path.resolve(process.env.VAULT_DATA_DIR) : root;
fs.mkdirSync(dataRoot, { recursive: true });
const vaultPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(dataRoot, "vault-data.json");
const batchLimit = Math.max(1, Number(process.env.SCAN_LIMIT || process.argv[3] || 25));
const delayMs = Math.max(0, Number(process.env.SCAN_DELAY_MS || 5000));
const settingsPath = path.join(dataRoot, "settings.json");
const planPath = path.join(dataRoot, "daily-scan-plan.json");
const trustedVendorsPath = path.join(dataRoot, "trusted-vendors.json");
const scannerLockPath = path.join(dataRoot, "availability-scanner.lock");
const maxTextLength = 7500;
const maxRejected = 25;
const outboundWebDisabled = /^(1|true|yes)$/i.test(String(process.env.VAULT_DISABLE_WEB || ""));

const blockedHosts = [
  "google.",
  "duckduckgo.",
  "bing.",
  "search.yahoo.",
  "vertexaisearch.cloud.google.com",
  "webcache.googleusercontent.",
  "accounts.google.",
  "support.google.",
  "policies.google.",
  "allmusic.",
  "besteveralbums.",
  "rateyourmusic.",
  "wikipedia.",
  "youtube."
];

const MARKET_COUNTRIES = Object.freeze({
  AU: { name: "Australia", region: "oceania", suffixes: [".com.au", ".au"] },
  NZ: { name: "New Zealand", region: "oceania", suffixes: [".co.nz", ".nz"] },
  US: { name: "United States", region: "north-america", suffixes: [".us"] },
  CA: { name: "Canada", region: "north-america", suffixes: [".ca"] },
  GB: { name: "United Kingdom", region: "europe", suffixes: [".co.uk", ".uk"] },
  DE: { name: "Germany", region: "europe", suffixes: [".de"] },
  FR: { name: "France", region: "europe", suffixes: [".fr"] },
  NL: { name: "Netherlands", region: "europe", suffixes: [".nl"] },
  IT: { name: "Italy", region: "europe", suffixes: [".it"] },
  ES: { name: "Spain", region: "europe", suffixes: [".es"] },
  JP: { name: "Japan", region: "asia", suffixes: [".co.jp", ".jp"] }
});

const MARKET_REGIONS = Object.freeze({
  oceania: "Oceania",
  "north-america": "North America",
  "south-america": "South America",
  europe: "Europe",
  asia: "Asia",
  africa: "Africa"
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function reportToParent(message) {
  if (typeof process.send !== "function") return;
  try {
    process.send(message);
  } catch {}
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function acquireScannerLock() {
  try {
    const handle = fs.openSync(scannerLockPath, "wx");
    fs.writeFileSync(handle, String(process.pid), "utf8");
    fs.closeSync(handle);
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  const existingPid = Number(fs.readFileSync(scannerLockPath, "utf8"));
  try {
    process.kill(existingPid, 0);
    throw new Error(`Availability scanner is already running as process ${existingPid}.`);
  } catch (error) {
    if (error.message?.startsWith("Availability scanner is already running")) throw error;
    fs.unlinkSync(scannerLockPath);
    acquireScannerLock();
  }
}

function releaseScannerLock() {
  try {
    if (Number(fs.readFileSync(scannerLockPath, "utf8")) === process.pid) fs.unlinkSync(scannerLockPath);
  } catch {}
}

function loadSettings() {
  return {
    searchProvider: "duckduckgo",
    searxngUrl: "",
    searchResultLimit: 20,
    maxListingsPerAlbum: 12,
    searchFormat: "cd",
    marketScope: "worldwide",
    marketCountry: "US",
    marketRegion: "north-america",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    dailyScanLimit: DEFAULT_DAILY_LIMIT,
    exchangeRatesToAud: { AUD: 1, USD: 1.52, EUR: 1.65, GBP: 1.95 },
    ...readJson(settingsPath)
  };
}

function makeId(artist, album) {
  return `${artist}::${album}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normaliseText(value) {
  return String(value || "")
    .slice(0, maxTextLength)
    .toLowerCase()
    .replace(/&amp;|&#38;/g, "&")
    .replace(/&quot;|&#34;/g, "\"")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanField(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 240);
}

function cleanUrl(value) {
  return String(value || "").trim().slice(0, 1000);
}

function vendorHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isBlockedUrl(url) {
  const host = vendorHost(url);
  return !host || blockedHosts.some(blocked => host.includes(blocked));
}

function loadTrustedVendors() {
  const payload = readJson(trustedVendorsPath, { vendors: [] });
  return Array.isArray(payload.vendors) ? payload.vendors : [];
}

function trustedScore(url, trustedVendors) {
  const host = vendorHost(url);
  const match = trustedVendors.find(vendor => host === vendor.host || host.endsWith(`.${vendor.host}`));
  return match ? Number(match.acceptedCount || 1) : 0;
}

function addRejected(update, item) {
  if (update.rejected.length >= maxRejected) return;
  update.rejected.push({
    url: cleanUrl(item.url),
    reason: cleanField(item.reason, "Rejected")
  });
}

function hasAlbumIdentity(text, album) {
  const haystack = normaliseText(text);
  const artist = normaliseText(album.artist);
  const title = normaliseText(album.album);
  if (!artist || !title || !haystack.includes(artist)) return false;
  if (haystack.includes(title)) return true;
  const titleTokens = [...new Set(title.split(" ").filter(token => token.length > 1))];
  if (titleTokens.length < 3) return false;
  const matchedTokens = titleTokens.filter(token => haystack.includes(token)).length;
  return matchedTokens >= Math.max(2, Math.ceil(titleTokens.length * 0.8));
}

function marketPreference(settings = {}) {
  const scope = ["country", "region"].includes(settings.marketScope) ? settings.marketScope : "worldwide";
  const country = MARKET_COUNTRIES[String(settings.marketCountry || "US").toUpperCase()] ? String(settings.marketCountry || "US").toUpperCase() : "US";
  const region = MARKET_REGIONS[settings.marketRegion] ? settings.marketRegion : MARKET_COUNTRIES[country].region;
  return {
    scope,
    country,
    countryName: MARKET_COUNTRIES[country].name,
    region,
    regionName: MARKET_REGIONS[region]
  };
}

function googleQueries(album, settings = {}) {
  const format = normaliseFormat(settings.searchFormat || album.format || "cd");
  const formatTerms = format === "vinyl"
    ? ["vinyl", "LP"]
    : format === "cassette"
      ? ["tape", "cassette"]
      : ["cd"];
  const market = marketPreference(settings);
  const marketSuffix = market.scope === "country"
    ? ` ${market.countryName}`
    : market.scope === "region"
      ? ` ${market.regionName}`
      : "";
  return formatTerms.map(term => `${cleanField(album.artist)} - ${cleanField(album.album)} ${term} buy${marketSuffix}`);
}

function googleQuery(album, settings = {}) {
  return googleQueries(album, settings)[0];
}

function googleSearchUrl(album, settings = {}) {
  return `https://www.google.com/search?q=${encodeURIComponent(googleQuery(album, settings))}`;
}

function googleSearchUrls(album, settings = {}) {
  return googleQueries(album, settings).map(query => `https://www.google.com/search?q=${encodeURIComponent(query)}`);
}

function priceRecord(amount, currency, exchangeRatesToAud, budgetCurrency = "AUD") {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const code = normaliseCurrency(currency);
  const aud = convertCurrency(numeric, code, "AUD", exchangeRatesToAud);
  const budgetCode = normaliseCurrency(budgetCurrency);
  const budgetAmount = convertCurrency(numeric, code, budgetCode, exchangeRatesToAud);
  return {
    amount: numeric,
    currency: code,
    display: `${code} ${numeric.toFixed(2)}`,
    aud,
    audDisplay: aud === null ? "" : `AUD ${aud.toFixed(2)}`,
    budgetCurrency: budgetCode,
    budgetAmount,
    budgetDisplay: budgetAmount === null ? "" : `${budgetCode} ${budgetAmount.toFixed(2)}`,
    convertedPrices: Object.fromEntries(["AUD", "USD", "GBP", "EUR"].map(target => [
      target,
      convertCurrency(numeric, code, target, exchangeRatesToAud)
    ]))
  };
}

function parsePrice(text, candidate, url, exchangeRatesToAud, budgetCurrency = "AUD") {
  const value = String(text || "");
  const candidateCurrency = String(candidate?.priceCurrency || "").toUpperCase();
  const fallbackDollarCurrency = candidateCurrency === "AUD" || vendorHost(url).endsWith(".au") ? "AUD" : "USD";
  const patterns = [
    { currency: "AUD", pattern: /["']price["']\s*:\s*["']?(\d+(?:[.,]\d{1,2})?)["']?[\s\S]{0,160}?["']priceCurrency["']\s*:\s*["']AUD["']/i },
    { currency: "USD", pattern: /["']price["']\s*:\s*["']?(\d+(?:[.,]\d{1,2})?)["']?[\s\S]{0,160}?["']priceCurrency["']\s*:\s*["']USD["']/i },
    { currency: "EUR", pattern: /["']price["']\s*:\s*["']?(\d+(?:[.,]\d{1,2})?)["']?[\s\S]{0,160}?["']priceCurrency["']\s*:\s*["']EUR["']/i },
    { currency: "GBP", pattern: /["']price["']\s*:\s*["']?(\d+(?:[.,]\d{1,2})?)["']?[\s\S]{0,160}?["']priceCurrency["']\s*:\s*["']GBP["']/i },
    { currency: "AUD", pattern: /["']priceCurrency["']\s*:\s*["']AUD["'][\s\S]{0,160}?["']price["']\s*:\s*["']?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: "USD", pattern: /["']priceCurrency["']\s*:\s*["']USD["'][\s\S]{0,160}?["']price["']\s*:\s*["']?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: "EUR", pattern: /["']priceCurrency["']\s*:\s*["']EUR["'][\s\S]{0,160}?["']price["']\s*:\s*["']?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: "GBP", pattern: /["']priceCurrency["']\s*:\s*["']GBP["'][\s\S]{0,160}?["']price["']\s*:\s*["']?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: "AUD", pattern: /(?:A\$|AU\$|AUD)\s?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: "USD", pattern: /(?:US\$|USD)\s?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: "EUR", pattern: /(?:\u20ac|EUR)\s?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: "GBP", pattern: /(?:\u00a3|GBP)\s?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: fallbackDollarCurrency, pattern: /\$\s?(\d+(?:[.,]\d{1,2})?)/i },
    { currency: "EUR", pattern: /(\d+(?:[.,]\d{1,2})?)\s?\u20ac/i },
    { currency: "GBP", pattern: /(\d+(?:[.,]\d{1,2})?)\s?GBP/i }
  ];
  for (const item of patterns) {
    const match = value.match(item.pattern);
    if (!match) continue;
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return priceRecord(amount, item.currency, exchangeRatesToAud, budgetCurrency);
  }
  return null;
}

function jsonLdDocuments(html) {
  try {
    const $ = load(String(html || ""));
    return $('script[type="application/ld+json"]').toArray().flatMap(node => {
      try {
        const parsed = JSON.parse($(node).text());
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function walkJson(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) nested.forEach(item => walkJson(item, visit));
    else if (nested && typeof nested === "object") walkJson(nested, visit);
  }
}

function countryCode(value) {
  const text = normaliseText(typeof value === "object" ? value?.name || value?.addressCountry || "" : value);
  if (!text) return "";
  const direct = String(value || "").trim().toUpperCase();
  if (MARKET_COUNTRIES[direct]) return direct;
  return Object.entries(MARKET_COUNTRIES).find(([, country]) => {
    const name = normaliseText(country.name);
    return text === name || text.includes(name) || (country.name === "United States" && /\busa\b|united states of america/.test(text)) || (country.name === "United Kingdom" && /\buk\b|great britain/.test(text));
  })?.[0] || "";
}

function sellerCountryFromHost(url) {
  const host = vendorHost(url);
  return Object.entries(MARKET_COUNTRIES).find(([, country]) => country.suffixes.some(suffix => host.endsWith(suffix)))?.[0] || "";
}

function structuredCommerceEvidence(html) {
  const shippingRates = [];
  const destinationCountries = new Set();
  const addressCountries = [];
  for (const document of jsonLdDocuments(html)) {
    walkJson(document, object => {
      for (const key of ["shippingDestination", "eligibleRegion"]) {
        const destinations = Array.isArray(object[key]) ? object[key] : [object[key]];
        destinations.filter(Boolean).forEach(destination => {
          const code = countryCode(destination);
          if (code) destinationCountries.add(code);
        });
      }
      if (object.addressCountry) {
        const code = countryCode(object.addressCountry);
        if (code) addressCountries.push(code);
      }
      if (object.shippingRate !== undefined) {
        const rate = object.shippingRate;
        const amount = Number(typeof rate === "object" ? rate.value ?? rate.price ?? rate.amount : rate);
        const currency = String((typeof rate === "object" ? rate.currency ?? rate.priceCurrency : "") || object.priceCurrency || "").toUpperCase();
        if (Number.isFinite(amount) && amount >= 0 && ["AUD", "USD", "GBP", "EUR"].includes(currency)) {
          shippingRates.push({ amount, currency });
        }
      }
    });
  }
  return {
    shippingRate: shippingRates[0] || null,
    destinationCountries: [...destinationCountries],
    sellerCountry: addressCountries.find(code => !destinationCountries.has(code)) || addressCountries[0] || ""
  };
}

function shippingTextEvidence(text) {
  const value = String(text || "").replace(/\s+/g, " ");
  const snippets = [];
  const pattern = /(?:shipping|delivery|postage|ships?\s+to)[^.!?]{0,180}/gi;
  let match;
  while ((match = pattern.exec(value)) && snippets.length < 20) snippets.push(match[0]);
  return snippets.join(" | ");
}

function estimateDelivery(album, sellerCountry, settings) {
  const destination = marketPreference(settings).country;
  const sellerRegion = MARKET_COUNTRIES[sellerCountry]?.region || "";
  const destinationRegion = MARKET_COUNTRIES[destination]?.region || "";
  const format = String(album.format || "cd").toLowerCase();
  const rates = sellerCountry && sellerCountry === destination
    ? { cd: 8, vinyl: 12, cassette: 8 }
    : sellerRegion && sellerRegion === destinationRegion
      ? { cd: 15, vinyl: 24, cassette: 15 }
      : { cd: 24, vinyl: 38, cassette: 22 };
  return { amount: rates[format] || rates.cd, currency: "AUD" };
}

function deliveryEvidence(html, finalUrl, album, settings) {
  const structured = structuredCommerceEvidence(html);
  const evidence = productPageEvidence(html);
  const shippingText = shippingTextEvidence(evidence);
  const sellerCountry = structured.sellerCountry || sellerCountryFromHost(finalUrl);
  const rates = settings.exchangeRatesToAud || {};
  let rate = structured.shippingRate;
  let accuracy = rate?.amount === 0 ? "free" : rate ? "site-rate" : "";

  if (!rate && /free\s+(?:shipping|delivery|postage)|(?:shipping|delivery|postage)\s*:?\s*free/i.test(shippingText)) {
    rate = { amount: 0, currency: album.budgetCurrency || settings.currency || "AUD" };
    accuracy = "free";
  }
  if (!rate && shippingText) {
    const parsed = parsePrice(shippingText, {}, finalUrl, rates, album.budgetCurrency);
    if (parsed) {
      rate = { amount: parsed.amount, currency: parsed.currency };
      accuracy = "site-rate";
    }
  }
  if (!rate) {
    rate = estimateDelivery(album, sellerCountry, settings);
    accuracy = "estimated";
  }
  const price = priceRecord(rate.amount, rate.currency, rates, album.budgetCurrency);
  return {
    ...price,
    accuracy,
    sellerCountry,
    destinationCountry: marketPreference(settings).country,
    destinationCountries: structured.destinationCountries,
    shippingText
  };
}

function marketEligibility(delivery, settings) {
  const market = marketPreference(settings);
  if (market.scope === "worldwide") return { accepted: true, label: "Worldwide" };
  const sellerCountry = delivery.sellerCountry;
  const destinations = new Set(delivery.destinationCountries || []);
  const worldwide = /worldwide|international\s+(?:shipping|delivery)|ships?\s+internationally/i.test(delivery.shippingText || "");
  if (market.scope === "country") {
    const countryNamed = normaliseText(delivery.shippingText).includes(normaliseText(market.countryName));
    return {
      accepted: worldwide || sellerCountry === market.country || destinations.has(market.country) || countryNamed,
      label: market.countryName
    };
  }
  const sellerRegion = MARKET_COUNTRIES[sellerCountry]?.region;
  const destinationRegion = [...destinations].some(code => MARKET_COUNTRIES[code]?.region === market.region);
  const regionNamed = normaliseText(delivery.shippingText).includes(normaliseText(market.regionName));
  return {
    accepted: worldwide || sellerRegion === market.region || destinationRegion || regionNamed,
    label: market.regionName
  };
}

function deliveredPrices(itemPrice, delivery) {
  return Object.fromEntries(["AUD", "USD", "GBP", "EUR"].map(currency => {
    const item = Number(itemPrice.convertedPrices?.[currency]);
    const shipping = Number(delivery.convertedPrices?.[currency]);
    return [currency, Number.isFinite(item) && Number.isFinite(shipping) ? Number((item + shipping).toFixed(2)) : null];
  }));
}

function hasPurchaseAction(text) {
  const value = String(text || "");
  const purchaseControl = /add\s*to\s*cart|buy\s*now|buy\s*it\s*now|add\s*to\s*basket/i.test(value);
  const structuredOutOfStock = /["']availability["']\s*:\s*["'][^"']*(?:OutOfStock|SoldOut|Discontinued)/i.test(value);
  const structuredInStock = /["']availability["']\s*:\s*["'][^"']*(?:InStock|LimitedAvailability|PreOrder)/i.test(value);
  const conciseUnavailable = value.length < 5000 && /out\s*of\s*stock|sold\s*out|currently\s*unavailable|notify\s*me\s*when\s*available/i.test(value);
  return purchaseControl && !(conciseUnavailable || (structuredOutOfStock && !structuredInStock));
}

const FORMAT_PATTERNS = {
  cd: /\bcd\b|compact\s+disc|digipak/i,
  vinyl: /\bvinyl\b|\blp\b|\b\d?lp\b|12["”]/i,
  cassette: /\bcassette\b|\btape\b/i
};

function hasPhysicalFormat(text, format) {
  const wanted = String(format || "cd").toLowerCase();
  return (FORMAT_PATTERNS[wanted] || new RegExp(`\\b${wanted.replace(/[^a-z0-9]+/g, "\\s*")}\\b`, "i")).test(String(text || ""));
}

function hasSelectedFormat(html, finalUrl, format) {
  const wanted = String(format || "cd").toLowerCase();
  let strongEvidence = "";
  try {
    const $ = load(String(html || ""));
    strongEvidence = [
      $("title").first().text(),
      $('meta[property="og:title"]').attr("content"),
      $("h1").first().text(),
      $('[itemprop="name"]').first().text(),
      decodeURIComponent(String(finalUrl || ""))
    ].filter(Boolean).join(" ");
  } catch {
    strongEvidence = String(finalUrl || "");
  }
  if (hasPhysicalFormat(strongEvidence, wanted)) return true;
  const conflictingFormat = Object.entries(FORMAT_PATTERNS)
    .some(([name, pattern]) => name !== wanted && pattern.test(strongEvidence));
  return !conflictingFormat && hasPhysicalFormat(productPageEvidence(html), wanted);
}

function productPageEvidence(html) {
  try {
    const $ = load(String(html || ""));
    const values = [
      $("title").first().text(),
      $('meta[property="og:title"]').attr("content"),
      $('meta[property="og:description"]').attr("content"),
      $("h1").first().text(),
      $('[itemprop="name"]').first().text(),
      $('[itemprop="description"]').first().text(),
      $('[itemprop="sku"]').first().text(),
      $('script[type="application/ld+json"]').text(),
      $("main").first().text().slice(0, 30000)
    ];
    return values.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 60000);
  } catch {
    return String(html || "").slice(0, 30000);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} ${response.statusText}`);
      error.httpStatus = response.status;
      throw error;
    }
    return { html: await response.text(), finalUrl: response.url || url };
  } catch (error) {
    const cause = error.message?.startsWith("HTTP")
      ? error.message
      : error.cause?.code || error.cause?.message || error.message || error.name;
    const wrapped = new Error(`${cause}: ${url}`);
    wrapped.httpStatus = error.httpStatus;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

function resultMatchesAlbum(result, album) {
  return hasAlbumIdentity(`${result?.title || ""} ${result?.snippet || ""} ${result?.url || ""}`, album);
}

function findIdentityResult(results, hostFragment, album) {
  return (results || []).find(result => vendorHost(result.url).includes(hostFragment) && resultMatchesAlbum(result, album)) || null;
}

function identityVerification(album, discogsSearch) {
  const discogs = findIdentityResult(discogsSearch?.results, "discogs.com", album);
  const sources = [
    { source: "Discogs", url: discogs?.url || "", verified: Boolean(discogs), checked: true }
  ];
  return {
    ok: Boolean(discogs),
    source: "Discogs",
    url: discogs?.url || "",
    sources,
    method: "independent-web-cross-check"
  };
}

function mergeSearchResults(searches = []) {
  const resultsByUrl = new Map();
  searches.forEach(search => {
    (search.results || []).forEach(result => {
      if (result?.url && !resultsByUrl.has(result.url)) resultsByUrl.set(result.url, result);
    });
  });
  return [...resultsByUrl.values()];
}

async function discoverAlbum(album, settings) {
  const limit = Math.max(10, Math.min(50, Number(settings.searchResultLimit || 20)));
  const searches = [];
  const errors = [];
  for (const query of googleQueries(album, settings)) {
    try {
      searches.push(await searchWeb(query, settings, { limit }));
    } catch (error) {
      errors.push(error);
    }
  }
  if (!searches.length) throw errors[0] || new Error("Web search returned no responses.");
  const primary = {
    provider: searches[0].provider,
    query: searches[0].query,
    queries: searches.map(search => search.query),
    results: mergeSearchResults(searches),
    errors: errors.map(error => error.message)
  };
  let discogsSearch = { provider: primary.provider, query: primary.query, results: primary.results };
  if (!findIdentityResult(primary.results, "discogs.com", album)) {
    const query = `site:discogs.com ${cleanField(album.artist)} - ${cleanField(album.album)}`;
    try {
      discogsSearch = await searchWeb(query, settings, { limit: 10 });
    } catch (error) {
      discogsSearch = { provider: primary.provider, query, results: [], error: error.message };
    }
  }
  return { primary, discogsSearch };
}

async function verifyCandidate(album, candidate, trustedVendors, discogs, settings) {
  const candidateUrl = cleanUrl(candidate.url);
  if (isBlockedUrl(candidateUrl)) return { accepted: false, reason: "Search did not return a direct seller page." };
  if (isKnownDigitalOnlyUrl(candidateUrl)) return { accepted: false, reason: "Digital-only storefronts are not physical-item listings." };
  const { html, finalUrl } = await fetchText(candidateUrl);
  if (isBlockedUrl(finalUrl)) return { accepted: false, reason: "The listing redirected away from a direct vendor page." };
  if (isKnownDigitalOnlyUrl(finalUrl)) return { accepted: false, reason: "Digital-only storefronts are not physical-item listings." };
  const productEvidence = productPageEvidence(html);
  const pageText = `${productEvidence} ${candidate.evidence || ""}`;
  const price = parsePrice(pageText, candidate, finalUrl, settings.exchangeRatesToAud || {}, album.budgetCurrency);
  const purchaseActionFound = hasPurchaseAction(html);
  const pageMatchesAlbum = hasAlbumIdentity(productEvidence, album) || hasAlbumIdentity(finalUrl, album);
  const formatMatches = hasSelectedFormat(html, finalUrl, album.format);
  if (!price || !purchaseActionFound || !pageMatchesAlbum || !formatMatches) {
    return {
      accepted: false,
      reason: "Direct page did not prove the exact album, selected physical format, price, and Add To Cart or Buy Now."
    };
  }
  if (!discogs.ok) return { accepted: false, reason: "Discogs could not verify the release identity." };

  const delivery = deliveryEvidence(html, finalUrl, album, settings);
  const market = marketEligibility(delivery, settings);
  if (!market.accepted) {
    return { accepted: false, reason: `Seller location or delivery coverage could not be confirmed for ${market.label}.` };
  }
  const delivered = deliveredPrices(price, delivery);
  const budgetCurrency = price.budgetCurrency;

  const host = vendorHost(finalUrl);
  const verifiedAt = new Date().toISOString();
  return {
    accepted: true,
    listingId: `${makeId(album.artist, album.album)}-${host}-${Date.now()}`,
    artist: cleanField(album.artist),
    album: cleanField(album.album),
    format: album.format || "cd",
    url: finalUrl,
    host,
    marketplace: cleanField(candidate.vendor, host),
    currentCost: price.display,
    originalCurrency: price.currency,
    originalAmount: price.amount,
    audPrice: price.aud,
    audDisplay: price.audDisplay,
    budgetCurrency: price.budgetCurrency,
    budgetAmount: price.budgetAmount,
    budgetDisplay: price.budgetDisplay,
    convertedPrices: price.convertedPrices,
    deliveryCost: delivery.amount,
    deliveryCurrency: delivery.currency,
    deliveryDisplay: delivery.display,
    deliveryConvertedPrices: delivery.convertedPrices,
    deliveryAccuracy: delivery.accuracy,
    deliveryDestination: MARKET_COUNTRIES[delivery.destinationCountry]?.name || delivery.destinationCountry,
    sellerCountry: delivery.sellerCountry,
    marketScope: marketPreference(settings).scope,
    marketLabel: market.label,
    deliveredConvertedPrices: delivered,
    deliveredBudgetAmount: delivered[budgetCurrency],
    deliveredBudgetDisplay: Number.isFinite(delivered[budgetCurrency]) ? `${budgetCurrency} ${delivered[budgetCurrency].toFixed(2)}` : "",
    purchaseActionFound: true,
    purchaseAction: cleanField(candidate.purchaseAction),
    verifiedPurchase: true,
    identityVerified: true,
    identitySource: discogs.source,
    identityUrl: discogs.url,
    identityMethod: discogs.method,
    identitySources: discogs.sources,
    trustedVendorScore: trustedScore(finalUrl, trustedVendors),
    listingFoundAt: verifiedAt,
    lastVerifiedAt: verifiedAt,
    inStockConfirmed: true,
    evidence: cleanField(candidate.evidence)
  };
}

async function scanAlbum(album, trustedVendors, settings) {
  album = normaliseAlbum({ ...album, format: normaliseFormat(settings.searchFormat || "cd") });
  const update = {
    id: album.id || makeId(album.artist, album.album),
    artist: cleanField(album.artist),
    album: cleanField(album.album),
    format: album.format || "cd",
    status: album.status || "wanted",
    priority: album.priority,
    lastChecked: new Date().toISOString(),
    searchOrder: ["Exact web query", "Discogs identity check", "Direct seller-page verification"],
    googleQuery: googleQuery(album, settings),
    googleQueries: googleQueries(album, settings),
    googleSearchUrl: googleSearchUrl(album, settings),
    googleSearchUrls: googleSearchUrls(album, settings),
    marketScope: marketPreference(settings).scope,
    marketLabel: marketPreference(settings).scope === "country" ? marketPreference(settings).countryName : marketPreference(settings).scope === "region" ? marketPreference(settings).regionName : "Worldwide",
    scanCompleted: true,
    listings: [],
    rejected: []
  };

  let discovery;
  try {
    discovery = await discoverAlbum(album, settings);
  } catch (error) {
    update.scanCompleted = false;
    update.rateLimited = error.httpStatus === 429 || error.httpStatus === 403;
    update.notes = update.rateLimited
      ? "The free search provider temporarily limited requests. Existing availability was left unchanged."
      : `Web search failed. Existing availability was left unchanged. ${error.message}`;
    addRejected(update, { url: "Web search provider", reason: error.message });
    return update;
  }

  update.searchProvider = discovery.primary.provider;
  update.searchQueries = [...(discovery.primary.queries || [discovery.primary.query]), discovery.discogsSearch.query]
    .filter((query, index, values) => query && values.indexOf(query) === index);
  const discogs = identityVerification(album, discovery.discogsSearch);
  update.discogsVerificationUrl = discogs.url;
  update.identitySource = discogs.source;
  update.identityUrl = discogs.url;
  update.identityMethod = discogs.method;
  update.identitySources = discogs.sources;
  if (!discogs.ok) {
    update.availabilityStatus = "unavailable";
    update.verifiedPurchase = false;
    update.identityVerified = false;
    update.purchaseActionFound = false;
    update.notes = "The exact artist and album could not be confirmed by Discogs.";
    return update;
  }

  const byUrl = new Map(discovery.primary.results.map(result => [result.url, {
    url: result.url,
    vendor: vendorHost(result.url),
    evidence: `${result.title}. ${result.snippet}`
  }]));
  const candidates = [...byUrl.values()]
    .filter(candidate => candidate.url && !isBlockedUrl(candidate.url))
    .sort((a, b) => trustedScore(b.url, trustedVendors) - trustedScore(a.url, trustedVendors))
    .slice(0, Math.max(1, Math.min(25, Number(settings.maxListingsPerAlbum || 12))));

  for (const candidate of candidates) {
    try {
      const result = await verifyCandidate(album, candidate, trustedVendors, discogs, settings);
      if (result.accepted) update.listings.push(result);
      else addRejected(update, { url: candidate.url, reason: result.reason });
    } catch (error) {
      addRejected(update, { url: candidate.url, reason: error.message });
    }
    await sleep(250);
  }

  if (update.listings.length) {
    const best = update.listings[0];
    update.availabilityStatus = "available";
    update.verifiedPurchase = true;
    update.identityVerified = true;
    update.purchaseActionFound = true;
    update.availableAt = best.listingFoundAt;
    update.listingFoundAt = best.listingFoundAt;
    update.currentCost = best.currentCost;
    update.currency = best.originalCurrency;
    update.audPrice = best.audPrice;
    update.audDisplay = best.audDisplay;
    update.directUrl = best.url;
    update.purchaseUrl = best.url;
    update.marketplace = best.marketplace;
  } else {
    update.availabilityStatus = "unavailable";
    update.verifiedPurchase = false;
    update.identityVerified = true;
    update.purchaseActionFound = false;
    update.purchaseUrl = update.googleSearchUrl;
    update.marketplace = discovery.primary.provider;
    update.notes = update.rejected.slice(0, 3).map(item => item.reason).join(" | ") || "No listing met every direct-page requirement.";
  }
  return update;
}

async function main() {
  if (outboundWebDisabled) {
    console.log("Internet scanning is disabled for dashboard-only mode.");
    return;
  }
  const loadedSettings = loadSettings();
  const settings = {
    ...loadedSettings,
    searchFormat: normaliseFormat(process.env.SCAN_FORMAT || loadedSettings.searchFormat || "cd")
  };
  const vault = readJson(vaultPath, { albums: [] });
  const trustedVendors = loadTrustedVendors();
  let plan = ensureDailyPlan(vault, settings.dailyScanLimit, loadPlan(planPath), new Date(), { timeZone: settings.timeZone });
  savePlan(planPath, plan);
  const albums = nextBatch(vault, plan, batchLimit);
  const updates = [];

  reportToParent({
    type: "scan-start",
    batchTotal: albums.length,
    dailyPlan: planSummary(plan)
  });

  for (let index = 0; index < albums.length; index += 1) {
    const album = albums[index];
    reportToParent({
      type: "scan-progress",
      phase: "scanning",
      batchIndex: index,
      batchTotal: albums.length,
      album: { id: album.id, artist: album.artist, album: album.album }
    });
    recordRequest(plan, album.id);
    savePlan(planPath, plan);
    const update = await scanAlbum(album, trustedVendors, settings);
    updates.push(update);
    recordResult(
      plan,
      album.id,
      update.rateLimited ? "Search provider rate limit reached" : update.listings.length ? `${update.listings.length} verified listing(s)` : update.scanCompleted ? "No verified listing" : cleanField(update.notes, "Scan failed"),
      update.scanCompleted !== false
    );
    savePlan(planPath, plan);
    reportToParent({
      type: "album-result",
      update,
      batchIndex: index + 1,
      batchTotal: albums.length,
      dailyPlan: planSummary(plan)
    });
    if (update.rateLimited) break;
    await sleep(delayMs);
  }

  const summary = planSummary(plan);
  const outPath = path.join(dataRoot, "availability-scan-results.json");
  const results = {
    scannedAt: new Date().toISOString(),
    provider: settings.searchProvider === "searxng" ? "Self-hosted SearXNG" : "DuckDuckGo keyless web search",
    searchFormat: settings.searchFormat,
    rateLimited: updates.some(album => album.rateLimited === true),
    dailyPlan: summary,
    queue: {
      wantedTotal: summary.wantedSelected,
      priorityFiveTotal: summary.priorityFiveSelected,
      wantedScanned: updates.length,
      priorityFiveScanned: updates.filter(album => Number(album.priority || 3) === 5).length,
      selected: summary.selected,
      pending: summary.pending,
      requestsUsed: summary.requestCount,
      requestsRemaining: summary.requestsRemaining
    },
    albums: updates
  };
  atomicWriteJson(outPath, results);
  reportToParent({ type: "scan-complete", results });
  console.log(`Free web search checked ${updates.length} albums. ${summary.requestsRemaining} album scans remain under the daily safety cap.`);
}

if (require.main === module) {
  const parentPid = process.ppid;
  let parentMonitor;
  (async () => {
    acquireScannerLock();
    parentMonitor = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        releaseScannerLock();
        process.exit(1);
      }
    }, 2000);
    parentMonitor.unref();
    try {
      await main();
    } finally {
      clearInterval(parentMonitor);
      releaseScannerLock();
    }
  })().catch(error => {
    releaseScannerLock();
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  googleQueries,
  googleQuery,
  googleSearchUrls,
  googleSearchUrl,
  hasAlbumIdentity,
  hasPhysicalFormat,
  hasSelectedFormat,
  hasPurchaseAction,
  identityVerification,
  parsePrice,
  deliveryEvidence,
  marketEligibility,
  marketPreference,
  mergeSearchResults,
  productPageEvidence,
  resultMatchesAlbum,
  scanAlbum
};
