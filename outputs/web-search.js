const cheerio = require("cheerio");

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RESULT_LIMIT = 20;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseEndpoint(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function directResultUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://duckduckgo.com");
    if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/") {
      return decodeURIComponent(url.searchParams.get("uddg") || "");
    }
    return url.href;
  } catch {
    return "";
  }
}

function directBingUrl(value) {
  const direct = directResultUrl(value);
  try {
    const url = new URL(direct);
    if (!url.hostname.endsWith("bing.com") || url.pathname !== "/ck/a") return direct;
    const encoded = url.searchParams.get("u") || "";
    if (!encoded.startsWith("a1")) return "";
    return Buffer.from(encoded.slice(2), "base64url").toString("utf8");
  } catch {
    return "";
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  try {
    return await fetch(url, {
      redirect: "follow",
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PhysicalMusicVault/3.0; local personal collection tool)",
        "Accept": "text/html,application/xhtml+xml,application/json",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseDuckDuckGoHtml(html, limit = DEFAULT_RESULT_LIMIT) {
  const $ = cheerio.load(String(html || ""));
  const results = [];
  $(".result").each((index, element) => {
    if (results.length >= limit) return false;
    const link = $(element).find("a.result__a").first();
    const url = directResultUrl(link.attr("href"));
    if (!url || !/^https?:/i.test(url)) return;
    results.push({
      title: cleanText(link.text()),
      url,
      snippet: cleanText($(element).find(".result__snippet").first().text()),
      rank: index + 1,
      engine: "DuckDuckGo"
    });
  });
  return results;
}

async function searchDuckDuckGo(query, options = {}) {
  const limit = Math.max(1, Math.min(50, Number(options.limit || DEFAULT_RESULT_LIMIT)));
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(endpoint, options);
  if (!response.ok) {
    const error = new Error(`Keyless search returned HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  const results = parseDuckDuckGoHtml(await response.text(), limit);
  if (!results.length) throw new Error("Keyless search returned no parseable results.");
  return { provider: "DuckDuckGo keyless web search", query, results };
}

function parseBingHtml(html, limit = DEFAULT_RESULT_LIMIT) {
  const $ = cheerio.load(String(html || ""));
  const results = [];
  $("li.b_algo").each((index, element) => {
    if (results.length >= limit) return false;
    const link = $(element).find("h2 a").first();
    const url = directBingUrl(link.attr("href"));
    if (!url || !/^https?:/i.test(url)) return;
    results.push({
      title: cleanText(link.text()),
      url,
      snippet: cleanText($(element).find(".b_caption p").first().text()),
      rank: index + 1,
      engine: "Bing"
    });
  });
  return results;
}

async function searchBing(query, options = {}) {
  const limit = Math.max(1, Math.min(50, Number(options.limit || DEFAULT_RESULT_LIMIT)));
  const endpoint = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const response = await fetchWithTimeout(endpoint, options);
  if (!response.ok) {
    const error = new Error(`Fallback search returned HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  const queryTokens = [...new Set(cleanText(query).toLowerCase().match(/[a-z0-9]{4,}/g) || [])]
    .filter(token => !["site", "https", "discogs", "metal", "archives"].includes(token));
  const results = parseBingHtml(await response.text(), limit).filter(result => {
    if (!queryTokens.length) return true;
    const text = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
    return queryTokens.filter(token => text.includes(token)).length >= Math.min(2, queryTokens.length);
  });
  if (!results.length) throw new Error("Fallback search returned no parseable results.");
  return { provider: "Bing keyless fallback", query, results };
}

async function searchSearxng(query, settings = {}, options = {}) {
  const baseUrl = normaliseEndpoint(settings.searxngUrl);
  if (!baseUrl) throw new Error("A SearXNG URL is required for the SearXNG provider.");
  const limit = Math.max(1, Math.min(50, Number(options.limit || DEFAULT_RESULT_LIMIT)));
  const endpoint = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=auto&safesearch=0`;
  const response = await fetchWithTimeout(endpoint, options);
  if (!response.ok) {
    const error = new Error(`SearXNG returned HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  const payload = await response.json();
  const results = (payload.results || []).slice(0, limit).map((result, index) => ({
    title: cleanText(result.title),
    url: directResultUrl(result.url),
    snippet: cleanText(result.content),
    rank: index + 1,
    engine: cleanText(result.engine || "SearXNG")
  })).filter(result => /^https?:/i.test(result.url));
  return { provider: "Self-hosted SearXNG", query, results };
}

async function searchWeb(query, settings = {}, options = {}) {
  const provider = String(settings.searchProvider || "duckduckgo").toLowerCase();
  if (provider === "searxng") return searchSearxng(query, settings, options);
  let primaryError;
  try {
    return await searchDuckDuckGo(query, options);
  } catch (error) {
    primaryError = error;
  }
  await sleep(1500);
  try {
    return await searchDuckDuckGo(query, options);
  } catch (retryError) {
    try {
      const fallback = await searchBing(query, options);
      fallback.fallbackReason = `${primaryError.message} Retry failed: ${retryError.message}`;
      return fallback;
    } catch (fallbackError) {
      const combined = new Error(`${primaryError.message} Retry failed: ${retryError.message} Fallback failed: ${fallbackError.message}`);
      combined.httpStatus = fallbackError.httpStatus || retryError.httpStatus || primaryError.httpStatus;
      throw combined;
    }
  }
}

module.exports = {
  directResultUrl,
  parseBingHtml,
  parseDuckDuckGoHtml,
  searchBing,
  searchDuckDuckGo,
  searchSearxng,
  searchWeb
};
