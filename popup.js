import { getHistory, deleteScan as deleteHistoryScan, clearHistory, getDraftState, saveDraftState, getActiveScan, clearActiveScan, getActiveViewState, saveActiveViewState, clearActiveViewState, getScan, isCrawlStateStale } from "./lib/storage.js";
import { getCleanPageHits, countScanMatches, countTermMatches, affectedUrls as affectedUrlsOf } from "./lib/hits.js";
import { classifyTerm } from "./lib/matcher.js";
import { toCsv, toJson } from "./lib/export.js";
import { injectDraggableWidget } from "./lib/floatingWidget.js";

// ---------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const views = {
  setup: $("#view-setup") || $("#viewSetup"),
  progress: $("#view-progress") || $("#viewProgress"),
  results: $("#view-results") || $("#viewResults"),
  history: $("#view-history") || $("#viewHistory"),
};

const siteHostBadge = $("#siteHostBadge");
const floatWidgetBtn = $("#floatWidgetBtn");
const historyBtn = $("#historyBtn");

const termList = $("#termList");
const addTermBtn = $("#addTermBtn");
const clearTermsBtn = $("#clearTermsBtn");
const presetChips = document.querySelectorAll(".chip");
const suggestionsList = $("#suggestionsList");
const suggestionsHint = $("#suggestionsHint");
const detectSuggestionsBtn = $("#detectSuggestionsBtn");

const scopeRadios = document.querySelectorAll('input[name="scope"]');
const maxPagesRow = $("#maxPagesRow");
const maxPagesSelect = $("#maxPages");
const permissionNote = $("#permissionNote");
const currentPageHint = $("#currentPageHint");
const setupError = $("#setupError");
const scanBtn = $("#scanBtn");
const scanHint = $("#scanHint");
const onboardingCard = $("#onboardingCard");
const dismissOnboardingBtn = $("#dismissOnboardingBtn");
const toastHost = $("#toastHost");

const progressTitle = $(".progress-title");
const progressStatusText = $("#progressStatusText");
const progressPctText = $("#progressPctText");
const progressFill = $("#progressFill");
const progressBar = $("#progressBar");
const progressCurrentUrl = $("#progressCurrentUrl");
const progressElapsed = $("#progressElapsed");
const statScanned = $("#statScanned");
const statDiscovered = $("#statDiscovered");
const statMatches = $("#statMatches");
const statElements = $("#statElements");
const statFailed = $("#statFailed");
const stopScanBtn = $("#stopScanBtn");

const topBackBtn = $("#topBackBtn");
const resultsStatusBadge = $("#resultsStatusBadge");
const openFullResultsBtn = $("#openFullResultsBtn");
const resultsSummary = $("#resultsSummary");
const comparisonBlock = $("#comparisonBlock");
const resultsSearchInput = $("#resultsSearchInput");
const toggleAffectedOnly = $("#toggleAffectedOnly");
const toggleAllPages = $("#toggleAllPages");
const affectedCountBadge = $("#affectedCountBadge");
const allCountBadge = $("#allCountBadge");
const termFilterSelect = $("#termFilterSelect");
const matchList = $("#matchList");
const tableEmptyState = $("#tableEmptyState");
const resultsCountLine = $("#resultsCountLine");
const copyUrlsBtn = $("#copyUrlsBtn");

const failedBlock = $("#failedBlock");
const failedToggle = $("#failedToggle");
const failedToggleLabel = $("#failedToggleLabel");
const failedList = $("#failedList");
const verifyAgainBtn = $("#verifyAgainBtn");
const exportCsvBtn = $("#exportCsvBtn");
const exportJsonBtn = $("#exportJsonBtn");
const newScanBtn = $("#newScanBtn");

const backFromHistoryBtn = $("#backFromHistoryBtn");
const historyList = $("#historyList");
const historyEmpty = $("#historyEmpty");

// ---------------------------------------------------------------------
// App State
// ---------------------------------------------------------------------
let activeTab = null;
let currentScan = null;
let activeCrawlId = null;
let pollTimer = null;
let viewMode = "affected"; // "affected" | "all"
const selectedRowKeys = new Set();
const allRenderedRowsMap = new Map();
let lastFilteredRows = [];
let hasUserChangedSelection = false;
let elapsedTimer = null;
let scanStartedAt = 0;

const ONBOARDING_KEY = "sitefind_onboarding_dismissed";

const DEFAULT_PLACEHOLDER = "Search old email, phone, company, address or any text...";

init();

async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0] || null;

  if (activeTab?.url && /^https?:\/\//.test(activeTab.url)) {
    const host = new URL(activeTab.url).hostname;
    siteHostBadge.textContent = host;
    currentPageHint.textContent = `Scans active page on ${host}`;
  } else {
    siteHostBadge.textContent = "No website open";
    currentPageHint.textContent = "Open a website to scan it";
  }

  // Restore draft search terms
  await restoreDraft();
  bindEvents();
  updateScopeUI();
  refreshTermFeedback();
  await setupOnboarding();

  // 1. Re-attach to a live background crawl. A persisted "running" state whose
  // heartbeat has gone stale means Chrome suspended the worker mid-crawl.
  const active = await getActiveScan();
  if (active && active.status === "running") {
    if (isCrawlStateStale(active)) {
      await clearActiveScan();
      showError("The last scan was interrupted when Chrome suspended the extension. Please run it again.");
    } else {
      activeCrawlId = active.crawlId;
      showView("progress");
      pollCrawl();
      return;
    }
  }

  // 2. Check if user was in Results view (persists across popup reopen after highlight)
  const viewState = await getActiveViewState();
  if (viewState?.view === "results" && viewState.scanId) {
    const savedScan = await getScan(viewState.scanId);
    if (savedScan) {
      // User request: open fresh if extension opened on another page/website!
      const currentTabUrl = activeTab?.url || "";
      let isSameTarget = false;
      try {
        if (currentTabUrl && savedScan.site) {
          const currentOrigin = new URL(currentTabUrl).origin.toLowerCase();
          const scanOrigin = new URL(savedScan.site).origin.toLowerCase();
          if (currentOrigin === scanOrigin) {
            if (savedScan.scope === "current_page") {
              const scannedPage = (savedScan.allScannedUrls?.[0] || savedScan.site || "").split("#")[0].replace(/\/+$/, "").toLowerCase();
              const currentClean = currentTabUrl.split("#")[0].replace(/\/+$/, "").toLowerCase();
              isSameTarget = (scannedPage === currentClean);
            } else {
              isSameTarget = true;
            }
          }
        }
      } catch {}

      if (isSameTarget) {
        currentScan = savedScan;
        renderResults(currentScan, null);
        showView("results");
      } else {
        // Different URL/site: open fresh on setup screen!
        await clearActiveViewState();
      }
    }
  }
}

