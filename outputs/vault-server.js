const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  DEFAULT_DAILY_LIMIT,
  createDailyPlan,
  ensureDailyPlan,
  loadPlan,
  planSummary,
  savePlan
} = require("./scan-plan");
const { albumPriority, isKnownDigitalOnlyUrl, normaliseAlbum, normaliseStatus } = require("./catalog-model");
const { searchWeb } = require("./web-search");
const {
  atomicWriteJson,
  normaliseSettingsUpdate,
  publicVault,
  safeArtworkForAlbum
} = require("./vault-platform");

const root = __dirname;
const dataRoot = process.env.VAULT_DATA_DIR ? path.resolve(process.env.VAULT_DATA_DIR) : root;
fs.mkdirSync(dataRoot, { recursive: true });
const port = Number(process.env.VAULT_PORT || 8787);
const testMode = /^(1|true|yes)$/i.test(String(process.env.VAULT_TEST_MODE || ""));
const vaultPath = path.join(dataRoot, "vault-data.json");
const indexPath = path.join(root, "physical-music-vault.html");
const scannerPath = path.join(root, "availability-scanner.js");
const syncPath = path.join(root, "vault-sync.js");
const settingsPath = path.join(dataRoot, "settings.json");
const scanPlanPath = path.join(dataRoot, "daily-scan-plan.json");
const trustedVendorsPath = path.join(dataRoot, "trusted-vendors.json");
const agentStatusPath = path.join(dataRoot, "agent-status.json");
const syncResultPath = path.join(dataRoot, "vault-sync-results.json");
const defaultMusicRoot = path.join(os.homedir(), "Music");
const defaultSettings = {
  automationEnabled: true,
  webAccessEnabled: true,
  allowLanAccess: false,
  scanIntervalMs: 30 * 60 * 1000,
  syncIntervalMs: 10 * 60 * 1000,
  scanLimit: 25,
  dailyScanLimit: DEFAULT_DAILY_LIMIT,
  searchProvider: "duckduckgo",
  searxngUrl: "",
  searchResultLimit: 20,
  maxListingsPerAlbum: 12,
  libraryRoot: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  currency: "USD",
  exchangeRatesToAud: { AUD: 1, USD: 1.52, EUR: 1.65, GBP: 1.95 }
};
let settings = loadSettings();
let musicRoot = path.resolve(process.env.MUSIC_ROOT || settings.libraryRoot || defaultMusicRoot);
const bindHost = settings.allowLanAccess === true ? "0.0.0.0" : "127.0.0.1";
function isOutboundWebDisabled() {
  return /^(1|true|yes)$/i.test(String(process.env.VAULT_DISABLE_WEB || "")) || loadSettings().webAccessEnabled === false;
}
const scanIntervalMs = Number(process.env.SCAN_INTERVAL_MS || settings.scanIntervalMs);
const syncIntervalMs = Number(process.env.SYNC_INTERVAL_MS || settings.syncIntervalMs);
const scanLimit = Number(process.env.SCAN_LIMIT || settings.scanLimit);
let scannerRunning = false;
let scannerProcess = null;
let lastScannerMessage = "";
let scannerProgress = null;
let syncRunning = false;
let syncProcess = null;
let lastSyncMessage = "";
let lastSyncCompletedAt = "";
let lastSyncError = "";
let networkTestRunning = false;
let lastNetworkStatus = null;
let libraryWatcher = null;
let libraryWatchTimer = null;
let libraryWatcherStatus = { active: false, message: "Library watcher has not started." };

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function send(res, status, body, type = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'",
    ...extraHeaders
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function publicFileFromUrl(url) {
  const pathname = new URL(url, "http://localhost").pathname;
  const publicFiles = new Map([
    ["/", indexPath],
    ["/physical-music-vault.html", indexPath],
    ["/vault.css", path.join(root, "vault.css")]
  ]);
  return publicFiles.get(pathname) || null;
}

function isSameOriginMutation(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return true;
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  try {
    return new URL(origin).host === String(req.headers.host || "");
  } catch {
    return false;
  }
}

function isLocalRequest(req) {
  const remoteAddress = String(req.socket.remoteAddress || "");
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

function publicRuntimeMessage(value) {
  let message = String(value || "");
  for (const [privatePath, label] of [[musicRoot, "your music library"], [root, "local application data"], [os.homedir(), "your user folder"]]) {
    if (!privatePath) continue;
    message = message.split(privatePath).join(label);
  }
  return message.slice(0, 1000);
}

function makeId(artist, album) {
  return `${artist}::${album}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function matchEventId(albumId, url) {
  return `${albumId}::${Buffer.from(String(url || "")).toString("base64url").slice(0, 48)}`;
}

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(readJsonText(settingsPath)) };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(next) {
  const safeNext = normaliseSettingsUpdate(next);
  settings = { ...settings, ...safeNext };
  atomicWriteJson(settingsPath, settings);
  return publicSettings();
}

async function refreshExchangeRates() {
  if (isOutboundWebDisabled()) return { ok: false, skipped: true };
  const currencies = ["USD", "GBP", "EUR"];
  try {
    const rows = await Promise.all(currencies.map(async currency => {
      const response = await fetch(`https://api.frankfurter.dev/v2/rate/${currency.toLowerCase()}/aud`, {
        headers: { "User-Agent": "PhysicalMusicVault/2.0" },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`${currency}/AUD returned HTTP ${response.status}`);
      const payload = await response.json();
      const rate = Number(payload.rate);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error(`${currency}/AUD returned an invalid rate`);
      return [currency, rate];
    }));
    settings = {
      ...loadSettings(),
      exchangeRatesToAud: { AUD: 1, ...Object.fromEntries(rows) },
      exchangeRatesUpdatedAt: new Date().toISOString(),
      exchangeRatesSource: "Frankfurter v2 reference rates"
    };
    atomicWriteJson(settingsPath, settings);
    return { ok: true, updatedAt: settings.exchangeRatesUpdatedAt };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function publicSettings() {
  const current = loadSettings();
  const { libraryRoot, ...safe } = current;
  return {
    ...safe,
    libraryFolderName: path.basename(musicRoot) || "Music",
    libraryFolderAvailable: fs.existsSync(musicRoot),
    libraryFolderLocked: Boolean(process.env.MUSIC_ROOT)
  };
}

