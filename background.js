import { normalizeUrl, isSameSite, looksExplosive } from "./lib/normalize.js";
import { classifyTerms, scanPage } from "./lib/matcher.js";
import { saveScan, makeScanId, setActiveScan, getActiveScan, clearActiveScan, getHistory } from "./lib/storage.js";
import { countScanMatches } from "./lib/hits.js";
import { runInPageHighlighter } from "./lib/highlighter.js";
import { injectDraggableWidget } from "./lib/floatingWidget.js";

const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3MB
const DEFAULT_MAX_PAGES = 500;
const PERSIST_INTERVAL_MS = 1000;

const crawls = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case "DETECT_SUGGESTIONS":
      return detectPageSuggestions(msg.tabId);

    case "SCAN_CURRENT_PAGE":
      return scanCurrentPage(msg.tabId, msg.terms);

    case "SCAN_URL_PAGE":
      return scanUrlPage(msg.url, msg.terms);

    case "START_CRAWL":
      return startCrawl(msg);

    case "STOP_CRAWL":
      return stopCrawl(msg.crawlId);

    case "GET_CRAWL_STATE":
      return getCrawlState(msg.crawlId);

    case "OPEN_AND_HIGHLIGHT":
      return openAndHighlight(msg);

    case "OPEN_DASHBOARD":
    case "OPEN_POPUP":
    case "OPEN_WIDGET":
      return openDashboard(msg, sender);

    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}

