const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("sync treats only Artist/Album folders as albums and preserves choices", t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "physical-music-vault-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const music = path.join(temp, "Music");
  const vaultPath = path.join(temp, "vault.json");
  fs.mkdirSync(path.join(music, "Artist One", "Album One", "Artwork"), { recursive: true });
  fs.mkdirSync(path.join(music, "Artist Two", "Album Two", "CD1"), { recursive: true });

  const script = path.resolve(__dirname, "../outputs/vault-sync.js");
  let run = spawnSync(process.execPath, [script, music, vaultPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  let vault = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
  assert.equal(vault.albums.length, 2);
  assert.equal(vault.sync.albumFolders, 2);
  assert.equal(vault.albums.every(item => item.folderDepth === 2), true);

  vault.albums[0].status = "owned";
  vault.albums[0].priority = 5;
  fs.writeFileSync(vaultPath, JSON.stringify(vault), "utf8");
  run = spawnSync(process.execPath, [script, music, vaultPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  vault = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
  assert.equal(vault.albums[0].status, "owned");
  assert.equal(vault.albums[0].priority, 5);
});