function setLibraryRoot(value) {
  if (process.env.MUSIC_ROOT) {
    throw new Error("The source folder is controlled by the MUSIC_ROOT environment variable.");
  }
  const requested = String(value || "").trim();
  if (!requested || !path.isAbsolute(requested)) {
    throw new Error("Enter a complete local folder path.");
  }
  const resolved = path.resolve(requested);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("That source folder does not exist or is not a directory.");
  }
  settings = { ...loadSettings(), libraryRoot: resolved };
  atomicWriteJson(settingsPath, settings);
  musicRoot = resolved;
  if (libraryWatcher) libraryWatcher.close();
  libraryWatcher = null;
  libraryWatcherStatus = { active: false, message: "Connecting the selected music folder." };
  startLibraryWatcher();
  return publicSettings();
}

function localNetworkUrls() {
  if (bindHost !== "0.0.0.0") return [];
  const activePort = server?.listening ? server.address().port : port;
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(address => address && address.family === "IPv4" && !address.internal)
    .map(address => `http://${address.address}:${activePort}/`);
}

function getDailyScanPlan(vault = readVault(), force = false) {
  const previous = loadPlan(scanPlanPath);
  const plan = force
    ? createDailyPlan(vault, settings.dailyScanLimit, previous, new Date(), { retryFailed: true, timeZone: settings.timeZone })
    : ensureDailyPlan(vault, settings.dailyScanLimit, previous, new Date(), { timeZone: settings.timeZone });
  if (force || plan !== previous) savePlan(scanPlanPath, plan);
  return { ...plan, summary: planSummary(plan) };
}

function vendorHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function loadTrustedVendors() {
  try {
    const payload = JSON.parse(fs.readFileSync(trustedVendorsPath, "utf8"));
    return Array.isArray(payload.vendors)
      ? payload.vendors.filter(vendor => !isKnownDigitalOnlyUrl(`https://${vendor.host || ""}`))
      : [];
  } catch {
    return [];
  }
}

function loadAgentStatus() {
  try {
    const status = JSON.parse(fs.readFileSync(agentStatusPath, "utf8"));
    const ageMs = Date.now() - Date.parse(status.updatedAt || status.startedAt || 0);
    return {
      ok: status.ok === true,
      running: status.running === true,
      agentPid: Number(status.agentPid) || null,
      serverPid: Number(status.serverPid) || null,
      startedAt: status.startedAt || null,
      updatedAt: status.updatedAt || null,
      lastHealthStatus: publicRuntimeMessage(status.lastHealthStatus).slice(0, 240),
      lastError: publicRuntimeMessage(status.lastError).slice(0, 240),
      message: publicRuntimeMessage(status.message).slice(0, 240),
      stale: Number.isFinite(ageMs) ? ageMs > 2 * 60 * 1000 : true,
      ageMs: Number.isFinite(ageMs) ? ageMs : null
    };
  } catch {
    return {
      ok: false,
      stale: true,
      message: "Vault Agent is not reporting yet.",
      agentPid: null,
      serverPid: null
    };
  }
}

function saveTrustedVendors(vendors) {
  atomicWriteJson(trustedVendorsPath, { vendors });
}

function addTrustedVendors(listings) {
  const vendors = loadTrustedVendors();
  const byHost = new Map(vendors.map(vendor => [vendor.host, vendor]));
  for (const listing of listings || []) {
    const host = listing.host || vendorHost(listing.url || listing.directUrl || listing.purchaseUrl);
    if (!host) continue;
    const existing = byHost.get(host) || { host, acceptedCount: 0, firstAcceptedAt: new Date().toISOString() };
    existing.acceptedCount = Number(existing.acceptedCount || 0) + 1;
    existing.lastAcceptedAt = new Date().toISOString();
    existing.lastListingUrl = listing.url || listing.directUrl || listing.purchaseUrl || existing.lastListingUrl || "";
    byHost.set(host, existing);
  }
  const next = [...byHost.values()].sort((a, b) => Number(b.acceptedCount || 0) - Number(a.acceptedCount || 0));
  saveTrustedVendors(next);
  return next;
}

