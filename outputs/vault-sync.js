const fs = require("fs");
const os = require("os");
const path = require("path");
const { normaliseAlbum } = require("./catalog-model");
const { atomicWriteJson, findAlbumArtwork } = require("./vault-platform");

const musicRoot = process.argv[2] || path.join(os.homedir(), "Music");
const vaultPath = process.argv[3] || path.join(__dirname, "vault-data.json");
const outputPath = process.argv[4] || vaultPath;
const defaultCurrency = ["AUD", "USD", "GBP", "EUR"].includes(String(process.env.DEFAULT_CURRENCY || "").toUpperCase())
  ? String(process.env.DEFAULT_CURRENCY).toUpperCase()
  : "USD";

function makeId(artist, album) {
  return `${artist}::${album}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readVault() {
  try {
    return JSON.parse(fs.readFileSync(vaultPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {
      schemaVersion: 2,
      source: "Local music folder",
      musicRoot,
      lastSynced: null,
      albums: [],
      sync: { totalFolders: 0, active: 0, missing: 0, added: 0, updated: 0 }
    };
  }
}

function allFolders(root) {
  const folders = [];
  const pending = [root];
  while (pending.length) {
    const parent = pending.pop();
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(parent, entry.name);
      folders.push(fullPath);
      pending.push(fullPath);
    }
  }
  return folders;
}

function folderAlbum(folderPath, now) {
  const relative = path.relative(musicRoot, folderPath);
  const parts = relative.split(path.sep).filter(Boolean);
  const artist = parts[0] || path.basename(folderPath);
  const album = parts[1] || path.basename(folderPath);
  return normaliseAlbum({
    id: makeId(artist, album),
    album,
    artist,
    year: "",
    genre: "",
    dateAdded: "",
    status: "wanted",
    priority: 3,
    format: "cd",
    purchaseUrl: "",
    directUrl: "",
    resultUrl: "",
    listingUrl: "",
    currentCost: "",
    verifiedPurchase: false,
    purchaseActionFound: false,
    minPrice: "",
    maxPrice: "",
    budgetCurrency: defaultCurrency,
    currency: "",
    marketplace: "",
    seller: "",
    availableAt: "",
    notes: "",
    sourcePath: folderPath,
    artworkPath: findAlbumArtwork(folderPath),
    folderDepth: parts.length,
    source: "music-folder",
    firstSeen: now,
    lastSeen: now,
    lastChecked: "",
    missing: false
  });
}

function mergeAlbum(previous, next, now) {
  return normaliseAlbum({
    ...previous,
    ...next,
    id: previous.id || next.id,
    year: previous.year || "",
    genre: previous.genre || "",
    dateAdded: previous.dateAdded || "",
    status: previous.status || "wanted",
    priority: previous.priority,
    format: previous.format || "cd",
    purchaseUrl: previous.purchaseUrl || "",
    directUrl: previous.directUrl || "",
    resultUrl: previous.resultUrl || "",
    listingUrl: previous.listingUrl || "",
    currentCost: previous.currentCost || previous.price || "",
    verifiedPurchase: Boolean(previous.verifiedPurchase),
    purchaseActionFound: Boolean(previous.purchaseActionFound),
    minPrice: previous.minPrice || previous.priceMin || "",
    maxPrice: previous.maxPrice || previous.priceMax || previous.targetPrice || "",
    budgetCurrency: previous.budgetCurrency || previous.priceCurrency || defaultCurrency,
    currency: previous.currency || "",
    marketplace: previous.marketplace || "",
    seller: previous.seller || "",
    availableAt: previous.availableAt || "",
    notes: previous.notes || "",
    firstSeen: previous.firstSeen || now,
    lastSeen: now,
    lastChecked: previous.lastChecked || "",
    missing: false
  });
}

function isAlbumFolder(folderPath) {
  const relative = path.relative(musicRoot, folderPath);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length !== 2) return false;
  return !["itunes", "automatically add to music"].includes(String(parts[0]).toLowerCase());
}

function main() {
  if (!fs.existsSync(musicRoot)) throw new Error(`Music folder not found: ${musicRoot}`);

  const now = new Date().toISOString();
  const vault = readVault();
  const existing = new Map((vault.albums || []).filter(album => album.id).map(album => [album.id, album]));
  const folders = allFolders(musicRoot);
  const albumFolders = folders.filter(isAlbumFolder);
  const seen = new Set();
  const discovered = new Map();
  let added = 0;
  let updated = 0;

  for (const folder of albumFolders) {
    const next = folderAlbum(folder, now);
    seen.add(next.id);
    if (!discovered.has(next.id)) {
      const album = existing.has(next.id)
        ? mergeAlbum(existing.get(next.id), next, now)
        : next;
      album.sourcePaths = [next.sourcePath];
      album.sourceFolderCount = 1;
      discovered.set(next.id, album);
      if (existing.has(next.id)) updated += 1;
      else added += 1;
      continue;
    }

    const album = discovered.get(next.id);
    album.sourcePaths.push(next.sourcePath);
    album.sourceFolderCount = album.sourcePaths.length;
  }

  const albums = [...discovered.values()];
  for (const album of vault.albums || []) {
    if (!album.id || seen.has(album.id)) continue;
    const hasFolderSource = Boolean(album.sourcePath || (album.sourcePaths || []).length);
    if (!hasFolderSource) {
      albums.push({ ...normaliseAlbum(album), missing: false });
      continue;
    }
    const legacyGeneratedFolder = Number(album.folderDepth || 0) !== 2;
    if (!legacyGeneratedFolder) albums.push({ ...normaliseAlbum(album), missing: true });
  }

  albums.sort((a, b) =>
    String(a.artist || "").localeCompare(String(b.artist || "")) ||
    String(a.album || "").localeCompare(String(b.album || "")) ||
    String(a.sourcePath || "").localeCompare(String(b.sourcePath || ""))
  );

  const activeAlbums = albums.filter(album => !album.missing).length;
  const missingAlbums = albums.length - activeAlbums;
  const output = {
    ...vault,
    schemaVersion: 2,
    source: "Local music folder",
    musicRoot,
    lastSynced: now,
    albums,
    sync: {
      totalFolders: folders.length,
      albumFolders: albumFolders.length,
      active: activeAlbums,
      activeAlbums,
      missing: missingAlbums,
      added,
      updated
    }
  };

  atomicWriteJson(outputPath, output);
  console.log(`Synced ${albumFolders.length} album folders into ${activeAlbums} albums: ${missingAlbums} missing, ${added} new.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
