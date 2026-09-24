const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../outputs/physical-music-vault.html"), "utf8");

test("dashboard exposes the required catalogue controls", () => {
  for (const text of ["Wanted", "Owned", "Not Interested", "Priority", "Budget Currency"]) {
    assert.match(html, new RegExp(text));
  }
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