async function testUrl(url, headers = {}) {
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 PhysicalMusicVault/1.0",
        "Accept": "text/html,application/xhtml+xml,application/json",
        ...headers
      }
    });
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      checkedAt: startedAt
    };
  } catch (error) {
    return {
      ok: false,
      error: error.cause?.code || error.cause?.message || error.message || error.name,
      checkedAt: startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

async function testSearchProvider() {
  const checkedAt = new Date().toISOString();
  try {
    const current = loadSettings();
    const result = await searchWeb("Discogs physical music", current, { limit: 1, timeoutMs: 15000 });
    return { ok: result.results.length > 0, provider: result.provider, resultCount: result.results.length, checkedAt };
  } catch (error) {
    return { ok: false, provider: loadSettings().searchProvider, error: error.message, checkedAt };
  }
}

async function runNetworkTest() {
  if (isOutboundWebDisabled()) {
    lastNetworkStatus = {
      ok: false,
      disabled: true,
      running: false,
      checkedAt: new Date().toISOString(),
      message: "Outbound web checks are disabled for dashboard-only mode.",
      checks: {}
    };
    return lastNetworkStatus;
  }

  if (networkTestRunning) return lastNetworkStatus || { ok: false, running: true, message: "Network test already running." };
  networkTestRunning = true;
  const checks = {
    internet: await testUrl("https://www.google.com/generate_204"),
    search: await testSearchProvider(),
    discogs: await testUrl("https://www.discogs.com/search/?type=all&q=Acherontas%20-%20Ta%20Tvam%20Asi")
  };
  networkTestRunning = false;
  const discogsFallbackAvailable = checks.discogs.ok || checks.discogs.status === 403;
  const ok = checks.internet.ok && checks.search.ok && discogsFallbackAvailable;
  lastNetworkStatus = {
    ok,
    running: false,
    checkedAt: new Date().toISOString(),
    message: checks.internet.ok && checks.discogs.status === 403
      ? "Internet and free web search are working. Discogs is reachable but blocks direct automated health checks."
      : ok
        ? "Outbound web access, free search, Discogs and release verification are working."
        : "One or more outbound search or verification services are unavailable.",
    checks
  };
  return lastNetworkStatus;
}

function mergeListings(existingListings = [], incomingListings = []) {
  const byUrl = new Map((existingListings || []).map(listing => [listing.url || listing.directUrl || listing.purchaseUrl, listing]));
  for (const listing of incomingListings || []) {
    const key = listing.url || listing.directUrl || listing.purchaseUrl;
    if (!key) continue;
    byUrl.set(key, { ...(byUrl.get(key) || {}), ...listing });
  }
  return [...byUrl.values()]
    .sort((a, b) => String(b.listingFoundAt || "").localeCompare(String(a.listingFoundAt || "")));
}

function mergeAvailability(vault, updates) {
  const byId = new Map((vault.albums || []).map(album => [album.id, album]));
  const matchEvents = new Map((vault.matchEvents || []).map(event => [event.id, event]));
  const acceptedListings = [];
  for (const update of updates) {
    const id = update.id || makeId(update.artist, update.album);
    if (!byId.has(id)) continue;
    const old = byId.get(id);
    const previouslyKnownUrls = new Set((old.listings || []).map(listing => listing.url || listing.directUrl || listing.purchaseUrl).filter(Boolean));
    const listings = update.scanCompleted === true
      ? mergeListings([], update.listings || [])
      : mergeListings(old.listings || [], update.listings || []);
    const verified = listings.length > 0;
    acceptedListings.push(...(update.listings || []));
    const nextStatus = normaliseStatus(old.status);
    const bestListing = listings[0] || {};
    for (const listing of update.listings || []) {
      const url = listing.url || listing.directUrl || listing.purchaseUrl;
      if (!url || previouslyKnownUrls.has(url)) continue;
      const eventId = matchEventId(id, url);
      if (matchEvents.has(eventId)) continue;
      matchEvents.set(eventId, {
        id: eventId,
        albumId: id,
        album: old.album,
        artist: old.artist,
        priority: albumPriority(old),
        format: old.format || "cd",
        discoveredAt: listing.listingFoundAt || listing.lastVerifiedAt || new Date().toISOString(),
        listing
      });
    }
    byId.set(id, {
      ...old,
      status: nextStatus,
      priority: albumPriority(old),
      availabilityStatus: update.scanCompleted === false ? old.availabilityStatus : verified ? "available" : "unavailable",
      format: update.format || old.format,
      listings,
      purchaseUrl: bestListing.url || update.purchaseUrl || old.purchaseUrl,
      directUrl: verified ? bestListing.url || update.directUrl || update.resultUrl || update.listingUrl : "",
      resultUrl: verified ? bestListing.url || update.resultUrl || update.directUrl || update.listingUrl : "",
      listingUrl: verified ? bestListing.url || update.listingUrl || update.directUrl || update.resultUrl : "",
      currentCost: verified ? bestListing.currentCost || update.currentCost || update.price || update.lowestPrice : "",
      currency: verified ? bestListing.originalCurrency || update.currency : "",
      audPrice: verified ? bestListing.audPrice || update.audPrice : "",
      audDisplay: verified ? bestListing.audDisplay || update.audDisplay : "",
      marketplace: verified ? bestListing.marketplace || update.marketplace : "Google",
      seller: update.seller || old.seller,
      availableAt: bestListing.listingFoundAt || update.availableAt || old.availableAt,
      listingFoundAt: bestListing.listingFoundAt || update.listingFoundAt || update.availableAt || old.listingFoundAt,
      availabilityLastConfirmedAt: verified ? bestListing.lastVerifiedAt || bestListing.listingFoundAt : "",
      lastAvailabilityScanAt: update.scanCompleted === false ? old.lastAvailabilityScanAt : update.lastChecked || new Date().toISOString(),
      sourceRank: update.sourceRank || old.sourceRank,
      verifiedPurchase: verified,
      purchaseActionFound: verified,
      identityVerified: verified,
      identitySource: bestListing.identitySource || update.identitySource || old.identitySource,
      identityUrl: bestListing.identityUrl || update.identityUrl || old.identityUrl,
      identitySources: bestListing.identitySources || update.identitySources || old.identitySources || [],
      lastChecked: update.lastChecked || new Date().toISOString(),
      notes: update.notes || old.notes,
      searchOrder: update.searchOrder || old.searchOrder,
      googleQuery: update.googleQuery || old.googleQuery,
      googleSearchUrl: update.googleSearchUrl || old.googleSearchUrl,
      discogsVerificationUrl: update.discogsVerificationUrl || old.discogsVerificationUrl
    });
  }
  vault.schemaVersion = 2;
  vault.albums = [...byId.values()].map(normaliseAlbum);
  vault.matchEvents = [...matchEvents.values()]
    .sort((a, b) => String(b.discoveredAt || "").localeCompare(String(a.discoveredAt || "")))
    .slice(0, 5000);
  vault.lastAvailabilityScan = new Date().toISOString();
  if (updates.some(update => update.rateLimited === true)) {
    vault.searchRateLimitedAt = new Date().toISOString();
    vault.searchBackoffUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  } else if (updates.length) {
    vault.searchRateLimitedAt = "";
    vault.searchBackoffUntil = "";
  }
  vault.trustedVendors = addTrustedVendors(acceptedListings);
  return vault;
}

function canonicalDiscogsListing(listing = {}, album = {}) {
  const sourceRows = Array.isArray(listing.identitySources) ? listing.identitySources : [];
  const discogsSource = sourceRows.find(source => /discogs/i.test(String(source?.source || "")) && /discogs\.com/i.test(String(source?.url || "")));
  const identityUrl = [listing.identityUrl, listing.discogsVerificationUrl, album.discogsVerificationUrl, discogsSource?.url]
    .find(url => /discogs\.com/i.test(String(url || ""))) || "";
  if (!identityUrl) return null;
  const allowedUrlFields = new Set(["url", "directUrl", "purchaseUrl", "identityUrl"]);
  const cleaned = Object.fromEntries(Object.entries(listing)
    .filter(([key]) => !key.toLowerCase().endsWith("url") || allowedUrlFields.has(key)));
  return {
    ...cleaned,
    identityVerified: true,
    identitySource: "Discogs",
    identityUrl,
    identitySources: [{ source: "Discogs", url: identityUrl, verified: true, checked: true }]
  };
}

function readVault() {
  if (!fs.existsSync(vaultPath)) return { schemaVersion: 2, albums: [], matchEvents: [] };
  try {
    const vault = JSON.parse(readJsonText(vaultPath));
    vault.schemaVersion = 2;
    vault.albums = Array.isArray(vault.albums) ? vault.albums.map(album => {
      const cleanedAlbum = Object.fromEntries(Object.entries(album)
        .filter(([key]) => !key.toLowerCase().endsWith("verificationurl") || key === "discogsVerificationUrl"));
      const normalised = normaliseAlbum({
        ...cleanedAlbum,
        discogsVerificationUrl: /discogs\.com/i.test(String(cleanedAlbum.discogsVerificationUrl || ""))
          ? cleanedAlbum.discogsVerificationUrl
          : "",
        source: cleanedAlbum.sourcePath || (cleanedAlbum.sourcePaths || []).length ? "music-folder" : cleanedAlbum.source
      });
      const listings = (normalised.listings || [])
        .filter(listing => !isKnownDigitalOnlyUrl(listing.url || listing.directUrl || listing.purchaseUrl))
        .map(listing => canonicalDiscogsListing(listing, normalised))
        .filter(Boolean);
      const best = listings[0] || {};
      const canonicalSearchOrder = ["Exact web query", "Discogs identity check", "Direct seller-page verification"];
      const legacySearchShape = Array.isArray(normalised.searchOrder)
        && normalised.searchOrder.some(step => !canonicalSearchOrder.includes(step));
      const legacyIdentityNote = /confirmed by Discogs or /i.test(String(normalised.notes || ""));
      return normaliseAlbum({
        ...normalised,
        listings,
        availabilityStatus: listings.length ? "available" : "unavailable",
        verifiedPurchase: listings.length > 0,
        purchaseActionFound: listings.length > 0,
        identityVerified: listings.length > 0,
        identitySource: listings.length ? "Discogs" : "",
        identityUrl: best.identityUrl || "",
        identitySources: best.identitySources || [],
        searchOrder: normalised.searchOrder?.length ? canonicalSearchOrder : [],
        notes: legacySearchShape || legacyIdentityNote
          ? listings.length ? "" : "The previous identity check did not confirm this release. It will be rechecked with Discogs."
          : normalised.notes,
        purchaseUrl: best.url || "",
        directUrl: best.url || "",
        resultUrl: best.url || "",
        listingUrl: best.url || "",
        currentCost: best.currentCost || "",
        audPrice: best.audPrice || "",
        audDisplay: best.audDisplay || ""
      });
    }) : [];
    vault.source = "Local music folder and imported catalogue files";
    if (!Array.isArray(vault.matchEvents)) vault.matchEvents = [];
    const albumsById = new Map(vault.albums.map(album => [album.id, album]));
    vault.matchEvents = vault.matchEvents
      .filter(event => !isKnownDigitalOnlyUrl(event?.listing?.url || event?.listing?.directUrl || event?.listing?.purchaseUrl))
      .map(event => {
        const listing = canonicalDiscogsListing(event.listing, albumsById.get(event.albumId));
        return listing ? { ...event, listing } : null;
      })
      .filter(Boolean);
    return vault;
  } catch (error) {
    return {
      schemaVersion: 2,
      albums: [],
      dataHealth: {
        ok: false,
        message: `Vault data could not be read: ${error.message}`,
        checkedAt: new Date().toISOString()
      }
    };
  }
}

function writeVault(vault) {
  atomicWriteJson(vaultPath, vault);
  return vault;
}

function mergeLibrarySnapshot(snapshot) {
  const current = readVault();
  const currentById = new Map((current.albums || []).map(album => [album.id, album]));
  const sourceFields = [
    "source", "sourcePath", "sourcePaths", "sourceFolderCount", "folderDepth",
    "artworkPath", "firstSeen", "lastSeen", "missing"
  ];
  const albums = (snapshot.albums || []).map(scanned => {
    const existing = currentById.get(scanned.id);
    if (!existing) return normaliseAlbum(scanned);
    const merged = { ...scanned, ...existing, id: scanned.id, artist: scanned.artist, album: scanned.album };
    for (const field of sourceFields) {
      if (scanned[field] !== undefined) merged[field] = scanned[field];
    }
    return normaliseAlbum(merged);
  });

  const snapshotIds = new Set(albums.map(album => album.id));
  for (const album of current.albums || []) {
    if (!snapshotIds.has(album.id)) albums.push(normaliseAlbum(album));
  }

  return writeVault({
    ...current,
    source: snapshot.source || current.source,
    lastSynced: snapshot.lastSynced || new Date().toISOString(),
    sync: snapshot.sync || current.sync || {},
    albums
  });
}

function editableAlbumChanges(payload = {}) {
  const allowed = [
    "album", "artist", "year", "genre", "status", "priority", "format",
    "currentCost", "minPrice", "maxPrice", "budgetCurrency", "purchaseUrl", "notes"
  ];
  const changes = {};
  for (const key of allowed) {
    if (payload[key] === undefined) continue;
    changes[key] = typeof payload[key] === "string" ? payload[key].trim().slice(0, key === "notes" ? 2000 : 500) : payload[key];
  }
  if (changes.status !== undefined) changes.status = normaliseStatus(changes.status);
  if (changes.priority !== undefined) changes.priority = Math.max(1, Math.min(5, Math.round(Number(changes.priority) || 3)));
  if (changes.format !== undefined) changes.format = String(changes.format || "cd").toLowerCase().slice(0, 40);
  if (changes.budgetCurrency !== undefined && !["AUD", "USD", "GBP", "EUR"].includes(String(changes.budgetCurrency).toUpperCase())) {
    delete changes.budgetCurrency;
  }
  if (changes.purchaseUrl && !/^https?:\/\//i.test(changes.purchaseUrl)) changes.purchaseUrl = "";
  return changes;
}

function saveAlbum(albumId, payload, create = false) {
  const vault = readVault();
  const index = vault.albums.findIndex(album => album.id === albumId);
  if (index < 0 && !create) return null;
  const previous = index >= 0 ? vault.albums[index] : {};
  const changes = editableAlbumChanges(payload);
  const album = normaliseAlbum({
    ...previous,
    ...changes,
    id: albumId,
    album: changes.album || previous.album,
    artist: changes.artist || previous.artist,
    source: previous.source || "manual",
    missing: previous.missing || false,
    dateAdded: previous.dateAdded || new Date().toISOString().slice(0, 10),
    lastDashboardSave: new Date().toISOString()
  });
  if (!album.album || !album.artist) throw new Error("Album and artist are required.");
  if (index >= 0) vault.albums[index] = album;
  else vault.albums.push(album);
  vault.lastDashboardSave = new Date().toISOString();
  writeVault(vault);
  getDailyScanPlan(vault, true);
  return album;
}

function readJsonText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function scanSummary(results) {
  const accepted = (results.albums || []).flatMap(album => album.listings || []);
  const failures = (results.albums || [])
    .filter(album => !(album.listings || []).length && ((album.rejected || []).length || String(album.notes || "")))
    .slice(0, 5)
    .map(album => ({
      artist: album.artist,
      album: album.album,
      notes: album.notes || (album.rejected || []).slice(0, 2).map(item => item.reason).join(" | ")
    }));
  return {
    scannedAt: results.scannedAt,
    provider: results.provider || "Free keyless web search",
    scanned: (results.albums || []).length,
    priced: accepted.filter(listing => listing.currentCost || listing.audPrice).length,
    available: accepted.length,
    directListings: accepted.length,
    failed: (results.albums || []).filter(album => !(album.listings || []).length && ((album.rejected || []).length || String(album.notes || ""))).length,
    rateLimited: results.rateLimited === true,
    failureExamples: failures,
    queue: results.queue || {},
    dailyPlan: results.dailyPlan || null
  };
}

function mergeScanResults() {
  const resultsPath = path.join(dataRoot, "availability-scan-results.json");
  if (!fs.existsSync(resultsPath)) return null;
  let results;
  try {
    results = JSON.parse(readJsonText(resultsPath));
  } catch (error) {
    return {
      scannedAt: new Date().toISOString(),
      scanned: 0,
      priced: 0,
      available: 0,
      directListings: 0,
      failed: 1,
      failureExamples: [{ artist: "System", album: "Availability scan", notes: `Scan results could not be read: ${error.message}` }]
    };
  }
  const vault = mergeAvailability(readVault(), results.albums || []);
  vault.lastScanSummary = scanSummary(results);
  writeVault(vault);
  return vault.lastScanSummary;
}

function startAvailabilityScan(limit = null, options = {}) {
  settings = loadSettings();
  const effectiveLimit = Math.max(1, Math.min(50, Number(limit || settings.scanLimit || scanLimit)));
  if (isOutboundWebDisabled()) {
    lastScannerMessage = "Internet scanning is disabled for dashboard-only mode.";
    return { ok: false, skipped: true, message: lastScannerMessage };
  }
  if (!options.manual && !settings.automationEnabled) {
    lastScannerMessage = "Automation is paused in Settings.";
    return { ok: false, skipped: true, message: lastScannerMessage };
  }
  const vault = readVault();
  const backoffUntil = Date.parse(vault.searchBackoffUntil || 0);
  if (!options.manual && Number.isFinite(backoffUntil) && backoffUntil > Date.now()) {
    lastScannerMessage = `Free web search is cooling down until ${new Date(backoffUntil).toLocaleString()} after a temporary provider limit. Manual retry remains available.`;
    return { ok: false, skipped: true, message: lastScannerMessage };
  }
  const plan = getDailyScanPlan(vault);
  if (plan.summary.requestsRemaining <= 0) {
    lastScannerMessage = `Today's ${plan.summary.dailyLimit}-album safety cap has been reached. Scanning resumes tomorrow in ${plan.summary.timeZone}.`;
    return { ok: false, skipped: true, message: lastScannerMessage };
  }
  if (!plan.summary.pending) {
    lastScannerMessage = "Today's selected albums have all been checked.";
    return { ok: false, skipped: true, message: lastScannerMessage };
  }
  if (scannerRunning) return { ok: false, skipped: true, message: "Scanner already running" };
  scannerRunning = true;
  const startedAt = new Date().toISOString();
  lastScannerMessage = "Scan started. Results will appear as each album is checked.";
  scannerProgress = { startedAt, completed: 0, total: Math.min(effectiveLimit, plan.summary.pending), album: null };

  let completeScan;
  const completion = new Promise(resolve => { completeScan = resolve; });
  const child = spawn(process.execPath, [scannerPath, vaultPath, String(effectiveLimit)], {
    cwd: root,
    env: {
      ...process.env,
      SCAN_LIMIT: String(effectiveLimit),
      VAULT_DATA_DIR: dataRoot,
      VAULT_DISABLE_WEB: settings.webAccessEnabled === false ? "1" : "0"
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true
  });
  scannerProcess = child;
  const receivedIds = new Set();
  const liveUpdates = [];
  let finalResults = null;
  let output = "";
  let error = "";

  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { error += chunk; });
  child.on("message", message => {
    if (!message || typeof message !== "object") return;
    if (message.type === "scan-start") {
      scannerProgress = { ...scannerProgress, total: message.batchTotal || scannerProgress.total };
      return;
    }
    if (message.type === "scan-progress") {
      scannerProgress = {
        ...scannerProgress,
        completed: message.batchIndex || 0,
        total: message.batchTotal || scannerProgress.total,
        album: message.album || null
      };
      lastScannerMessage = message.album
        ? `Checking ${message.album.artist} - ${message.album.album}`
        : "Checking the selected albums.";
      return;
    }
    if (message.type === "album-result" && message.update) {
      receivedIds.add(message.update.id);
      liveUpdates.push(message.update);
      const nextVault = mergeAvailability(readVault(), [message.update]);
      const partialResults = {
        scannedAt: new Date().toISOString(),
        provider: settings.searchProvider === "searxng" ? "Self-hosted SearXNG" : "DuckDuckGo keyless web search",
        rateLimited: liveUpdates.some(update => update.rateLimited === true),
        dailyPlan: message.dailyPlan,
        queue: {
          wantedScanned: liveUpdates.length,
          priorityFiveScanned: liveUpdates.filter(update => Number(update.priority || 3) === 5).length,
          selected: message.dailyPlan?.selected,
          pending: message.dailyPlan?.pending,
          requestsUsed: message.dailyPlan?.requestCount,
          requestsRemaining: message.dailyPlan?.requestsRemaining
        },
        albums: liveUpdates
      };
      nextVault.lastScanSummary = { ...scanSummary(partialResults), running: true };
      writeVault(nextVault);
      scannerProgress = {
        ...scannerProgress,
        completed: message.batchIndex || liveUpdates.length,
        total: message.batchTotal || scannerProgress.total,
        album: null
      };
      lastScannerMessage = `${scannerProgress.completed} of ${scannerProgress.total} albums checked. Verified results are already live.`;
      return;
    }
    if (message.type === "scan-complete") finalResults = message.results || null;
  });
  child.on("close", code => {
    if (scannerProcess === child) scannerProcess = null;
    scannerRunning = false;
    if (code !== 0) {
      lastScannerMessage = (error || output || `Scanner exited with ${code}`).trim();
      scannerProgress = { ...scannerProgress, finishedAt: new Date().toISOString(), failed: true };
      completeScan({ ok: false, error: lastScannerMessage });
      return;
    }

    if (!finalResults) {
      try {
        finalResults = JSON.parse(readJsonText(path.join(dataRoot, "availability-scan-results.json")));
      } catch {
        finalResults = { scannedAt: new Date().toISOString(), albums: liveUpdates };
      }
    }
    const missedUpdates = (finalResults.albums || []).filter(update => !receivedIds.has(update.id));
    const nextVault = missedUpdates.length ? mergeAvailability(readVault(), missedUpdates) : readVault();
    const summary = scanSummary(finalResults);
    nextVault.lastScanSummary = summary;
    writeVault(nextVault);
    lastScannerMessage = summary.rateLimited
      ? "The free search provider applied a temporary limit. Automatic retries are paused for one hour."
      : `Scan complete: ${summary.scanned} albums checked and ${summary.available} verified listings found.`;
    scannerProgress = { ...scannerProgress, completed: summary.scanned, finishedAt: new Date().toISOString(), album: null };
    completeScan({ ok: true, summary });
  });
  child.on("error", spawnError => {
    lastScannerMessage = spawnError.message;
  });

  return {
    ok: true,
    started: true,
    message: lastScannerMessage,
    progress: scannerProgress,
    completion
  };
}

function runAvailabilityScan(limit = null, options = {}) {
  const started = startAvailabilityScan(limit, options);
  return started.completion || Promise.resolve(started);
}

function runLibrarySync() {
  if (syncRunning) return Promise.resolve({ ok: false, skipped: true, message: "Music library sync already running" });
  syncRunning = true;
  lastSyncError = "";
  lastSyncMessage = `Music library sync started at ${new Date().toISOString()}`;
  return new Promise(resolve => {
    try {
      if (fs.existsSync(syncResultPath)) fs.unlinkSync(syncResultPath);
    } catch {}
    const child = spawn(process.execPath, [syncPath, musicRoot, vaultPath, syncResultPath], {
      cwd: root,
      env: { ...process.env, DEFAULT_CURRENCY: settings.currency || "USD" },
      windowsHide: true
    });
    syncProcess = child;
    let output = "";
    let error = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("close", code => {
      if (syncProcess === child) syncProcess = null;
      syncRunning = false;
      if (code !== 0) {
        lastSyncError = error || output || `Music library sync exited with ${code}`;
        lastSyncMessage = lastSyncError;
        resolve({ ok: false, error: lastSyncError });
        return;
      }
      try {
        const snapshot = JSON.parse(readJsonText(syncResultPath));
        mergeLibrarySnapshot(snapshot);
        fs.unlinkSync(syncResultPath);
      } catch (mergeError) {
        lastSyncError = `Music library results could not be merged: ${mergeError.message}`;
        lastSyncMessage = lastSyncError;
        resolve({ ok: false, error: lastSyncError });
        return;
      }
      lastSyncCompletedAt = new Date().toISOString();
      lastSyncMessage = (output || "Music library sync completed.").trim();
      resolve({ ok: true, message: lastSyncMessage });
    });
  });
}

function startLibraryWatcher() {
  if (libraryWatcher || !fs.existsSync(musicRoot)) {
    libraryWatcherStatus = { active: false, message: fs.existsSync(musicRoot) ? "Library watcher is already active." : "Music library folder was not found." };
    return;
  }
  try {
    libraryWatcher = fs.watch(musicRoot, { recursive: true }, () => {
      clearTimeout(libraryWatchTimer);
      libraryWatchTimer = setTimeout(() => runLibrarySync().catch(error => {
        lastSyncError = error.message;
        lastSyncMessage = error.message;
      }), 2500);
    });
    libraryWatcher.on("error", error => {
      libraryWatcherStatus = { active: false, message: `Real-time watcher stopped: ${error.message}. Ten-minute reconciliation remains active.` };
    });
    libraryWatcherStatus = { active: true, message: "Watching the local music folder for changes; ten-minute reconciliation is also active." };
  } catch (error) {
    libraryWatcherStatus = { active: false, message: `Real-time watching is unavailable: ${error.message}. Ten-minute reconciliation remains active.` };
  }
}

function buildSystemHealth(vault) {
  const resultsPath = path.join(dataRoot, "availability-scan-results.json");
  const dailyPlan = getDailyScanPlan(vault);
  const health = {
    server: {
      ok: true,
      port: server?.listening ? server.address().port : port,
      bindHost,
      localNetworkUrls: localNetworkUrls(),
      startedAt: serverStartedAt,
      uptimeSeconds: Math.round(process.uptime())
    },
    librarySync: {
      ok: !lastSyncError,
      running: syncRunning,
      intervalMs: syncIntervalMs,
      sourceAvailable: fs.existsSync(musicRoot),
      lastSynced: vault.lastSynced || null,
      lastCompletedAt: lastSyncCompletedAt || null,
      message: publicRuntimeMessage(lastSyncMessage) || "Music library sync has not run in this server session.",
      sync: vault.sync || {},
      watcher: libraryWatcherStatus
    },
    availabilityScanner: {
      ok: settings.automationEnabled && !isOutboundWebDisabled() && !(Date.parse(vault.searchBackoffUntil || 0) > Date.now()),
      running: scannerRunning,
      intervalMs: scanIntervalMs,
      limit: Number(settings.scanLimit || scanLimit),
      dailyLimit: Number(settings.dailyScanLimit || DEFAULT_DAILY_LIMIT),
      automationEnabled: settings.automationEnabled,
      provider: settings.searchProvider === "searxng" ? "Self-hosted SearXNG" : "DuckDuckGo keyless web search",
      outboundWebDisabled: isOutboundWebDisabled(),
      backoffUntil: vault.searchBackoffUntil || "",
      rateLimited: Date.parse(vault.searchBackoffUntil || 0) > Date.now(),
      message: lastScannerMessage || "Availability scanner has not run in this server session.",
      progress: scannerProgress,
      lastScanSummary: vault.lastScanSummary || null,
      dailyPlan: dailyPlan.summary,
      resultsFilePresent: fs.existsSync(resultsPath)
    },
    outboundWeb: lastNetworkStatus || {
      ok: null,
      running: networkTestRunning,
      checkedAt: null,
      message: "Outbound web access has not been tested in this server session.",
      checks: {}
    },
    vaultAgent: loadAgentStatus(),
    trustedVendors: {
      count: loadTrustedVendors().length,
      top: loadTrustedVendors().slice(0, 5)
    }
  };
  return health;
}

const serverStartedAt = new Date().toISOString();

const server = http.createServer(async (req, res) => {
  if (!isSameOriginMutation(req)) {
    send(res, 403, JSON.stringify({ ok: false, message: "Cross-origin changes are not allowed." }), types[".json"]);
    return;
  }

  try {
    if (req.url === "/api/vault" && req.method === "GET") {
      const vault = readVault();
      const resultsPath = path.join(dataRoot, "availability-scan-results.json");
      if (fs.existsSync(resultsPath)) {
        try {
          const results = JSON.parse(readJsonText(resultsPath));
          vault.lastScanSummary = vault.lastScanSummary || scanSummary(results);
        } catch (error) {
          vault.lastScanSummary = {
            scannedAt: new Date().toISOString(),
            scanned: 0,
            priced: 0,
            available: 0,
            directListings: 0,
            failed: 1,
            failureExamples: [{ artist: "System", album: "Availability scan", notes: `Scan results could not be read: ${error.message}` }]
          };
        }
      }
      const dailyPlan = getDailyScanPlan(vault);
      vault.scannerStatus = {
        running: scannerRunning,
        message: lastScannerMessage,
        intervalMs: scanIntervalMs,
        limit: Number(settings.scanLimit || scanLimit),
        dailyLimit: Number(settings.dailyScanLimit || DEFAULT_DAILY_LIMIT),
        provider: settings.searchProvider === "searxng" ? "Self-hosted SearXNG" : "DuckDuckGo keyless web search",
        outboundWebDisabled: isOutboundWebDisabled(),
        progress: scannerProgress
      };
      vault.syncStatus = { running: syncRunning, message: publicRuntimeMessage(lastSyncMessage), error: publicRuntimeMessage(lastSyncError), intervalMs: syncIntervalMs, sourceAvailable: fs.existsSync(musicRoot), lastCompletedAt: lastSyncCompletedAt };
      vault.settings = publicSettings();
      vault.dailyScanPlan = dailyPlan;
      vault.trustedVendors = loadTrustedVendors();
      vault.systemHealth = buildSystemHealth(vault);
      send(res, 200, JSON.stringify(publicVault(vault)), types[".json"], { "Cache-Control": "no-store" });
      return;
    }

    if (req.url === "/api/vault" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req));
      const current = readVault();
      const currentById = new Map((current.albums || []).map(album => [album.id, album]));
      const incomingAlbums = Array.isArray(payload.albums)
        ? payload.albums.map(album => normaliseAlbum({ ...(currentById.get(album.id) || {}), ...album }))
        : current.albums;
      const saved = {
        ...current,
        schemaVersion: 2,
        albums: incomingAlbums,
        matchEvents: Array.isArray(payload.matchEvents) ? payload.matchEvents : current.matchEvents,
        lastDashboardSave: payload.lastDashboardSave || new Date().toISOString(),
        lastSaved: new Date().toISOString()
      };
      writeVault(saved);
      const dailyPlan = getDailyScanPlan(saved, true);
      send(res, 200, JSON.stringify({ ok: true, saved: saved.lastSaved, dailyPlan }), types[".json"]);
      return;
    }

    const requestUrl = new URL(req.url, "http://localhost");
    const albumRoute = requestUrl.pathname.match(/^\/api\/albums\/([^/]+)$/);
    if (albumRoute && ["PUT", "PATCH", "DELETE"].includes(req.method)) {
      const albumId = decodeURIComponent(albumRoute[1]);
      if (req.method === "DELETE") {
        const vault = readVault();
        const album = vault.albums.find(item => item.id === albumId);
        if (!album) {
          send(res, 404, JSON.stringify({ ok: false, message: "Album not found." }), types[".json"]);
          return;
        }
        if (album.sourcePath || (album.sourcePaths || []).length || album.source === "music-folder") {
          send(res, 409, JSON.stringify({ ok: false, message: "Synced albums stay linked to the music library. Mark this album Not Interested instead." }), types[".json"]);
          return;
        }
        vault.albums = vault.albums.filter(item => item.id !== albumId);
        vault.lastDashboardSave = new Date().toISOString();
        writeVault(vault);
        getDailyScanPlan(vault, true);
        send(res, 200, JSON.stringify({ ok: true }), types[".json"]);
        return;
      }

      const payload = JSON.parse(await readBody(req));
      const album = saveAlbum(albumId, payload, req.method === "PUT");
      if (!album) {
        send(res, 404, JSON.stringify({ ok: false, message: "Album not found." }), types[".json"]);
        return;
      }
      send(res, 200, JSON.stringify({ ok: true, album: publicVault({ albums: [album] }).albums[0] }), types[".json"]);
      return;
    }

    const artworkRoute = requestUrl.pathname.match(/^\/api\/artwork\/([^/]+)$/);
    if (artworkRoute && req.method === "GET") {
      const albumId = decodeURIComponent(artworkRoute[1]);
      const album = readVault().albums.find(item => item.id === albumId);
      const artwork = album ? safeArtworkForAlbum(album) : null;
      if (!artwork) {
        send(res, 404, "Artwork not found");
        return;
      }
      send(res, 200, fs.readFileSync(artwork.path), artwork.contentType, { "Cache-Control": "private, max-age=3600" });
      return;
    }

    if (req.url === "/api/settings" && req.method === "GET") {
      send(res, 200, JSON.stringify(publicSettings()), types[".json"]);
      return;
    }

    if (req.url === "/api/settings" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req));
      send(res, 200, JSON.stringify(saveSettings(payload)), types[".json"]);
      return;
    }

    if (req.url === "/api/library-source" && req.method === "POST") {
      if (!isLocalRequest(req)) {
        send(res, 403, JSON.stringify({ ok: false, message: "The source folder can only be changed on the host PC." }), types[".json"]);
        return;
      }
      if (syncRunning) {
        send(res, 409, JSON.stringify({ ok: false, message: "Wait for the current library sync to finish, then try again." }), types[".json"]);
        return;
      }
      const payload = JSON.parse(await readBody(req));
      let nextSettings;
      try {
        nextSettings = setLibraryRoot(payload.path);
      } catch (error) {
        send(res, 400, JSON.stringify({ ok: false, message: error.message }), types[".json"]);
        return;
      }
      runLibrarySync().catch(error => {
        lastSyncError = error.message;
        lastSyncMessage = error.message;
      });
      send(res, 202, JSON.stringify({ ok: true, settings: nextSettings, message: "Source folder connected. Library sync has started." }), types[".json"]);
      return;
    }

    if (req.url === "/api/scan-plan" && req.method === "GET") {
      send(res, 200, JSON.stringify(getDailyScanPlan(readVault())), types[".json"]);
      return;
    }

    if (req.url === "/api/scan-plan/select" && req.method === "POST") {
      const plan = getDailyScanPlan(readVault(), true);
      lastScannerMessage = `${plan.summary.selected} albums selected for today's free web scan. Priority 5 albums are first.`;
      send(res, 200, JSON.stringify({ ok: true, plan }), types[".json"]);
      return;
    }

    if (req.url === "/api/network-test" && ["GET", "POST"].includes(req.method)) {
      const status = await runNetworkTest();
      send(res, 200, JSON.stringify(status), types[".json"]);
      return;
    }

    if (req.url.startsWith("/api/scan") && req.method === "POST") {
      if (isOutboundWebDisabled()) {
        send(res, 409, JSON.stringify({ ok: false, skipped: true, message: "Internet scanning is disabled for dashboard-only mode." }), types[".json"]);
        return;
      }
      const requestUrl = new URL(req.url, "http://localhost");
      const limit = Number(requestUrl.searchParams.get("limit") || settings.scanLimit || 25);
      const result = startAvailabilityScan(limit, { manual: true });
      const status = result.started ? 202 : result.skipped ? 200 : 500;
      send(res, status, JSON.stringify({
        ok: result.ok,
        started: result.started === true,
        skipped: result.skipped === true,
        message: result.message,
        progress: result.progress,
        plan: getDailyScanPlan(readVault())
      }), types[".json"]);
      return;
    }

    if (req.url === "/api/shutdown" && req.method === "POST") {
      if (!isLocalRequest(req)) {
        send(res, 403, JSON.stringify({ ok: false, message: "Local access only" }), types[".json"]);
        return;
      }
      send(res, 200, JSON.stringify({ ok: true, message: "Physical Music Vault is stopping." }), types[".json"]);
      setTimeout(() => {
        if (scannerProcess && !scannerProcess.killed) scannerProcess.kill();
        if (syncProcess && !syncProcess.killed) syncProcess.kill();
        if (libraryWatcher) libraryWatcher.close();
        server.close(() => process.exit(0));
      }, 100);
      return;
    }

    const file = publicFileFromUrl(req.url);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      send(res, 404, "Not found");
      return;
    }

    send(res, 200, fs.readFileSync(file), types[path.extname(file).toLowerCase()] || "application/octet-stream", { "Cache-Control": "no-cache" });
  } catch (error) {
    send(res, 500, JSON.stringify({ ok: false, error: error.message }), types[".json"]);
  }
});

server.listen(port, bindHost, () => {
  const activePort = server.address().port;
  console.log(`Physical Music Vault running at http://localhost:${activePort}`);
  if (testMode) return;
  startLibraryWatcher();
  setTimeout(() => runNetworkTest().catch(error => { lastNetworkStatus = { ok: false, message: error.message, checkedAt: new Date().toISOString(), checks: {} }; }), 500);
  setTimeout(() => runLibrarySync().catch(error => { lastSyncError = error.message; lastSyncMessage = error.message; }), 1000);
  setTimeout(() => refreshExchangeRates()
    .finally(() => runAvailabilityScan().catch(error => { lastScannerMessage = error.message; })), 10000);
  setInterval(() => runNetworkTest().catch(error => { lastNetworkStatus = { ok: false, message: error.message, checkedAt: new Date().toISOString(), checks: {} }; }), scanIntervalMs);
  setInterval(() => runLibrarySync().catch(error => { lastSyncError = error.message; lastSyncMessage = error.message; }), syncIntervalMs);
  setInterval(() => runAvailabilityScan().catch(error => { lastScannerMessage = error.message; }), scanIntervalMs);
  setInterval(() => refreshExchangeRates(), 24 * 60 * 60 * 1000);
});