// ---------------------------------------------------------------------
// In-Page Draggable Floating Widget
// ---------------------------------------------------------------------
async function launchFloatingWidget() {
  if (!activeTab?.id) return;
  try {
    const payload = currentScan || {
      terms: collectTerms(),
      matchesByTerm: {},
      site: activeTab.url,
    };
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: injectDraggableWidget,
      args: [payload],
    });
    window.close(); // Close popup; widget is now floating on top of webpage!
  } catch (err) {
    console.error("Could not launch floating widget:", err);
  }
}

// ---------------------------------------------------------------------
// Suggestions (Task 2)
// ---------------------------------------------------------------------
async function loadPageSuggestions(tabId) {
  if (!tabId) return;
  detectSuggestionsBtn.disabled = true;
  detectSuggestionsBtn.textContent = "Reading page…";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "DETECT_SUGGESTIONS",
      tabId,
    });
    if (res?.ok && res.suggestions) {
      renderSuggestions(res.suggestions);
      const total = (res.suggestions.emails?.length || 0) + (res.suggestions.phones?.length || 0);
      if (!total) suggestionsHint.textContent = "No emails or phone numbers found on this page.";
    } else {
      suggestionsHint.textContent = "Could not read this page. Refresh it and try again.";
    }
  } catch {
    suggestionsHint.textContent = "Could not read this page. Refresh it and try again.";
  } finally {
    detectSuggestionsBtn.disabled = false;
    detectSuggestionsBtn.textContent = "Detect from this page";
  }
}

function renderSuggestions({ emails = [], phones = [] }) {
  suggestionsList.innerHTML = "";
  const allSuggestions = [
    ...emails.map((e) => ({ type: "email", val: e })),
    ...phones.map((p) => ({ type: "phone", val: p })),
  ];

  suggestionsHint.textContent = allSuggestions.length
    ? "Click a suggestion to add it as a search term."
    : "No emails or phone numbers found on this page.";
  if (!allSuggestions.length) return;

  allSuggestions.forEach(({ val }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion-chip";
    btn.textContent = val;
    btn.addEventListener("click", () => {
      const existing = collectTerms();
      if (!existing.includes(val)) {
        // If there is an empty input (e.g. default input), fill it; otherwise create a new row
        const inputs = Array.from(termList.querySelectorAll("input"));
        const emptyInput = inputs.find((inp) => !inp.value.trim());
        if (emptyInput) {
          emptyInput.value = val;
          saveDraft();
          updateRemoveButtons();
        } else {
          addTermRow(val);
          saveDraft();
        }
        refreshTermFeedback();
        showToast(`Added "${val}"`);
      } else {
        showToast("Already added");
      }
    });
    suggestionsList.appendChild(btn);
  });
}

// ---------------------------------------------------------------------
// Draft Persistence
// ---------------------------------------------------------------------
async function restoreDraft() {
  const draft = await getDraftState();
  termList.innerHTML = "";

  if (draft?.terms && draft.terms.length > 0) {
    draft.terms.forEach((t) => addTermRow(t));
    if (draft.scope) {
      const radio = document.querySelector(`input[name="scope"][value="${draft.scope}"]`);
      if (radio) radio.checked = true;
    }
    if (draft.maxPages && maxPagesSelect) {
      maxPagesSelect.value = draft.maxPages;
    }
  } else {
    addTermRow("");
  }
}

function saveDraft() {
  const terms = collectTerms();
  const scope = document.querySelector('input[name="scope"]:checked')?.value || "current_page";
  const maxPages = maxPagesSelect?.value || "500";
  saveDraftState({ terms, scope, maxPages });
}

