const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../outputs/physical-music-vault.html"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../outputs/vault.css"), "utf8");

test("dashboard exposes the required catalogue controls", () => {
  for (const text of ["Wanted", "Owned", "Not Interested", "Priority", "Budget currency", "CD", "Vinyl", "Cassette"]) {
    assert.match(html, new RegExp(text));
  }
  assert.doesNotMatch(html, /option value="box set"/i);
});

test("web scanning requires informed opt-in", () => {
  assert.match(html, /Artist and album search terms will be sent/);
  assert.match(html, /window\.confirm\("Enable web scanning\?/);
});

test("dashboard contains the required result portals", () => {
  for (const text of ["Successful Matches Today", "Top 100 Available Albums", "Priority 5 Matches", "Today's 500"]) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("dashboard browser script parses", () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(() => new Function(match[1]));
});

test("empty album editor can be closed without required-field validation", () => {
  assert.match(
    html,
    /value="cancel"[^>]*formnovalidate[^>]*aria-label="Close editor"/
  );
});

test("library controls and copy are provider-neutral", () => {
  assert.match(html, /Synced source folder/);
  assert.match(html, /Import catalogue file/);
  for (const legacyName of ["Apple" + " Music", "Metal" + "lum", "metal-" + "archives"]) {
    assert.equal(html.toLowerCase().includes(legacyName.toLowerCase()), false);
  }
});

test("album artwork uses stable square containers without distortion", () => {
  assert.match(css, /\.shelf-cover-frame[\s\S]*aspect-ratio:\s*1/);
  assert.match(css, /\.shelf-cover-frame \.album-cover[\s\S]*height:\s*100%/);
  assert.match(css, /aspect-ratio:\s*1/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(css, /object-position:\s*center/);
});

test("collection is an interactive shelf with centred detail controls", () => {
  assert.match(html, /class="shelf-album"/);
  assert.match(html, /class="shelf-row/);
  assert.match(html, /data-album-tile=/);
  assert.match(html, /class="album-detail-layout"/);
  assert.match(css, /url\("assets\/music-shelf\.png"\)/);
  assert.match(html, /class="shelf-label/);
  assert.match(html, /const tileTitle = `\$\{album\.album\} - \$\{album\.artist\}`/);
  assert.match(css, /\.shelf-label/);
  assert.doesNotMatch(css, /\.shelf-peek/);
  assert.doesNotMatch(html, /id="formatFilter"/);
  assert.doesNotMatch(html, /data-editor-group="format"/);
});

test("physical format is selected when a search starts", () => {
  for (const format of ["cd", "vinyl", "cassette"]) assert.match(html, new RegExp(`data-scan-format="${format}"`));
  assert.match(html, /Artist - Album cd buy/);
  assert.match(html, /\["vinyl", "LP"\]/);
  assert.match(html, /\["tape", "cassette"\]/);
  assert.match(html, /\/api\/scan\?limit=25&format=/);
});

test("dashboard exposes market and delivered-cost controls", () => {
  for (const id of ["marketScope", "marketCountry", "marketRegion"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const text of ["Worldwide", "Country", "Region", "Delivery", "Total"]) assert.match(html, new RegExp(text));
});
