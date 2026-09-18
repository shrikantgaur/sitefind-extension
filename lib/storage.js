// Scan history and application state persistence using chrome.storage.local.

const HISTORY_KEY = "sitefind_history";
const DRAFT_KEY = "sitefind_draft_state";
const ACTIVE_SCAN_KEY = "sitefind_active_scan";
const VIEW_STATE_KEY = "sitefind_active_view_state";
const MAX_HISTORY_ENTRIES = 50;

/**
 * Scan record shape:
 * {
 *   id: string,
 *   site: string,          // origin, e.g. https://example.com
 *   startedAt: number,      // epoch ms
 *   finishedAt: number,
 *   scope: "current_page" | "entire_site",
 *   maxPages: number,
 *   terms: string[],        // raw search terms
 *   pagesDiscovered: number,
 *   pagesScanned: number,
 *   pagesFailed: number,
 *   matchesByTerm: { [term]: { pages: { url, hits }[] } },
 *   allScannedUrls: string[], // list of all scanned URLs (for Affected vs All view)
 *   failedPages: { url, reason }[],
 *   status: "Completed" | "Stopped" | "Needs Attention" | "No Matches" | "Could Not Scan",
 * }
 */

export async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return data[HISTORY_KEY] || [];
}

export async function saveScan(record) {
  const history = await getHistory();
  const idx = history.findIndex((s) => s.id === record.id);
  if (idx !== -1) {
    history[idx] = record;
  } else {
    history.unshift(record);
  }
  while (history.length > MAX_HISTORY_ENTRIES) history.pop();

  // chrome.storage.local has a hard quota. A large crawl can exceed it, and an
  // unhandled rejection here would silently lose the scan the user just waited
  // for, so drop the oldest history entries until the new record fits.
  let attempt = history;
  for (;;) {
    try {
      await chrome.storage.local.set({ [HISTORY_KEY]: attempt });
      return record;
    } catch (err) {
      if (!isQuotaError(err) || attempt.length <= 1) {
        throw new Error(
          isQuotaError(err)
            ? "This scan is too large to store. Narrow the page limit or the search terms and scan again."
            : String(err?.message || err)
        );
      }
      attempt = attempt.slice(0, -1);
    }
  }
}

function isQuotaError(err) {
  return /quota|QUOTA_BYTES|exceeded/i.test(String(err?.message || err));
}

export async function getScan(id) {
  const history = await getHistory();
  return history.find((s) => s.id === id) || null;
}

export async function deleteScan(id) {
  const history = await getHistory();
  const next = history.filter((s) => s.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

export async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

export async function getLatestScanForSite(site, scope) {
  const history = await getHistory();
  return history.find((s) => s.site === site && (!scope || s.scope === scope)) || null;
}

export function makeScanId() {
  return `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------
// Draft Search State (persists search terms across popup closes)
// ---------------------------------------------------------------------
export async function getDraftState() {
  const data = await chrome.storage.local.get(DRAFT_KEY);
  return data[DRAFT_KEY] || null;
}

export async function saveDraftState(draft) {
  await chrome.storage.local.set({ [DRAFT_KEY]: draft });
}

// ---------------------------------------------------------------------
// Active Scan State (persists background crawl state)
// ---------------------------------------------------------------------
export async function getActiveScan() {
  const data = await chrome.storage.local.get(ACTIVE_SCAN_KEY);
  return data[ACTIVE_SCAN_KEY] || null;
}

export async function setActiveScan(scanState) {
  await chrome.storage.local.set({ [ACTIVE_SCAN_KEY]: scanState });
}

export async function clearActiveScan() {
  await chrome.storage.local.remove(ACTIVE_SCAN_KEY);
}

// A persisted crawl whose heartbeat is older than this was killed along with
// the service worker and can never resume.
export const CRAWL_STALE_MS = 30000;

export function isCrawlStateStale(state) {
  if (!state || state.status !== "running") return true;
  return Date.now() - (state.updatedAt || 0) > CRAWL_STALE_MS;
}

// ---------------------------------------------------------------------
// Active View State (retains results view when reopening after highlight)
// ---------------------------------------------------------------------
export async function getActiveViewState() {
  const data = await chrome.storage.local.get(VIEW_STATE_KEY);
  return data[VIEW_STATE_KEY] || null;
}

export async function saveActiveViewState(state) {
  await chrome.storage.local.set({ [VIEW_STATE_KEY]: state });
}

export async function clearActiveViewState() {
  await chrome.storage.local.remove(VIEW_STATE_KEY);
}
