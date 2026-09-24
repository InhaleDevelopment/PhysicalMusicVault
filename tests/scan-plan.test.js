const test = require("node:test");
const assert = require("node:assert/strict");
const { createDailyPlan, nextBatch, planSummary } = require("../outputs/scan-plan");

function album(id, priority, status = "wanted", extra = {}) {
  return { id, artist: `Artist ${id}`, album: `Album ${id}`, priority, status, ...extra };
}

test("daily plan selects only Wanted albums and orders priority first", () => {
  const vault = { albums: [
    album("low", 1),
    album("owned", 5, "owned"),
    album("high", 5),
    album("missing", 5, "wanted", { missing: true }),
    album("medium", 3)
  ] };
  const plan = createDailyPlan(vault, 500, null, new Date("2026-09-24T00:00:00Z"));
  assert.deepEqual(plan.albums.map(item => item.id), ["high", "medium", "low"]);
  assert.equal(planSummary(plan).priorityFiveSelected, 1);
});

test("batch respects the daily request allowance", () => {
  const vault = { albums: [album("one", 5), album("two", 4), album("three", 3)] };
  const plan = createDailyPlan(vault, 2, null, new Date("2026-09-24T00:00:00Z"));
  plan.requestCount = 1;
  assert.deepEqual(nextBatch(vault, plan, 25).map(item => item.id), ["one"]);
});

test("manual reselection retries failed albums without resetting request usage", () => {
  const vault = { albums: [album("important", 5)] };
  const now = new Date("2026-09-24T00:00:00Z");
  const previous = createDailyPlan(vault, 500, null, now);
  previous.requestCount = 7;
  previous.albums[0].status = "failed";
  const retried = createDailyPlan(vault, 500, previous, now, { retryFailed: true });
  assert.equal(retried.requestCount, 7);
  assert.equal(retried.albums[0].status, "pending");
});

test("daily boundaries use the configured device timezone", () => {
  const vault = { albums: [album("local", 5)] };
  const instant = new Date("2026-09-24T15:30:00Z");
  const sydney = createDailyPlan(vault, 500, null, instant, { timeZone: "Australia/Sydney" });
  const london = createDailyPlan(vault, 500, null, instant, { timeZone: "Europe/London" });
  assert.equal(sydney.day, "2026-09-25");
  assert.equal(london.day, "2026-09-24");
});

test("switching physical format prepares new searches without resetting daily usage", () => {
  const vault = { albums: [album("one", 5), album("two", 3)] };
  const now = new Date("2026-09-24T00:00:00Z");
  const cdPlan = createDailyPlan(vault, 500, null, now, { searchFormat: "cd" });
  cdPlan.requestCount = 12;
  cdPlan.albums[0].status = "completed";
  const vinylPlan = createDailyPlan(vault, 500, cdPlan, now, { searchFormat: "vinyl" });
  assert.equal(vinylPlan.searchFormat, "vinyl");
  assert.equal(vinylPlan.requestCount, 12);
  assert.deepEqual(vinylPlan.albums.map(item => item.status), ["pending", "pending"]);
});