// ---------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------
function bindEvents() {
  floatWidgetBtn.addEventListener("click", launchFloatingWidget);

  detectSuggestionsBtn.addEventListener("click", () => loadPageSuggestions(activeTab?.id));

  copyUrlsBtn?.addEventListener("click", onCopyUrls);

  // Keyboard: "/" jumps to the results filter, Escape steps back a view.
  document.addEventListener("keydown", (e) => {
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);

    if (e.key === "/" && !typing && !views.results.classList.contains("hidden")) {
      e.preventDefault();
      resultsSearchInput.focus();
      return;
    }

    if (e.key === "Escape") {
      if (document.activeElement === resultsSearchInput && resultsSearchInput.value) {
        resultsSearchInput.value = "";
        renderSimpleTable();
        return;
      }
      if (!views.results.classList.contains("hidden") || !views.history.classList.contains("hidden")) {
        // Same exit as the Back button, so reopening the popup starts fresh.
        clearActiveViewState().finally(() => showView("setup"));
      }
    }
  });

  addTermBtn.addEventListener("click", () => {
    addTermRow("");
    saveDraft();
  });

  clearTermsBtn.addEventListener("click", () => {
    termList.innerHTML = "";
    addTermRow("");
    saveDraft();
  });

  presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const placeholders = {
        email: "old@example.com",
        phone: "+1 800 123 4567",
        domain: "old-domain.com",
        company: "Old Company Inc.",
        address: "123 Main Street",
        custom: "Specific text to find",
      };
      addTermRow("", placeholders[chip.dataset.preset] || DEFAULT_PLACEHOLDER);
      saveDraft();
    });
  });

  scopeRadios.forEach((r) => r.addEventListener("change", () => {
    updateScopeUI();
    saveDraft();
  }));

  maxPagesSelect.addEventListener("change", saveDraft);

  scanBtn.addEventListener("click", onScanClick);
  stopScanBtn.addEventListener("click", onStopClick);

  toggleAffectedOnly.addEventListener("click", () => {
    viewMode = "affected";
    toggleAffectedOnly.classList.add("is-active");
    toggleAllPages.classList.remove("is-active");
    renderSimpleTable();
  });

  toggleAllPages.addEventListener("click", () => {
    viewMode = "all";
    toggleAllPages.classList.add("is-active");
    toggleAffectedOnly.classList.remove("is-active");
    renderSimpleTable();
  });

  resultsSearchInput.addEventListener("input", renderSimpleTable);
  termFilterSelect.addEventListener("change", async () => {
    renderSimpleTable();
    const selectedTerm = termFilterSelect.value;
    if (activeTab?.id && activeTab?.url) {
      try {
        await chrome.runtime.sendMessage({
          type: "OPEN_AND_HIGHLIGHT",
          url: activeTab.url,
          terms: selectedTerm ? [selectedTerm] : (currentScan?.terms || []),
          allTerms: currentScan?.terms || (selectedTerm ? [selectedTerm] : []),
          activeTerm: selectedTerm || "",
          occurrenceIndex: 1,
          fromPopup: true,
          noFocus: true,
        });
      } catch {}
    }
  });

  failedToggle.addEventListener("click", () => {
    const open = failedList.classList.toggle("hidden") === false;
    failedToggle.setAttribute("aria-expanded", String(open));
  });

  openFullResultsBtn.addEventListener("click", () => {
    if (currentScan?.id) {
      chrome.tabs.create({ url: `results.html?scanId=${currentScan.id}` });
    }
  });

  verifyAgainBtn.addEventListener("click", onVerifyAgain);
  exportCsvBtn.addEventListener("click", onExportCsv);
  exportJsonBtn.addEventListener("click", onExportJson);

  // Both Top Back Button and Bottom New Scan Button return to Setup
  topBackBtn.addEventListener("click", async () => {
    await clearActiveViewState();
    showView("setup");
  });

  newScanBtn.addEventListener("click", async () => {
    await clearActiveViewState();
    showView("setup");
  });

  historyBtn.addEventListener("click", openHistory);
  backFromHistoryBtn.addEventListener("click", () => {
    if (currentScan) {
      showView("results");
    } else {
      showView("setup");
    }
  });
}

// ---------------------------------------------------------------------
// Search Term Rows
// ---------------------------------------------------------------------
function updateRemoveButtons() {
  const rows = Array.from(termList.querySelectorAll(".term-row"));
  rows.forEach((r) => {
    const btn = r.querySelector(".remove-term");
    if (!btn) return;
    if (rows.length <= 1) {
      btn.style.display = "none";
    } else {
      btn.style.display = "inline-flex";
    }
  });
}

function addTermRow(value = "", placeholder = DEFAULT_PLACEHOLDER) {
  const row = document.createElement("div");
  row.className = "term-row";
  row.innerHTML = `
    <input type="text" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" aria-label="Search term" />
    <span class="term-type-badge" aria-hidden="true"></span>
    <button type="button" class="remove-term" aria-label="Remove search term">×</button>
  `;
  const input = row.querySelector("input");

  input.addEventListener("input", () => {
    saveDraft();
    refreshTermFeedback();
  });

  // Enter scans straight away: the main action should never need a mouse.
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.shiftKey) {
      addTermRow("");
      saveDraft();
      return;
    }
    if (!scanBtn.disabled) onScanClick();
  });

  row.querySelector(".remove-term").addEventListener("click", () => {
    row.remove();
    if (!termList.children.length) addTermRow("");
    saveDraft();
    updateRemoveButtons();
    refreshTermFeedback();
  });

  termList.appendChild(row);
  updateRemoveButtons();
  refreshTermFeedback();
  if (!value) input.focus();
}

/**
 * Show what each term will be matched as (email / phone / text), flag
 * duplicates, and keep the primary button honest about what it will do.
 */
function refreshTermFeedback() {
  const seen = new Set();

  termList.querySelectorAll(".term-row").forEach((row) => {
    const input = row.querySelector("input");
    const badge = row.querySelector(".term-type-badge");
    const value = input.value.trim();
    const classified = value ? classifyTerm(value) : null;

    if (badge) {
      if (classified) {
        const label = classified.type === "email" ? "Email" : classified.type === "phone" ? "Phone" : "Text";
        badge.textContent = label;
        badge.dataset.type = classified.type;
        badge.classList.add("visible");
      } else {
        badge.textContent = "";
        badge.classList.remove("visible");
      }
    }

    const key = value.toLowerCase();
    const isDuplicate = Boolean(key) && seen.has(key);
    if (key) seen.add(key);
    input.classList.toggle("duplicate", isDuplicate);
    input.title = isDuplicate ? "Duplicate term — it will only be searched once." : "";
  });

  updateScanButton();
}

function updateScanButton() {
  const count = collectTerms().length;
  const scope = document.querySelector('input[name="scope"]:checked')?.value || "current_page";
  const target = scope === "current_page" ? "this page" : "whole website";

  scanBtn.disabled = count === 0;
  scanBtn.textContent = count === 0
    ? `Scan ${target}`
    : `Scan ${target} · ${count} term${count === 1 ? "" : "s"}`;

  if (scanHint) {
    scanHint.textContent = count === 0
      ? "Add at least one thing to search for."
      : "Press Enter to scan · Shift + Enter adds another term.";
  }
}

