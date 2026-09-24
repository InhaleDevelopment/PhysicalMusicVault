const fs = require("fs");
const path = require("path");

const PRIVATE_ALBUM_FIELDS = new Set([
  "artworkPath",
  "sourcePath",
  "sourcePaths"
]);

const IMAGE_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function albumArtworkUrl(album) {
  return album?.id && album?.artworkPath ? `/api/artwork/${encodeURIComponent(album.id)}` : "";
}

function publicAlbum(album = {}) {
  const output = {};
  for (const [key, value] of Object.entries(album)) {
    if (!PRIVATE_ALBUM_FIELDS.has(key)) output[key] = value;
  }
  output.artworkUrl = albumArtworkUrl(album);
  output.artworkAvailable = Boolean(album.artworkPath);
  return output;
}

function stripLocalPathFields(value) {
  if (!value || typeof value !== "object") return value;
  const output = Array.isArray(value) ? [] : {};
  for (const [key, nested] of Object.entries(value)) {
    if (["musicRoot", "libraryRoot", "sourcePath", "sourcePaths", "artworkPath"].includes(key)) continue;
    output[key] = stripLocalPathFields(nested);
  }
  return output;
}

function publicVault(vault = {}) {
  const output = stripLocalPathFields(vault);
  output.albums = (vault.albums || []).map(publicAlbum);
  return output;
}

function validTimeZone(value) {
  if (!value || typeof value !== "string" || value.length > 100) return false;
  try {
    Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normaliseSettingsUpdate(payload = {}) {
  const next = {};
  for (const key of ["automationEnabled", "webAccessEnabled", "allowLanAccess"]) {
    if (typeof payload[key] === "boolean") next[key] = payload[key];
  }

  const numberRules = {
    scanIntervalMs: [5 * 60 * 1000, 24 * 60 * 60 * 1000],
    syncIntervalMs: [60 * 1000, 24 * 60 * 60 * 1000],
    scanLimit: [1, 50],
    dailyScanLimit: [1, 500],
    searchResultLimit: [5, 50],
    maxListingsPerAlbum: [1, 25]
  };
  for (const [key, [minimum, maximum]] of Object.entries(numberRules)) {
    const number = boundedInteger(payload[key], minimum, maximum);
    if (number !== null) next[key] = number;
  }

  if (["duckduckgo", "searxng"].includes(payload.searchProvider)) {
    next.searchProvider = payload.searchProvider;
  }
  if (typeof payload.searxngUrl === "string") {
    const url = payload.searxngUrl.trim().slice(0, 500);
    if (!url || /^https?:\/\//i.test(url)) next.searxngUrl = url.replace(/\/+$/, "");
  }
  if (validTimeZone(payload.timeZone)) next.timeZone = payload.timeZone;
  if (["AUD", "USD", "GBP", "EUR"].includes(String(payload.currency || "").toUpperCase())) {
    next.currency = String(payload.currency).toUpperCase();
  }
  if (["worldwide", "country", "region"].includes(payload.marketScope)) {
    next.marketScope = payload.marketScope;
  }
  if (/^[A-Z]{2}$/.test(String(payload.marketCountry || "").toUpperCase())) {
    next.marketCountry = String(payload.marketCountry).toUpperCase();
  }
  if (["oceania", "north-america", "south-america", "europe", "asia", "africa"].includes(payload.marketRegion)) {
    next.marketRegion = payload.marketRegion;
  }
  return next;
}

function artworkScore(fileName) {
  const name = String(fileName || "").toLowerCase();
  let score = 0;
  if (/^(folder|cover|front)\.(jpe?g|png|webp)$/.test(name)) score += 100;
  if (/^albumart/.test(name)) score += 80;
  if (/cover|front|folder/.test(name)) score += 50;
  if (/small/.test(name)) score -= 10;
  if (/back|rear|disc|cd\d|booklet/.test(name)) score -= 100;
  return score;
}

function imageFilesIn(folderPath) {
  try {
    return fs.readdirSync(folderPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && IMAGE_TYPES.has(path.extname(entry.name).toLowerCase()))
      .map(entry => path.join(folderPath, entry.name));
  } catch {
    return [];
  }
}

function findAlbumArtwork(folderPath) {
  const direct = imageFilesIn(folderPath);
  let nested = [];
  try {
    const artworkFolders = fs.readdirSync(folderPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /art|cover|image/i.test(entry.name))
      .slice(0, 3);
    nested = artworkFolders.flatMap(entry => imageFilesIn(path.join(folderPath, entry.name)));
  } catch {}
  return [...direct, ...nested]
    .sort((left, right) => artworkScore(path.basename(right)) - artworkScore(path.basename(left)) || left.localeCompare(right))[0] || "";
}

function isPathInside(parentPath, childPath) {
  try {
    const parent = fs.realpathSync(parentPath);
    const child = fs.realpathSync(childPath);
    const relative = path.relative(parent, child);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function safeArtworkForAlbum(album = {}) {
  const artworkPath = album.artworkPath || "";
  const extension = path.extname(artworkPath).toLowerCase();
  if (!artworkPath || !IMAGE_TYPES.has(extension) || !fs.existsSync(artworkPath)) return null;
  const roots = [...(album.sourcePaths || []), album.sourcePath].filter(Boolean);
  if (!roots.some(rootPath => isPathInside(rootPath, artworkPath))) return null;
  return { path: artworkPath, contentType: IMAGE_TYPES.get(extension) };
}

module.exports = {
  atomicWriteJson,
  findAlbumArtwork,
  normaliseSettingsUpdate,
  publicAlbum,
  publicVault,
  safeArtworkForAlbum,
  validTimeZone
};
