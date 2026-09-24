const fs = require("fs");
const { albumPriority, compareScanPriority, isSearchEligible } = require("./catalog-model");
const { atomicWriteJson } = require("./vault-platform");

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const DEFAULT_DAILY_LIMIT = 500;

function clampDailyLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DAILY_LIMIT;
  return Math.max(1, Math.min(DEFAULT_DAILY_LIMIT, Math.floor(parsed)));
}

function validTimeZone(value) {
  try {
    Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return TIME_ZONE;
  }
}

function dayKey(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function eligibleAlbums(vault) {
  return (vault.albums || []).filter(isSearchEligible);
}

function createDailyPlan(vault, requestedLimit = DEFAULT_DAILY_LIMIT, previousPlan = null, now = new Date(), options = {}) {
  const limit = clampDailyLimit(requestedLimit);
  const timeZone = validTimeZone(options.timeZone || previousPlan?.timeZone || TIME_ZONE);
  const today = dayKey(now, timeZone);
  const sameDayPlan = previousPlan?.day === today ? previousPlan : null;
  const previousById = new Map((sameDayPlan?.albums || []).map(item => [item.id, item]));
  const eligible = eligibleAlbums(vault);
  const selected = eligible.slice().sort(compareScanPriority).slice(0, limit);

  const albums = selected.map((album, index) => {
    const previous = previousById.get(album.id) || {};
    return {
      id: album.id,
      artist: album.artist || "Unknown artist",
      album: album.album || "Unknown album",
      priority: albumPriority(album),
      position: index + 1,
      status: options.retryFailed && previous.status === "failed" ? "pending" : previous.status || "pending",
      attemptedAt: previous.attemptedAt || "",
      completedAt: previous.completedAt || "",
      outcome: previous.outcome || ""
    };
  });

  return {
    schemaVersion: 1,
    day: today,
    timeZone,
    dailyLimit: limit,
    selectedAt: now.toISOString(),
    requestCount: Math.max(0, Number(sameDayPlan?.requestCount || 0)),
    priorityFiveAvailable: eligible.filter(album => albumPriority(album) === 5).length,
    wantedAvailable: eligible.length,
    albums
  };
}

function ensureDailyPlan(vault, requestedLimit, previousPlan, now = new Date(), options = {}) {
  const timeZone = validTimeZone(options.timeZone || previousPlan?.timeZone || TIME_ZONE);
  const today = dayKey(now, timeZone);
  if (previousPlan?.day === today && previousPlan?.timeZone === timeZone && Array.isArray(previousPlan.albums)) return previousPlan;
  return createDailyPlan(vault, requestedLimit, null, now, { ...options, timeZone });
}

function planSummary(plan) {
  const albums = plan?.albums || [];
  const completed = albums.filter(item => item.status === "completed").length;
  const failed = albums.filter(item => item.status === "failed").length;
  const requestCount = Math.max(0, Number(plan?.requestCount || 0));
  const dailyLimit = clampDailyLimit(plan?.dailyLimit);
  return {
    day: plan?.day || dayKey(new Date(), plan?.timeZone || TIME_ZONE),
    timeZone: plan?.timeZone || TIME_ZONE,
    dailyLimit,
    selected: albums.length,
    priorityFiveSelected: albums.filter(item => Number(item.priority) === 5).length,
    wantedSelected: albums.length,
    completed,
    failed,
    pending: albums.filter(item => item.status === "pending").length,
    requestCount,
    requestsRemaining: Math.max(0, dailyLimit - requestCount),
    selectedAt: plan?.selectedAt || ""
  };
}

function nextBatch(vault, plan, requestedBatchSize) {
  const remaining = planSummary(plan).requestsRemaining;
  const limit = Math.max(0, Math.min(remaining, Math.floor(Number(requestedBatchSize) || 0)));
  if (!limit) return [];
  const byId = new Map((vault.albums || []).map(album => [album.id, album]));
  return (plan.albums || [])
    .filter(item => item.status === "pending")
    .map(item => byId.get(item.id))
    .filter(isSearchEligible)
    .slice(0, limit);
}

function recordRequest(plan, albumId, now = new Date()) {
  const entry = (plan.albums || []).find(item => item.id === albumId);
  if (entry) entry.attemptedAt = now.toISOString();
  plan.requestCount = Math.max(0, Number(plan.requestCount || 0)) + 1;
  return plan;
}

function recordResult(plan, albumId, outcome, completed = true, now = new Date()) {
  const entry = (plan.albums || []).find(item => item.id === albumId);
  if (!entry) return plan;
  entry.status = completed ? "completed" : "failed";
  entry.completedAt = now.toISOString();
  entry.outcome = String(outcome || (completed ? "checked" : "failed")).slice(0, 240);
  return plan;
}

function loadPlan(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function savePlan(filePath, plan) {
  atomicWriteJson(filePath, plan);
  return plan;
}

module.exports = {
  DEFAULT_DAILY_LIMIT,
  TIME_ZONE,
  clampDailyLimit,
  createDailyPlan,
  dayKey,
  ensureDailyPlan,
  loadPlan,
  nextBatch,
  planSummary,
  recordRequest,
  recordResult,
  savePlan
};
