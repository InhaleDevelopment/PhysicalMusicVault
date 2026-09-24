const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  findAlbumArtwork,
  normaliseSettingsUpdate,
  publicVault,
  safeArtworkForAlbum
} = require("../outputs/vault-platform");

test("public vault responses never expose local filesystem paths", () => {
  const payload = publicVault({
    musicRoot: "C:\\Users\\person\\Music",
    libraryRoot: "C:\\Users\\person\\Music",
    albums: [{
      id: "artist-album",
      artist: "Artist",
      album: "Album",
      sourcePath: "C:\\Users\\person\\Music\\Artist\\Album",
      sourcePaths: ["C:\\Users\\person\\Music\\Artist\\Album"],
      artworkPath: "C:\\Users\\person\\Music\\Artist\\Album\\Folder.jpg"
    }],
    systemHealth: { librarySync: { libraryRoot: "C:\\Users\\person\\Music" } }
  });

  const text = JSON.stringify(payload);
  assert.equal(text.includes("C:\\\\Users"), false);
  assert.equal(payload.albums[0].artworkUrl, "/api/artwork/artist-album");
  assert.equal(payload.albums[0].artworkAvailable, true);
});

test("settings updates are allowlisted and bounded", () => {
  const update = normaliseSettingsUpdate({
    automationEnabled: false,
    scanLimit: 5000,
    dailyScanLimit: -4,
    searchProvider: "unknown",
    apiKey: "do-not-store",
    libraryRoot: "C:\\private-library",
    currency: "gbp",
    timeZone: "Australia/Sydney"
  });

  assert.deepEqual(update, {
    automationEnabled: false,
    scanLimit: 50,
    dailyScanLimit: 1,
    currency: "GBP",
    timeZone: "Australia/Sydney"
  });
});

test("artwork discovery prefers a front cover and serves only files inside the album", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-artwork-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "back.jpg"), "back");
  fs.writeFileSync(path.join(root, "Folder.jpg"), "front");
  const artworkPath = findAlbumArtwork(root);
  assert.equal(path.basename(artworkPath), "Folder.jpg");
  assert.deepEqual(safeArtworkForAlbum({ sourcePath: root, artworkPath }), {
    path: artworkPath,
    contentType: "image/jpeg"
  });

  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.jpg`);
  fs.writeFileSync(outside, "outside");
  t.after(() => fs.rmSync(outside, { force: true }));
  assert.equal(safeArtworkForAlbum({ sourcePath: root, artworkPath: outside }), null);
});
