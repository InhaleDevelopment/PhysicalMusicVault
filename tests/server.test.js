const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Test server did not start")), 10000);
    child.stdout.on("data", chunk => {
      const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Test server exited with ${code}`));
    });
  });
}

test("local server protects private data and supports the core album journey", async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-server-"));
  const albumRoot = path.join(dataRoot, "music", "Artist", "Album");
  fs.mkdirSync(albumRoot, { recursive: true });
  const artworkPath = path.join(albumRoot, "Folder.jpg");
  fs.writeFileSync(artworkPath, "cover");
  fs.writeFileSync(path.join(dataRoot, "vault-data.json"), JSON.stringify({
    schemaVersion: 2,
    musicRoot: path.join(dataRoot, "music"),
    albums: [{
      id: "artist-album",
      artist: "Artist",
      album: "Album",
      status: "wanted",
      priority: 3,
      format: "cd",
      source: "apple-music-folder",
      sourcePath: albumRoot,
      sourcePaths: [albumRoot],
      artworkPath
    }],
    matchEvents: []
  }));

  const child = spawn(process.execPath, [path.resolve(__dirname, "../outputs/vault-server.js")], {
    env: { ...process.env, VAULT_PORT: "0", VAULT_TEST_MODE: "1", VAULT_DATA_DIR: dataRoot },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => {
    child.kill();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  const port = await waitForServer(child);
  const base = `http://127.0.0.1:${port}`;

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Physical Music Vault/);
  assert.equal((await fetch(`${base}/vault-data.json`)).status, 404);

  let response = await fetch(`${base}/api/vault`);
  let vault = await response.json();
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(vault).includes(dataRoot), false);
  assert.equal(vault.albums[0].artworkUrl, "/api/artwork/artist-album");
  assert.equal((await fetch(`${base}${vault.albums[0].artworkUrl}`)).status, 200);

  response = await fetch(`${base}/api/albums/artist-album`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "owned", sourcePath: "C:\\leak", priority: 5 })
  });
  assert.equal(response.status, 200);
  vault = await (await fetch(`${base}/api/vault`)).json();
  assert.equal(vault.albums[0].status, "owned");
  assert.equal(vault.albums[0].priority, 5);
  assert.equal(JSON.stringify(vault).includes("C:\\\\leak"), false);

  response = await fetch(`${base}/api/albums/manual-release`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artist: "Manual Artist", album: "Manual Release", status: "wanted", priority: 4 })
  });
  assert.equal(response.status, 200);
  assert.equal((await fetch(`${base}/api/albums/manual-release`, { method: "DELETE" })).status, 200);
  assert.equal((await fetch(`${base}/api/albums/artist-album`, { method: "DELETE" })).status, 409);
});