// ---------------------------------------------------------------------
// Page Suggestions Detection (Task 2)
// ---------------------------------------------------------------------
async function detectPageSuggestions(tabId) {
  try {
    const [{ result: page }] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return { ok: true, suggestions: page?.suggestions || { emails: [], phones: [] } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------
// Current-page scan
// ---------------------------------------------------------------------
async function scanCurrentPage(tabId, rawTerms) {
  const terms = classifyTerms(rawTerms);
  if (!terms.length) return { ok: false, error: "No valid search terms." };

  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    const page = injection?.[0]?.result;
    if (!page || !page.url) {
      return { ok: false, error: "Could not read page content. Please refresh the page and try again." };
    }

    const matches = scanPage(page, terms);

    const matchesByTerm = {};
    for (const [term, hits] of Object.entries(matches)) {
      matchesByTerm[term] = { pages: [{ url: page.url, hits }] };
    }
    const totalMatchCount = countScanMatches({ matchesByTerm });

    const record = {
      id: makeScanId(),
      site: originOf(page.url),
      startedAt: Date.now(),
      finishedAt: Date.now(),
      scope: "current_page",
      maxPages: 1,
      terms: rawTerms,
      pagesDiscovered: 1,
      pagesScanned: 1,
      pagesFailed: 0,
      matchesByTerm,
      allScannedUrls: [page.url],
      failedPages: [],
      status: totalMatchCount > 0 ? "Needs Attention" : "No Matches",
    };

    await saveScan(record);
    await clearActiveScan();

    return { ok: true, scan: record, suggestions: page.suggestions || { emails: [], phones: [] } };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ---------------------------------------------------------------------
// Entire-website crawl
// ---------------------------------------------------------------------
async function startCrawl({ origin, terms: rawTerms, maxPages }) {
  const terms = classifyTerms(rawTerms);
  if (!terms.length) return { ok: false, error: "No valid search terms." };

  const cap = Math.max(1, Math.min(Number(maxPages) || DEFAULT_MAX_PAGES, 2000));
  const crawlId = `crawl_${Date.now()}`;
  const state = {
    crawlId,
    // One id for the whole crawl: stopping and finishing must update the same
    // history record rather than creating a second one.
    scanId: makeScanId(),
    origin,
    terms,
    rawTerms,
    maxPages: cap,
    status: "running", // running | stopped | done
    queue: [],
    visited: new Set(),
    allScannedUrls: [],
    currentUrl: origin,
    elementsChecked: 0,
    discovered: 0,
    scanned: 0,
    notFound: 0,
    failed: [],
    matchesByTerm: {},
    startedAt: Date.now(),
    finishedAt: null,
    savedScanId: null,
    finalScan: null,
    activeWorkers: 0,
    lastPersistAt: 0,
    saveError: null,
  };
  crawls.set(crawlId, state);

  enqueue(state, origin);

  // Seed with active scan in storage so popup can attach immediately
  await persistActiveState(state);

  // Discover sitemap links, then crawl. Sitemap discovery is best-effort: if it
  // throws, BFS link discovery still has to run.
  seedFromSitemaps(state)
    .catch((err) => console.warn("Sitemap discovery failed:", err))
    .then(() => runCrawlLoop(state))
    .catch((err) => finishCrawlWithError(state, err));

  return { ok: true, crawlId };
}

async function stopCrawl(crawlId) {
  const state = crawls.get(crawlId);
  if (!state) return { ok: true };

  state.status = "stopped";
  state.stopRequestedAt = Date.now();
  // The final record is written by runCrawlLoop once in-flight workers drain,
  // under the same scan id, so a stop produces exactly one history entry.
  return { ok: true };
}

async function getCrawlState(crawlId) {
  const state = crawls.get(crawlId);
  if (state) return { ok: true, state: serializeCrawl(state) };

  const persisted = await getActiveScan();
  if (!persisted || (crawlId && persisted.crawlId !== crawlId)) {
    return { ok: false, error: "Crawl not found" };
  }

  // Not in memory: the service worker was restarted. A crawl cannot survive
  // that, so report it as interrupted instead of reporting "running" forever.
  if (persisted.status === "running") {
    const interrupted = {
      ...persisted,
      status: "interrupted",
      error: "The scan stopped because Chrome suspended the extension in the background.",
    };
    await setActiveScan(interrupted);
    return { ok: true, state: interrupted };
  }

  return { ok: true, state: persisted };
}


function enqueue(state, rawUrl) {
  if (state.discovered >= state.maxPages) return;
  const norm = normalizeUrl(rawUrl, state.origin);
  if (!norm) return;
  if (!isSameSite(norm, state.origin)) return;
  if (state.visited.has(norm)) return;
  state.visited.add(norm);
  state.discovered += 1;
  const explosive = looksExplosive(norm);
  if (explosive) {
    state.queue.push(norm);
  } else {
    state.queue.unshift(norm);
  }
}

async function seedFromSitemaps(state) {
  const sitemapUrls = [
    new URL("/sitemap.xml", state.origin).toString(),
    new URL("/sitemap_index.xml", state.origin).toString(),
  ];

  for (const smUrl of sitemapUrls) {
    if (state.discovered >= state.maxPages) break;
    try {
      const res = await fetchWithTimeout(smUrl);
      if (!res || !res.ok) continue;
      const xml = await res.text();
      let locs = [];
      try {
        const parsed = await parseXmlInOffscreen(xml);
        locs = parsed || [];
      } catch {
        locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      }

      for (const loc of locs) {
        if (state.discovered >= state.maxPages) break;
        if (loc.endsWith(".xml")) {
          // Nested sitemap index: fetch child sitemap
          try {
            const subRes = await fetchWithTimeout(loc);
            if (subRes && subRes.ok) {
              const subXml = await subRes.text();
              const subLocs = [...subXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
              for (const sloc of subLocs) {
                if (state.discovered >= state.maxPages) break;
                enqueue(state, sloc);
              }
            }
          } catch {}
        } else {
          enqueue(state, loc);
        }
      }
    } catch {
      // Fall through silently to BFS link discovery
    }
  }
}

async function runCrawlLoop(state) {
  const workers = Array.from({ length: CONCURRENCY }, () => crawlWorker(state));
  await Promise.all(workers);

  if (state.status === "running") state.status = "done";
  state.finishedAt = Date.now();

  const record = buildScanRecord(state);
  state.finalScan = record;
  try {
    await saveScan(record);
    state.savedScanId = record.id;
  } catch (err) {
    state.saveError = String(err?.message || err);
  }

  await persistActiveState(state, { force: true });
  scheduleCrawlCleanup(state);
}

// The finished state lives on in storage, so the in-memory copy (which holds
// every match and the visited set) does not need to be kept forever.
function scheduleCrawlCleanup(state) {
  setTimeout(() => crawls.delete(state.crawlId), 60000);
}

async function finishCrawlWithError(state, err) {
  console.error("Crawl failed:", err);
  state.status = "done";
  state.finishedAt = Date.now();
  state.saveError = String(err?.message || err);
  state.finalScan = buildScanRecord(state);
  try {
    await saveScan(state.finalScan);
    state.savedScanId = state.finalScan.id;
  } catch {}
  await persistActiveState(state, { force: true });
  scheduleCrawlCleanup(state);
}

async function crawlWorker(state) {
  for (;;) {
    if (state.status !== "running") return;

    const url = state.queue.shift();
    if (!url) {
      // The queue can be empty while a peer worker is still fetching a page
      // that will enqueue more links. Only stop once nobody is working.
      if (state.activeWorkers === 0) return;
      await sleep(50);
      continue;
    }

    state.activeWorkers += 1;
    try {
      state.currentUrl = url;
      await crawlOne(state, url);
    } finally {
      state.activeWorkers -= 1;
    }

    await persistActiveState(state);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function crawlOne(state, url) {
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    state.failed.push({ url, reason: err?.message?.includes("timeout") ? "Timed out (10s)" : "Network error" });
    return;
  }

  if (!res) {
    state.failed.push({ url, reason: "Network error" });
    return;
  }

  if (res.status === 404) {
    state.notFound += 1;
    state.failed.push({ url, reason: "Not found (404)" });
    return;
  }
  if (res.status === 403) {
    state.failed.push({ url, reason: "Blocked (403 Forbidden)" });
    return;
  }
  if (res.status === 429) {
    state.failed.push({ url, reason: "Rate limited (429)" });
    return;
  }
  if (res.status >= 500) {
    state.failed.push({ url, reason: `Server error (${res.status})` });
    return;
  }
  if (!res.ok) {
    state.failed.push({ url, reason: `HTTP ${res.status}` });
    return;
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType && !contentType.includes("text/html")) {
    return;
  }

  const lenHeader = res.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MAX_RESPONSE_BYTES) {
    state.failed.push({ url, reason: "Response too large (>3MB)" });
    return;
  }

  let html;
  try {
    html = await res.text();
  } catch {
    state.failed.push({ url, reason: "Could not read response body" });
    return;
  }
  if (html.length > MAX_RESPONSE_BYTES) {
    state.failed.push({ url, reason: "Response too large (>3MB)" });
    return;
  }

  let parsed;
  try {
    parsed = await parseInOffscreen(html, url);
  } catch (err) {
    state.failed.push({ url, reason: "Could not parse HTML" });
    return;
  }

  state.scanned += 1;
  state.allScannedUrls.push(url);
  state.elementsChecked += (parsed.items?.length || 0) + 1;

  const matches = scanPage({ ...parsed, url }, state.terms);
  for (const [term, hits] of Object.entries(matches)) {
    if (!state.matchesByTerm[term]) state.matchesByTerm[term] = { pages: [] };
    state.matchesByTerm[term].pages.push({ url, hits });
  }

  for (const link of parsed.links || []) {
    if (state.discovered >= state.maxPages) break;
    enqueue(state, resolveMaybe(link, url));
  }
}

function resolveMaybe(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      credentials: "omit",
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildScanRecord(state) {
  const totalMatches = countScanMatches({ matchesByTerm: state.matchesByTerm });

  let status = "Completed";
  if (state.status === "stopped") {
    status = "Stopped";
  } else if (state.failed.length > 0 && state.scanned === 0) {
    status = "Could Not Scan";
  } else if (totalMatches > 0) {
    status = "Needs Attention";
  } else {
    status = "No Matches";
  }

  return {
    id: state.scanId,
    site: state.origin,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt || Date.now(),
    scope: "entire_site",
    maxPages: state.maxPages,
    terms: state.rawTerms,
    pagesDiscovered: state.discovered,
    pagesScanned: state.scanned,
    pagesFailed: state.failed.length,
    matchesByTerm: state.matchesByTerm,
    allScannedUrls: Array.from(new Set(state.allScannedUrls)),
    failedPages: state.failed,
    status,
    stopped: state.status === "stopped",
  };
}

function serializeCrawl(state) {
  if (!state) return null;
  const matchesCount = countScanMatches({ matchesByTerm: state.matchesByTerm });

  return {
    crawlId: state.crawlId,
    origin: state.origin,
    status: state.status,
    updatedAt: Date.now(),
    startedAt: state.startedAt,
    saveError: state.saveError || null,
    maxPages: state.maxPages,
    discovered: state.discovered,
    scanned: state.scanned,
    currentUrl: state.currentUrl,
    elementsChecked: state.elementsChecked,
    notFound: state.notFound,
    failedCount: state.failed.length,
    matchesCount,
    queueLength: state.queue.length,
    savedScanId: state.savedScanId || null,
    scan: state.finalScan || null,
  };
}

async function persistActiveState(state, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - state.lastPersistAt < PERSIST_INTERVAL_MS) return;
  state.lastPersistAt = now;
  try {
    await setActiveScan(serializeCrawl(state));
  } catch (err) {
    console.warn("Could not persist crawl state:", err);
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------
// Open & Highlight Handler (Task 14, 15)
// ---------------------------------------------------------------------
function cleanUrl(u) {
  if (!u) return "";
  try {
    const parsed = new URL(u);
    return (parsed.origin + parsed.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(u).split("#")[0].replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Find an open tab showing exactly this page.
 *
 * Only an exact URL match counts. Matching on origin alone used to send the
 * highlighter to whatever page of the site happened to be open, which reports
 * "no matches" on a page that was never scanned.
 */
async function findTabForUrl(url) {
  const targetClean = cleanUrl(url);
  if (!targetClean) return null;

  const [currentActive] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (currentActive?.url && cleanUrl(currentActive.url) === targetClean) return currentActive;

  // Needs host permission for the origin (granted for site crawls); without it
  // this resolves to an empty list and we simply open a new tab.
  try {
    const origin = new URL(url).origin;
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    return tabs.find((t) => t.url && cleanUrl(t.url) === targetClean) || null;
  } catch {
    return null;
  }
}

function waitForTabLoad(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    }
    function onUpdated(updatedId, info) {
      if (updatedId === tabId && info.status === "complete") setTimeout(finish, 300);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(finish, timeoutMs);

    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete") setTimeout(finish, 300);
    }).catch(finish);
  });
}

/**
 * Scan one specific URL rather than "whatever tab is active".
 * Used by Verify Again so a re-scan always targets the page that was scanned.
 */
async function scanUrlPage(url, terms) {
  if (!url) return { ok: false, error: "No page URL to verify." };

  let tab = await findTabForUrl(url);
  if (!tab) {
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await waitForTabLoad(tab.id);
    } catch (err) {
      return { ok: false, error: `Could not open ${url}: ${String(err?.message || err)}` };
    }
  }

  const result = await scanCurrentPage(tab.id, terms);
  if (result?.ok && result.scan) {
    // scanCurrentPage records the URL the tab actually settled on.
    result.scan.scope = "current_page";
  }
  return result;
}

async function openAndHighlight(payload) {
  const { url, term, matchedText, terms, matchedTexts, allTerms, activeTerm, occurrenceIndex, selector, fromPopup, noFocus } = payload;

  let targetTab = await findTabForUrl(url);

  if (targetTab?.id) {
    // Do not steal focus from the popup if called from the popup.
    if (!noFocus && !fromPopup) {
      await chrome.tabs.update(targetTab.id, { active: true });
      if (targetTab.windowId) {
        await chrome.windows.update(targetTab.windowId, { focused: true });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  } else {
    if (!url) return { ok: false, error: "No page URL to open." };
    targetTab = await chrome.tabs.create({ url, active: !noFocus && !fromPopup });
    await waitForTabLoad(targetTab.id);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: runInPageHighlighter,
      args: [{ term, matchedText, terms, matchedTexts, allTerms, activeTerm, occurrenceIndex, selector }],
    });
    return { ok: true, tabId: targetTab.id };
  } catch (err) {
    console.error("Highlighter injection failed:", err);
    return { ok: false, error: String(err?.message || err) };
  }
}

// ---------------------------------------------------------------------
// Open Dashboard / In-Page Widget Handler (Requested: sitefind-hud isme hi open ho ki popup open kar sake)
// ---------------------------------------------------------------------
async function openDashboard(msg, sender) {
  let tabId = sender?.tab?.id;
  let tabUrl = sender?.tab?.url || msg?.url;

  if (!tabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs[0]?.id;
    tabUrl = tabUrl || tabs[0]?.url;
  }

  // 1. Attempt native chrome.action.openPopup()
  let popupOpened = false;
  try {
    if (typeof chrome.action?.openPopup === "function") {
      await chrome.action.openPopup();
      popupOpened = true;
    }
  } catch {
    popupOpened = false;
  }

  // If native popup opened successfully, remove any floating widget so only ONE dashboard shows
  if (popupOpened) {
    if (tabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const w = document.getElementById("sitefind-floating-widget");
            if (w) w.remove();
            const s = document.getElementById("sitefind-widget-styles");
            if (s) s.remove();
          },
        });
      } catch {}
    }
    return { ok: true, popupOpened: true };
  }

  // 2. Fallback: only if native popup could not be opened, inject the draggable widget directly on the webpage
  if (tabId) {
    try {
      const siteOrigin = msg?.origin || (tabUrl ? originOf(tabUrl) : "");
      let scanData = null;

      const active = await getActiveScan();
      if (active && active.scan) {
        scanData = active.scan;
      } else {
        const history = await getHistory();
        scanData = history.find((s) => !siteOrigin || s.site === siteOrigin) || history[0] || null;
      }

      if (scanData) {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: injectDraggableWidget,
          args: [scanData],
        });
      }
    } catch (err) {
      console.warn("Could not inject draggable widget from HUD:", err);
    }
  }

  return { ok: true, popupOpened: false };
}

// ---------------------------------------------------------------------
// Offscreen document (DOM parsing)
// ---------------------------------------------------------------------
let offscreenReady = null;

async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    try {
      const has = await chrome.offscreen.hasDocument?.();
      if (has) return;
    } catch {}
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "Parse fetched HTML pages to extract links and structured text for the site crawler.",
      });
    } catch (err) {
      if (!String(err).includes("Only a single offscreen")) throw err;
    }
  })();
  return offscreenReady;
}

async function parseInOffscreen(html, baseUrl) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "PARSE_HTML",
    html,
    baseUrl,
  });
  if (!response?.ok) throw new Error(response?.error || "Offscreen parse failed");
  return response.data;
}

async function parseXmlInOffscreen(xml) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "PARSE_SITEMAP",
    xml,
  });
  if (response?.ok && Array.isArray(response.urls)) {
    return response.urls;
  }
  return null;
}