function collectTerms() {
  return Array.from(termList.querySelectorAll("input"))
    .map((i) => i.value.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

// ---------------------------------------------------------------------
// Scope UI
// ---------------------------------------------------------------------
async function updateScopeUI() {
  const scope = document.querySelector('input[name="scope"]:checked')?.value || "current_page";
  maxPagesRow.classList.toggle("hidden", scope !== "entire_site");
  updateScanButton();

  if (scope === "entire_site" && activeTab?.url && /^https?:\/\//.test(activeTab.url)) {
    const origin = new URL(activeTab.url).origin;
    const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    permissionNote.classList.toggle("hidden", granted);
  } else {
    permissionNote.classList.add("hidden");
  }
}

async function requestHostPermission(origin) {
  const pattern = origin.endsWith("/") ? `${origin}*` : `${origin}/*`;
  // Called first thing inside a click handler: chrome.permissions.request needs
  // the user gesture, and an awaited contains() check beforehand consumes it.
  // request() resolves true without prompting when access is already granted.
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return chrome.permissions.contains({ origins: [pattern] });
  }
}

// ---------------------------------------------------------------------
// Scan Execution
// ---------------------------------------------------------------------
async function onScanClick() {
  hideError();
  const terms = collectTerms();
  if (!terms.length) return showError("Enter at least one thing to search for.");

  if (!activeTab?.url || !/^https?:\/\//.test(activeTab.url)) {
    return showError("Open a website (http/https) to scan it.");
  }

  const scope = document.querySelector('input[name="scope"]:checked').value;
  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning…";

  try {
    if (scope === "current_page") {
      await runCurrentPageScan(terms);
    } else {
      await runSiteCrawl(terms);
    }
  } catch (err) {
    showError(err?.message || String(err));
    showView("setup");
  } finally {
    // Restores the label and the "no terms" disabled state in one place.
    updateScanButton();
  }
}

async function runCurrentPageScan(terms) {
  showView("progress");
  startElapsedTimer();
  progressTitle.textContent = "Scanning current page…";
  progressStatusText.textContent = "In Progress";
  progressCurrentUrl.textContent = activeTab.url;
  setProgress({ discovered: 1, scanned: 0, matches: 0, elements: 0, failed: 0, pct: 30 });
  stopScanBtn.classList.add("hidden");

  const res = await chrome.runtime.sendMessage({
    type: "SCAN_CURRENT_PAGE",
    tabId: activeTab.id,
    terms,
  });
  stopScanBtn.classList.remove("hidden");

  if (!res?.ok) throw new Error(res?.error || "Could not scan current page.");

  currentScan = res.scan;
  await saveActiveViewState({ view: "results", scanId: currentScan.id });
  renderResults(currentScan, null);
  showView("results");

  if (activeTab?.id && activeTab?.url && terms.length > 0) {
    try {
      await chrome.runtime.sendMessage({
        type: "OPEN_AND_HIGHLIGHT",
        url: activeTab.url,
        terms,
        allTerms: terms,
        activeTerm: terms[0] || "",
        occurrenceIndex: 1,
        fromPopup: true,
        noFocus: true,
      });
    } catch {}
  }
}

async function runSiteCrawl(terms) {
  const origin = new URL(activeTab.url).origin;
  const granted = await requestHostPermission(origin);
  if (!granted) {
    throw new Error("Permission was not granted, so SiteFind cannot crawl this website.");
  }

  const maxPages = Number(maxPagesSelect.value);
  progressTitle.textContent = "Scanning website…";
  progressStatusText.textContent = "In Progress";
  progressCurrentUrl.textContent = "Discovering internal links & sitemaps…";

  const res = await chrome.runtime.sendMessage({
    type: "START_CRAWL",
    origin,
    terms,
    maxPages,
  });
  if (!res?.ok) throw new Error(res?.error || "Could not start crawl.");

  activeCrawlId = res.crawlId;
  showView("progress");
  startElapsedTimer();
  stopScanBtn.classList.remove("hidden");
  pollCrawl();
}

function pollCrawl() {
  clearInterval(pollTimer);
  let missCount = 0;

  pollTimer = setInterval(async () => {
    const res = await chrome.runtime.sendMessage({
      type: "GET_CRAWL_STATE",
      crawlId: activeCrawlId,
    });
    const state = res?.state;
    if (!state) {
      missCount += 1;
      if (missCount > 6) {
        clearInterval(pollTimer);
        showError("The scan was interrupted. Please try again.");
        showView("setup");
      }
      return;
    }
    missCount = 0;
    if (!elapsedTimer && state.startedAt) startElapsedTimer(state.startedAt);

    if (state.status === "interrupted" || isCrawlStateStale(state)) {
      clearInterval(pollTimer);
      await clearActiveScan();
      showError(state.error || "The scan was interrupted by Chrome. Please run it again.");
      showView("setup");
      return;
    }

    const pct = state.maxPages ? Math.min(100, Math.round((state.scanned / state.maxPages) * 100)) : 0;
    progressCurrentUrl.textContent = state.currentUrl || state.origin;
    progressStatusText.textContent = state.status === "running" ? "In Progress" : state.status === "stopped" ? "Stopped" : "Completed";

    setProgress({
      discovered: state.discovered,
      scanned: state.scanned,
      matches: state.matchesCount,
      elements: state.elementsChecked || 0,
      failed: state.failedCount,
      pct: state.status === "done" || state.status === "stopped" ? 100 : pct,
    });

    if (state.status === "done" || state.status === "stopped") {
      // In-flight pages still have to drain before the final record exists.
      if (!state.scan) {
        progressStatusText.textContent = "Finishing…";
        return;
      }
      clearInterval(pollTimer);
      if (state.saveError) showError(`Results could not be saved to history: ${state.saveError}`);
      currentScan = state.scan;
      if (currentScan?.id) {
        await saveActiveViewState({ view: "results", scanId: currentScan.id });
      }
      renderResults(currentScan, null);
      showView("results");

      if (activeTab?.id && activeTab?.url && currentScan?.terms?.length > 0) {
        try {
          await chrome.runtime.sendMessage({
            type: "OPEN_AND_HIGHLIGHT",
            url: activeTab.url,
            terms: currentScan.terms,
            allTerms: currentScan.terms,
            activeTerm: currentScan.terms[0] || "",
            occurrenceIndex: 1,
            fromPopup: true,
            noFocus: true,
          });
        } catch {}
      }
    }
  }, 500);
}

async function onStopClick() {
  if (!activeCrawlId) return;
  stopScanBtn.disabled = true;
  stopScanBtn.textContent = "Stopping…";
  progressStatusText.textContent = "Stopping…";
  try {
    await chrome.runtime.sendMessage({ type: "STOP_CRAWL", crawlId: activeCrawlId });
  } finally {
    setTimeout(() => {
      stopScanBtn.disabled = false;
      stopScanBtn.textContent = "Stop Scan";
    }, 1500);
  }
}

function setProgress({ discovered, scanned, matches, elements, failed, pct }) {
  progressFill.style.width = `${pct}%`;
  progressBar.setAttribute("aria-valuenow", String(pct));
  progressPctText.textContent = `${pct}%`;
  statDiscovered.textContent = discovered;
  statScanned.textContent = scanned;
  statMatches.textContent = matches;
  statElements.textContent = elements;
  statFailed.textContent = failed;
}

// ---------------------------------------------------------------------
// Results View Rendering (Clean Simple Table)
// ---------------------------------------------------------------------
function renderResults(scan, comparison) {
  if (!scan) return;

  // Reset selection on new scan render
  selectedRowKeys.clear();
  hasUserChangedSelection = false;

  // Populate Term Filter Dropdown
  termFilterSelect.innerHTML = '<option value="">All terms</option>';
  (scan.terms || []).forEach((t) => {
    const hitsCount = countTermMatches(scan, t);
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = `${t} (${hitsCount})`;
    termFilterSelect.appendChild(opt);
  });

  const affectedUrls = affectedUrlsOf(scan);

  const totalScanned = scan.allScannedUrls?.length || scan.pagesScanned || 1;
  affectedCountBadge.textContent = affectedUrls.size;
  allCountBadge.textContent = totalScanned;

  // Status Badge
  const status = scan.status || (affectedUrls.size > 0 ? "Needs Attention" : "No Matches");
  resultsStatusBadge.textContent = status;
  resultsStatusBadge.className = `badge ${
    status === "No Matches" ? "badge--ok" : status === "Needs Attention" ? "badge--warn" : "badge--neutral"
  }`;

  // Summary Metrics
  const totalMatches = countAllMatches(scan);
  const failedCount = (scan.failedPages || []).length;
  resultsSummary.innerHTML = `
    <div><strong>${totalMatches}</strong> match${totalMatches === 1 ? "" : "es"} on <strong>${affectedUrls.size}</strong> of <strong>${scan.pagesScanned}</strong> scanned page${scan.pagesScanned === 1 ? "" : "s"}</div>
    <div><code>${escapeHtml(hostOf(scan.site))}</code> · ${scan.scope === "current_page" ? "Current page" : "Entire website"}</div>
    ${failedCount ? `<div class="summary__warn"><strong>${failedCount}</strong> page${failedCount === 1 ? "" : "s"} could not be scanned</div>` : ""}
  `;

  // Comparison block (if verify again)
  if (comparison) {
    renderComparison(comparison);
  } else {
    comparisonBlock.className = "hidden";
    comparisonBlock.innerHTML = "";
  }

  // Render Simple Table
  renderSimpleTable();

  // Render Failed pages block
  if (failedCount > 0) {
    failedBlock.classList.remove("hidden");
    failedToggleLabel.textContent = `Pages that could not be scanned (${failedCount})`;
    failedList.innerHTML = "";
    scan.failedPages.forEach((f) => {
      const row = document.createElement("div");
      row.className = "failed-row";
      row.innerHTML = `<span class="f-url" title="${escapeAttr(f.url)}">${escapeHtml(f.url)}</span><span class="f-reason">${escapeHtml(f.reason)}</span>`;
      failedList.appendChild(row);
    });
  } else {
    failedBlock.classList.add("hidden");
  }
}

function countAllMatches(scan) {
  return countScanMatches(scan);
}

// ---------------------------------------------------------------------
// Term Selection Chips Filter (Allow selecting terms to highlight)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Simple Table Format (Requested: Simple way to view matches as rows)
// ---------------------------------------------------------------------
function renderSimpleTable() {
  if (!currentScan) return;

  const searchQuery = (resultsSearchInput.value || "").trim().toLowerCase();
  const selectedTerm = termFilterSelect.value;
  const terms = currentScan.terms || [];

  // Flatten matches into individual rows (with deduplication)
  const rows = [];
  const affectedUrls = new Set();
  const seenRowKeys = new Set();

  Object.entries(currentScan.matchesByTerm || {}).forEach(([term, data]) => {
    (data.pages || []).forEach((page) => {
      affectedUrls.add(page.url);
      const cleanHits = getCleanPageHits(page);
      cleanHits.forEach((hit, idx) => {
        const cleanContext = (hit.context || "").replace(/\s+/g, " ").trim().toLowerCase();
        const dedupeKey = `${page.url}:::${term}:::${(hit.matchedText || "").toLowerCase()}:::${cleanContext.slice(0, 45)}`;
        if (seenRowKeys.has(dedupeKey)) return;
        seenRowKeys.add(dedupeKey);

        rows.push({
          url: page.url,
          term,
          matchedText: hit.matchedText,
          context: hit.context,
          tag: hit.tag || hit.elementType || "text",
          occurrenceIndex: hit.occurrenceIndex || idx + 1,
          selector: hit.selector || "",
        });
      });
    });
  });

  // If viewing "All Pages", also add clean pages as clean rows
  if (viewMode === "all") {
    const allUrls = currentScan.allScannedUrls || [currentScan.site];
    allUrls.forEach((url) => {
      if (!affectedUrls.has(url)) {
        rows.push({
          url,
          term: "—",
          matchedText: "",
          context: "Clean (No stale matches found)",
          tag: "clean",
          occurrenceIndex: 0,
          isClean: true,
        });
      }
    });
  }

  // Filter rows
  const filtered = rows.filter((r) => {
    if (selectedTerm && r.term !== selectedTerm && !r.isClean) return false;
    if (searchQuery) {
      const hay = `${r.url} ${r.term} ${r.matchedText || ""} ${r.context || ""}`.toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  lastFilteredRows = filtered;
  matchList.innerHTML = "";
  tableEmptyState.classList.toggle("hidden", filtered.length > 0);
  renderResultsCountLine(filtered, rows, { searchQuery, selectedTerm });
  allRenderedRowsMap.clear();

  filtered.forEach((row) => {
    const li = document.createElement("li");
    li.className = row.isClean ? "match match--clean" : "match";

    if (row.isClean) {
      li.innerHTML = `
        <div class="match__head">
          <a class="match__page" href="${escapeAttr(row.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(row.url)}">${escapeHtml(pathOf(row.url))}</a>
          <span class="badge badge--ok">Clean</span>
        </div>
        <p class="match__context">No stale matches on this page</p>
      `;
      matchList.appendChild(li);
      return;
    }

    const rowKey = `${row.url}:::${row.term}:::${row.occurrenceIndex}:::${row.matchedText}`;
    allRenderedRowsMap.set(rowKey, row);

    li.innerHTML = `
      <div class="match__head">
        <a class="match__page" href="${escapeAttr(row.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(row.url)}">${escapeHtml(pathOf(row.url))}</a>
        <span class="badge badge--neutral match__term" title="${escapeAttr(row.term)}">${escapeHtml(row.term)}</span>
      </div>
      <p class="match__context">${highlightSnippet(row.context || row.matchedText, row.matchedText)}</p>
      <div class="match__foot">
        <span class="match__where">${escapeHtml(row.tag || "text")}</span>
        <div class="match__actions">
          <button class="btn btn--ghost btn--sm js-copy" type="button" title="Copy this page URL">Copy</button>
          <button class="btn btn--secondary btn--sm js-highlight" type="button" title="Open the page and jump to this match">Show on page</button>
        </div>
      </div>
    `;

    li.querySelector(".js-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(row.url);
        showToast("Page URL copied");
      } catch {
        showToast("Could not copy to clipboard.", "error");
      }
    });

    li.querySelector(".js-highlight").addEventListener("click", async () => {
      if (currentScan?.id) {
        await saveActiveViewState({ view: "results", scanId: currentScan.id });
      }
      await chrome.runtime.sendMessage({
        type: "OPEN_AND_HIGHLIGHT",
        url: row.url,
        term: row.term,
        matchedText: row.matchedText,
        allTerms: currentScan?.terms || [row.term],
        activeTerm: row.term,
        occurrenceIndex: row.occurrenceIndex || 1,
        selector: row.selector || "",
        fromPopup: true,
      });
    });

    matchList.appendChild(li);
  });
}

function renderResultsCountLine(filtered, allRows, { searchQuery, selectedTerm }) {
  if (!resultsCountLine) return;

  const pages = new Set(filtered.map((r) => r.url)).size;
  const isFiltered = Boolean(searchQuery || selectedTerm);
  const matchRows = filtered.filter((r) => !r.isClean).length;

  if (!allRows.length) {
    resultsCountLine.textContent = "";
    return;
  }

  resultsCountLine.textContent = isFiltered
    ? `Showing ${matchRows} match${matchRows === 1 ? "" : "es"} on ${pages} page${pages === 1 ? "" : "s"} (filtered)`
    : `${matchRows} match${matchRows === 1 ? "" : "es"} on ${pages} page${pages === 1 ? "" : "s"}`;

  if (tableEmptyState && !filtered.length) {
    const title = tableEmptyState.querySelector(".empty__title");
    const sub = tableEmptyState.querySelector(".empty__sub");
    if (title && sub) {
      if (isFiltered) {
        title.textContent = "No matching results";
        sub.innerHTML = "Try clearing the filter or switching to <strong>All</strong>.";
      } else {
        title.textContent = "Nothing stale found 🎉";
        sub.textContent = "None of your search terms appear on the scanned pages.";
      }
    }
  }
}

async function onCopyUrls() {
  const urls = Array.from(new Set(lastFilteredRows.map((r) => r.url)));
  if (!urls.length) return showToast("No pages to copy.", "error");
  try {
    await navigator.clipboard.writeText(urls.join("\n"));
    showToast(`Copied ${urls.length} URL${urls.length === 1 ? "" : "s"}`);
  } catch {
    showToast("Could not copy to clipboard.", "error");
  }
}

function highlightSnippet(context, matchedText) {
  if (!context) return "";
  const safe = escapeHtml(context);
  if (!matchedText) return safe;
  // Match against the escaped haystack, so terms containing & < > " ' still mark.
  const re = new RegExp(`(${escapeRegExp(escapeHtml(matchedText))})`, "gi");
  return safe.replace(re, `<mark style="background:#fef08a;color:#854d0e;padding:1px 3px;border-radius:2px;font-weight:700;">$1</mark>`);
}

// ---------------------------------------------------------------------
// Verify Again
// ---------------------------------------------------------------------
async function onVerifyAgain() {
  if (!currentScan) return;
  hideError();

  const baseline = currentScan;
  try {
    if (baseline.scope === "current_page") {
      const targetUrl = baseline.allScannedUrls?.[0] || baseline.site;
      const res = await verifySinglePage(baseline, targetUrl);
      if (!res?.ok) throw new Error(res?.error || "Could not verify.");
      const comparison = buildComparison(baseline, res.scan);
      currentScan = res.scan;
      await saveActiveViewState({ view: "results", scanId: currentScan.id });
      renderResults(currentScan, comparison);
      showView("results");
    } else {
      const granted = await requestHostPermission(baseline.site);
      if (!granted) throw new Error("Permission was not granted.");

      const res = await chrome.runtime.sendMessage({
        type: "START_CRAWL",
        origin: baseline.site,
        terms: baseline.terms,
        maxPages: baseline.maxPages,
      });
      if (!res?.ok) throw new Error(res?.error || "Could not start crawl.");
      activeCrawlId = res.crawlId;
      showView("progress");

      await new Promise((resolve, reject) => {
        clearInterval(pollTimer);
        let misses = 0;
        pollTimer = setInterval(async () => {
          const r = await chrome.runtime.sendMessage({ type: "GET_CRAWL_STATE", crawlId: activeCrawlId });
          const state = r?.state;
          if (!state) {
            if (++misses > 12) {
              clearInterval(pollTimer);
              reject(new Error("The verification scan was interrupted."));
            }
            return;
          }
          misses = 0;
          if (state.status === "interrupted" || isCrawlStateStale(state)) {
            clearInterval(pollTimer);
            await clearActiveScan();
            reject(new Error(state.error || "The verification scan was interrupted by Chrome."));
            return;
          }
          const pct = state.maxPages ? Math.min(100, Math.round((state.scanned / state.maxPages) * 100)) : 0;
          setProgress({
            discovered: state.discovered,
            scanned: state.scanned,
            matches: state.matchesCount,
            elements: state.elementsChecked || 0,
            failed: state.failedCount,
            pct: state.status === "done" || state.status === "stopped" ? 100 : pct,
          });
          if (state.status === "done" || state.status === "stopped") {
            if (!state.scan) return; // waiting for in-flight pages to drain
            clearInterval(pollTimer);
            const comparison = buildComparison(baseline, state.scan);
            currentScan = state.scan;
            if (currentScan?.id) {
              saveActiveViewState({ view: "results", scanId: currentScan.id });
            }
            renderResults(currentScan, comparison);
            showView("results");
            resolve();
          }
        }, 500);
      });
    }
  } catch (err) {
    reportVerifyError(err?.message || String(err));
  }
}

/**
 * Verification errors have to be visible from wherever the user triggered them:
 * the setup error line is not on screen while the results view is showing.
 */
function reportVerifyError(message) {
  const onResults = views.results && !views.results.classList.contains("hidden");
  if (!onResults) {
    showError(message);
    showView("setup");
    return;
  }
  comparisonBlock.className = "";
  comparisonBlock.innerHTML = `<div class="verify-error">${escapeHtml(message)}</div>`;
  showView("results");
}

/**
 * Re-scan one specific page. If it is the page in the active tab we can use the
 * activeTab grant; otherwise the background needs host access to open and read
 * it, so tell the user rather than silently verifying the wrong page.
 */
async function verifySinglePage(baseline, targetUrl) {
  const isActiveTab = activeTab?.url && samePage(activeTab.url, targetUrl);

  if (isActiveTab) {
    showView("progress");
    progressTitle.textContent = "Verifying current page…";
    progressCurrentUrl.textContent = targetUrl;
    return chrome.runtime.sendMessage({
      type: "SCAN_CURRENT_PAGE",
      tabId: activeTab.id,
      terms: baseline.terms,
    });
  }

  let origin = "";
  try { origin = new URL(targetUrl).origin; } catch {}
  const granted = origin
    ? await chrome.permissions.contains({ origins: [`${origin}/*`] })
    : false;

  if (!granted) {
    return {
      ok: false,
      error: `This scan covered ${targetUrl}. Open that page in the current tab and click Verify Again.`,
    };
  }

  showView("progress");
  progressTitle.textContent = "Verifying scanned page…";
  progressCurrentUrl.textContent = targetUrl;
  return chrome.runtime.sendMessage({
    type: "SCAN_URL_PAGE",
    url: targetUrl,
    terms: baseline.terms,
  });
}

function samePage(a, b) {
  const clean = (u) => {
    try {
      const parsed = new URL(u);
      return (parsed.origin + parsed.pathname).replace(/\/+$/, "").toLowerCase();
    } catch {
      return String(u || "").split("#")[0].replace(/\/+$/, "").toLowerCase();
    }
  };
  return Boolean(a) && Boolean(b) && clean(a) === clean(b);
}

function buildComparison(prev, cur) {
  const termSet = new Set([...(prev.terms || []), ...(cur.terms || [])]);
  const rows = [...termSet].map((term) => {
    const prevCount = countTermMatches(prev, term);
    const curCount = countTermMatches(cur, term);

    let status = "Remaining ⚠";
    if (prevCount > 0 && curCount === 0) status = "Removed ✓";
    else if (prevCount === 0 && curCount > 0) status = "New match ⚠";
    else if (prevCount === 0 && curCount === 0) status = "Clean ✓";

    return { label: term, before: prevCount, now: curCount, status };
  });

  return { rows };
}

function renderComparison(cmp) {
  comparisonBlock.classList.remove("hidden");
  comparisonBlock.className = "diff";
  comparisonBlock.innerHTML = `
    <p class="diff__title">Verification</p>
    <table>
      <thead>
        <tr><th>Term</th><th>Before</th><th>Now</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${cmp.rows.map((r) => `
          <tr>
            <td>${escapeHtml(r.label)}</td>
            <td>${r.before}</td>
            <td>${r.now}</td>
            <td class="${r.status.includes('Removed') || r.status.includes('Clean') ? 'removed' : r.status.includes('New') ? 'new-match' : 'remaining'}">${r.status}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------
// Export Handlers
// ---------------------------------------------------------------------
function getFilteredUrls() {
  const searchQuery = (resultsSearchInput.value || "").trim().toLowerCase();
  const selectedTerm = termFilterSelect.value;
  if (!searchQuery && !selectedTerm && viewMode === "all") return null;
  // Every filtered row, not just the ones currently rendered.
  return Array.from(new Set(lastFilteredRows.map((r) => r.url)));
}

function onExportCsv() {
  if (!currentScan) return;
  const filtered = getFilteredUrls();
  const csv = toCsv(currentScan, filtered);
  downloadFile(fileNameFor(currentScan, "csv"), csv, "text/csv");
  showToast(filtered ? "CSV exported (filtered rows)" : "CSV exported");
}

function onExportJson() {
  if (!currentScan) return;
  const filtered = getFilteredUrls();
  const json = toJson(currentScan, filtered);
  downloadFile(fileNameFor(currentScan, "json"), json, "application/json");
  showToast(filtered ? "JSON exported (filtered rows)" : "JSON exported");
}

// ---------------------------------------------------------------------
// History View
// ---------------------------------------------------------------------
async function openHistory() {
  showView("history");
  const history = await getHistory();
  historyList.innerHTML = "";
  historyEmpty.classList.toggle("hidden", history.length > 0);

  const clearHistoryBtn = $("#clearHistoryBtn");
  if (clearHistoryBtn) {
    clearHistoryBtn.classList.toggle("hidden", history.length === 0);
    clearHistoryBtn.onclick = async () => {
      if (confirm("Are you sure you want to clear all scan history?")) {
        await clearHistory();
        await openHistory();
      }
    };
  }

  history.forEach((scan) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const date = new Date(scan.finishedAt || scan.startedAt).toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const totalMatches = countAllMatches(scan);

    const statusClass = scan.status === "No Matches" ? "badge--ok"
      : scan.status === "Needs Attention" ? "badge--warn"
      : "badge--neutral";

    item.innerHTML = `
      <div class="history-item__head">
        <span class="h-site">${escapeHtml(hostOf(scan.site))}</span>
        <span class="badge ${statusClass}">${escapeHtml(scan.status || "Completed")}</span>
      </div>
      <div class="h-summary"><strong>${totalMatches}</strong> match${totalMatches === 1 ? "" : "es"} · ${scan.pagesScanned} page${scan.pagesScanned === 1 ? "" : "s"} scanned</div>
      <div class="h-date">${date} · ${scan.scope === "current_page" ? "Current page" : "Entire website"}</div>
      <div class="h-actions">
        <button class="btn btn--secondary btn--sm" data-action="view">Open</button>
        <button class="btn btn--ghost btn--sm" data-action="full">Workspace ↗</button>
        <button class="btn btn--ghost btn--sm" data-action="verify">Verify</button>
        <button class="btn btn--ghost btn--sm" data-action="csv">CSV</button>
        <button class="btn btn--ghost btn--sm btn--danger-text" data-action="delete">Delete</button>
      </div>
    `;

    item.querySelector('[data-action="view"]').addEventListener("click", async () => {
      currentScan = scan;
      await saveActiveViewState({ view: "results", scanId: scan.id });
      renderResults(scan, null);
      showView("results");
    });

    item.querySelector('[data-action="full"]').addEventListener("click", () => {
      chrome.tabs.create({ url: `results.html?scanId=${scan.id}` });
    });

    item.querySelector('[data-action="verify"]').addEventListener("click", () => {
      currentScan = scan;
      onVerifyAgain();
    });

    item.querySelector('[data-action="csv"]').addEventListener("click", () => {
      downloadFile(fileNameFor(scan, "csv"), toCsv(scan), "text/csv");
    });

    item.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      await deleteHistoryScan(scan.id);
      openHistory();
    });

    historyList.appendChild(item);
  });
}

// ---------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------
function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el?.classList) el.classList.toggle("hidden", key !== name);
  });

  if (name !== "progress") stopElapsedTimer();

  // Put the caret where the user is most likely to work next.
  if (name === "setup") {
    const firstEmpty = Array.from(termList.querySelectorAll("input")).find((i) => !i.value.trim());
    firstEmpty?.focus();
  } else if (name === "results") {
    views.results?.scrollTo?.({ top: 0 });
  }
}

function showToast(message, kind = "info") {
  if (!toastHost) return;
  const toast = document.createElement("div");
  toast.className = `toast ${kind === "error" ? "error" : ""}`.trim();
  toast.textContent = message;
  toastHost.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function startElapsedTimer(startedAt) {
  scanStartedAt = startedAt || Date.now();
  stopElapsedTimer();
  const tick = () => {
    const secs = Math.round((Date.now() - scanStartedAt) / 1000);
    if (progressElapsed) {
      progressElapsed.textContent = secs < 60
        ? `${secs}s elapsed`
        : `${Math.floor(secs / 60)}m ${secs % 60}s elapsed`;
    }
  };
  tick();
  elapsedTimer = setInterval(tick, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
}

async function setupOnboarding() {
  if (!onboardingCard) return;
  let dismissed = false;
  try {
    const stored = await chrome.storage.local.get(ONBOARDING_KEY);
    dismissed = Boolean(stored[ONBOARDING_KEY]);
  } catch {}

  const history = await getHistory();
  if (!dismissed && history.length === 0) onboardingCard.classList.remove("hidden");

  dismissOnboardingBtn?.addEventListener("click", async () => {
    onboardingCard.classList.add("hidden");
    try { await chrome.storage.local.set({ [ONBOARDING_KEY]: true }); } catch {}
  });
}

function showError(msg) {
  if (setupError) {
    setupError.textContent = msg;
    setupError.classList.remove("hidden");
  }
}

function hideError() {
  if (setupError) {
    setupError.classList.add("hidden");
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url || "");
  }
}

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

function fileNameFor(scan, ext) {
  const host = (() => { try { return new URL(scan.site).hostname; } catch { return "site"; } })();
  const date = new Date(scan.finishedAt || scan.startedAt).toISOString().slice(0, 10);
  return `sitefind_${host}_${date}.${ext}`;
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
