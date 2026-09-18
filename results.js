import { getScan, getHistory, isCrawlStateStale } from "./lib/storage.js";
import { toCsv, toJson } from "./lib/export.js";
import { getCleanPageHits, countScanMatches, countTermMatches, affectedUrls as affectedUrlsOf } from "./lib/hits.js";

// ---------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

const siteMetaText = $("#siteMetaText");
const scanStatusBadge = $("#scanStatusBadge");
const headerVerifyBtn = $("#headerVerifyBtn");
const exportCsvBtn = $("#exportCsvBtn");
const exportJsonBtn = $("#exportJsonBtn");

const metricScanned = $("#metricScanned");
const metricAffected = $("#metricAffected");
const metricClean = $("#metricClean");
const metricMatches = $("#metricMatches");
const metricFailed = $("#metricFailed");

const diffSection = $("#diffSection");
const diffContent = $("#diffContent");
const closeDiffBtn = $("#closeDiffBtn");

const workspaceSearchInput = $("#workspaceSearchInput");
const toggleAffected = $("#toggleAffected");
const toggleAll = $("#toggleAll");
const workspaceTermFilter = $("#workspaceTermFilter");
const sortSelect = $("#sortSelect");

const workspaceTableHead = $("#workspaceTableHead");
const workspaceTableBody = $("#workspaceTableBody");
const noResultsState = $("#noResultsState");

const paginationInfo = $("#paginationInfo");
const perPageSelect = $("#perPageSelect");
const prevPageBtn = $("#prevPageBtn");
const nextPageBtn = $("#nextPageBtn");
const pageNumbers = $("#pageNumbers");

const workspaceFailedSection = $("#workspaceFailedSection");
const workspaceFailedToggle = $("#workspaceFailedToggle");
const failedHeading = $("#failedHeading");
const workspaceFailedList = $("#workspaceFailedList");
const copyUrlsBtn = $("#copyUrlsBtn");
const noResultsText = $("#noResultsText");
const toastHost = $("#toastHost");

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let scanData = null;
let viewMode = "affected"; // "affected" | "all"
let currentPage = 1;
let rowsPerPage = 50;
let expandedRows = new Set();
let lastFilteredRows = [];

init();

async function init() {
  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scanId");

  if (scanId) {
    scanData = await getScan(scanId);
  }

  if (!scanData) {
    const history = await getHistory();
    scanData = history[0] || null;
  }

  if (!scanData) {
    siteMetaText.textContent = "No scan data found yet.";
    noResultsState.classList.remove("hidden");
    if (noResultsText) {
      noResultsText.textContent =
        "Nothing to show yet. Open the SiteFind icon in your toolbar, enter what you are looking for, and run a scan — the full results land here.";
    }
    return;
  }

  bindEvents();
  renderWorkspace();
}

function bindEvents() {
  toggleAffected.addEventListener("click", () => {
    viewMode = "affected";
    toggleAffected.classList.add("active");
    toggleAll.classList.remove("active");
    currentPage = 1;
    renderTable();
  });

  toggleAll.addEventListener("click", () => {
    viewMode = "all";
    toggleAll.classList.add("active");
    toggleAffected.classList.remove("active");
    currentPage = 1;
    renderTable();
  });

  workspaceSearchInput.addEventListener("input", () => {
    currentPage = 1;
    renderTable();
  });

  workspaceTermFilter.addEventListener("change", () => {
    currentPage = 1;
    renderTable();
  });

  sortSelect.addEventListener("change", () => {
    currentPage = 1;
    renderTable();
  });

  perPageSelect.addEventListener("change", (e) => {
    rowsPerPage = Number(e.target.value);
    currentPage = 1;
    renderTable();
  });

  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });

  nextPageBtn.addEventListener("click", () => {
    currentPage++;
    renderTable();
  });

  workspaceFailedToggle.addEventListener("click", () => {
    workspaceFailedList.classList.toggle("hidden");
  });

  closeDiffBtn.addEventListener("click", () => {
    diffSection.classList.add("hidden");
  });

  headerVerifyBtn.addEventListener("click", onVerifyAgain);
  exportCsvBtn.addEventListener("click", onExportCsv);
  exportJsonBtn.addEventListener("click", onExportJson);
  copyUrlsBtn?.addEventListener("click", onCopyUrls);

  // Keyboard: "/" focuses search, Escape clears it, arrows page through results.
  document.addEventListener("keydown", (e) => {
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);

    if (e.key === "/" && !typing) {
      e.preventDefault();
      workspaceSearchInput.focus();
      workspaceSearchInput.select();
      return;
    }

    if (e.key === "Escape" && document.activeElement === workspaceSearchInput) {
      workspaceSearchInput.value = "";
      currentPage = 1;
      renderTable();
      workspaceSearchInput.blur();
      return;
    }

    if (typing) return;

    if (e.key === "ArrowRight" && !nextPageBtn.disabled) {
      nextPageBtn.click();
    } else if (e.key === "ArrowLeft" && !prevPageBtn.disabled) {
      prevPageBtn.click();
    }
  });
}

function showToast(message, kind = "info") {
  if (!toastHost) return;
  const toast = document.createElement("div");
  toast.className = `toast ${kind === "error" ? "error" : ""}`.trim();
  toast.textContent = message;
  toastHost.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
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

// ---------------------------------------------------------------------
// Workspace Render
// ---------------------------------------------------------------------
function renderWorkspace() {
  const dateStr = new Date(scanData.finishedAt || scanData.startedAt).toLocaleString();
  siteMetaText.textContent = `${scanData.site} · Audited on ${dateStr} · ${scanData.scope === "current_page" ? "Current Page" : "Entire Website"}`;

  // Terms in dropdown
  workspaceTermFilter.innerHTML = '<option value="">All Search Terms</option>';
  (scanData.terms || []).forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    workspaceTermFilter.appendChild(opt);
  });

  // Calculate stats
  const affectedUrls = affectedUrlsOf(scanData);
  const totalHits = countScanMatches(scanData);

  const scannedCount = scanData.allScannedUrls?.length || scanData.pagesScanned || 1;
  const cleanCount = Math.max(0, scannedCount - affectedUrls.size);
  const failedCount = (scanData.failedPages || []).length;

  // Status Badge
  const status = scanData.status || (affectedUrls.size > 0 ? "Needs Attention" : "No Matches");
  scanStatusBadge.textContent = status;
  scanStatusBadge.className = `status-pill ${status === "No Matches" ? "ok" : status === "Needs Attention" ? "warn" : "danger"}`;

  // Metric Cards
  metricScanned.textContent = scannedCount;
  metricAffected.textContent = affectedUrls.size;
  metricClean.textContent = cleanCount;
  metricMatches.textContent = totalHits;
  metricFailed.textContent = failedCount;

  // Failed list
  if (failedCount > 0) {
    workspaceFailedSection.classList.remove("hidden");
    failedHeading.textContent = `Pages that could not be scanned (${failedCount})`;
    workspaceFailedList.innerHTML = "";
    scanData.failedPages.forEach((f) => {
      const row = document.createElement("div");
      row.className = "failed-item";
      row.innerHTML = `<span class="f-url">${escapeHtml(f.url)}</span><span class="f-reason">${escapeHtml(f.reason)}</span>`;
      workspaceFailedList.appendChild(row);
    });
  } else {
    workspaceFailedSection.classList.add("hidden");
  }

  renderTable();
}

// ---------------------------------------------------------------------
// Table & Pagination Render (Task 16, 17)
// ---------------------------------------------------------------------
function renderTable() {
  const searchQuery = (workspaceSearchInput.value || "").trim().toLowerCase();
  const selectedTerm = workspaceTermFilter.value;
  const sortMode = sortSelect.value;
  const terms = scanData.terms || [];

  // Table header
  workspaceTableHead.innerHTML = `
    <tr>
      <th>Page URL</th>
      ${terms.map((t) => `<th>${escapeHtml(t)}</th>`).join("")}
      <th>Total Matches</th>
      <th>Actions</th>
    </tr>
  `;

  // Build rows dataset
  const pageMap = new Map();
  const allUrls = scanData.allScannedUrls && scanData.allScannedUrls.length > 0
    ? scanData.allScannedUrls
    : Array.from(new Set(Object.values(scanData.matchesByTerm || {}).flatMap((d) => d.pages.map((p) => p.url))));

  allUrls.forEach((url) => {
    pageMap.set(url, { url, termCounts: {}, total: 0, hitsByTerm: {} });
    terms.forEach((t) => {
      pageMap.get(url).termCounts[t] = 0;
      pageMap.get(url).hitsByTerm[t] = [];
    });
  });

  Object.entries(scanData.matchesByTerm || {}).forEach(([term, data]) => {
    data.pages.forEach((p) => {
      if (!pageMap.has(p.url)) {
        pageMap.set(p.url, { url: p.url, termCounts: {}, total: 0, hitsByTerm: {} });
        terms.forEach((t) => {
          pageMap.get(p.url).termCounts[t] = 0;
          pageMap.get(p.url).hitsByTerm[t] = [];
        });
      }
      const entry = pageMap.get(p.url);
      const hits = getCleanPageHits(p);
      entry.termCounts[term] = hits.length;
      entry.total += hits.length;
      entry.hitsByTerm[term] = hits;
    });
  });

  let rows = Array.from(pageMap.values());

  // Filter: Affected vs All
  if (viewMode === "affected") {
    rows = rows.filter((r) => r.total > 0);
  }

  // Filter: Selected Search Term
  if (selectedTerm) {
    rows = rows.filter((r) => (r.termCounts[selectedTerm] || 0) > 0);
  }

  // Filter: Search Query
  if (searchQuery) {
    rows = rows.filter((r) => {
      if (r.url.toLowerCase().includes(searchQuery)) return true;
      for (const term of terms) {
        for (const hit of r.hitsByTerm[term] || []) {
          if (hit.matchedText?.toLowerCase().includes(searchQuery)) return true;
          if (hit.context?.toLowerCase().includes(searchQuery)) return true;
        }
      }
      return false;
    });
  }

  // Sorting
  if (sortMode === "matches_desc") {
    rows.sort((a, b) => b.total - a.total);
  } else if (sortMode === "matches_asc") {
    rows.sort((a, b) => a.total - b.total);
  } else if (sortMode === "url_asc") {
    rows.sort((a, b) => a.url.localeCompare(b.url));
  } else if (sortMode === "url_desc") {
    rows.sort((a, b) => b.url.localeCompare(a.url));
  }

  lastFilteredRows = rows;

  // Pagination calculation (Task 17)
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  currentPage = Math.min(currentPage, totalPages);

  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, totalRows);
  const pagedRows = rows.slice(startIndex, endIndex);

  paginationInfo.textContent = totalRows > 0
    ? `Showing ${startIndex + 1}–${endIndex} of ${totalRows} pages`
    : `Showing 0 of 0 pages`;

  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;

  // Render page buttons
  renderPageButtons(totalPages);

  // Render Table Body
  workspaceTableBody.innerHTML = "";
  noResultsState.classList.toggle("hidden", pagedRows.length > 0);
  if (noResultsText && !pagedRows.length) {
    noResultsText.textContent = (searchQuery || selectedTerm)
      ? "No pages match this search or filter. Clear it to see everything scanned."
      : viewMode === "affected"
        ? "Nothing stale found 🎉 — none of your search terms appear on the scanned pages."
        : "No pages were scanned.";
  }

  pagedRows.forEach((row) => {
    const tr = document.createElement("tr");
    const isExpanded = expandedRows.has(row.url);

    tr.innerHTML = `
      <td class="url-cell" title="Open ${escapeAttr(row.url)}" data-url="${escapeAttr(row.url)}">${escapeHtml(row.url)}</td>
      ${terms.map((t) => {
        const count = row.termCounts[t] || 0;
        return `<td class="count-cell ${count > 0 ? "has-matches" : "clean"}">${count}</td>`;
      }).join("")}
      <td class="total-cell">${row.total}</td>
      <td>
        <button class="action-btn toggle-detail-btn" type="button">${isExpanded ? "Hide Details" : "View Matches"}</button>
      </td>
    `;

    // Click URL opens tab
    tr.querySelector(".url-cell").addEventListener("click", () => {
      chrome.tabs.create({ url: row.url });
    });

    const toggleBtn = tr.querySelector(".toggle-detail-btn");
    const toggleAction = () => {
      if (expandedRows.has(row.url)) {
        expandedRows.delete(row.url);
      } else {
        expandedRows.add(row.url);
      }
      renderTable();
    };

    toggleBtn.addEventListener("click", toggleAction);
    tr.querySelectorAll(".count-cell.has-matches").forEach((cell) => {
      cell.addEventListener("click", toggleAction);
    });

    workspaceTableBody.appendChild(tr);

    // Expanded Drawer Row
    if (isExpanded) {
      const detailTr = document.createElement("tr");
      detailTr.className = "workspace-detail-row";
      const colSpan = terms.length + 3;

      detailTr.innerHTML = `
        <td colspan="${colSpan}">
          <div class="detail-drawer">
            <div class="detail-drawer-header">
              <span class="detail-drawer-title">Found Matches on ${escapeHtml(row.url)}</span>
              <input type="text" class="detail-search-input" placeholder="Search matches on this page..." />
            </div>
            <div class="match-cards-grid"></div>
          </div>
        </td>
      `;

      const grid = detailTr.querySelector(".match-cards-grid");
      const searchInput = detailTr.querySelector(".detail-search-input");

      function renderMatchCards(filterText = "") {
        grid.innerHTML = "";
        let count = 0;

        terms.forEach((term) => {
          const hits = row.hitsByTerm[term] || [];
          hits.forEach((hit, idx) => {
            if (filterText) {
              const m = (hit.matchedText || "").toLowerCase();
              const c = (hit.context || "").toLowerCase();
              if (!m.includes(filterText) && !c.includes(filterText)) return;
            }

            count++;
            const card = document.createElement("div");
            card.className = "ws-match-card";
            card.innerHTML = `
              <div class="ws-match-header">
                <span class="ws-match-term">${escapeHtml(term)}</span>
                <span class="ws-match-type">${escapeHtml(hit.elementType || hit.tag || "visible text")}</span>
              </div>
              <div class="ws-match-context">${highlightSnippet(hit.context, hit.matchedText)}</div>
              <div class="ws-match-actions">
                <button class="btn-ws-highlight" type="button">Open &amp; Highlight ↗</button>
                <a class="btn-ws-open" target="_blank" rel="noopener noreferrer" href="${escapeAttr(row.url)}">Open Page</a>
                <button class="btn-ws-copy" type="button" title="Copy the matched text">Copy match</button>
              </div>
            `;

            // Open & Highlight
            card.querySelector(".btn-ws-highlight").addEventListener("click", () => {
              chrome.runtime.sendMessage({
                type: "OPEN_AND_HIGHLIGHT",
                url: row.url,
                term,
                matchedText: hit.matchedText,
                allTerms: scanData.terms || [term],
                activeTerm: term,
                occurrenceIndex: hit.occurrenceIndex || idx + 1,
                selector: hit.selector || "",
              });
            });

            card.querySelector(".btn-ws-copy").addEventListener("click", async () => {
              try {
                await navigator.clipboard.writeText(hit.matchedText || "");
                showToast("Matched text copied");
              } catch {
                showToast("Could not copy to clipboard.", "error");
              }
            });

            grid.appendChild(card);
          });
        });

        if (count === 0) {
          grid.innerHTML = '<p class="empty-state-box">No matches found on this page.</p>';
        }
      }

      searchInput.addEventListener("input", (e) => {
        renderMatchCards(e.target.value.trim().toLowerCase());
      });

      renderMatchCards();
      workspaceTableBody.appendChild(detailTr);
    }
  });
}

function renderPageButtons(totalPages) {
  pageNumbers.innerHTML = "";
  if (totalPages <= 1) return;

  const maxButtons = 7;
  let start = Math.max(1, currentPage - 3);
  let end = Math.min(totalPages, start + maxButtons - 1);
  if (end - start < maxButtons - 1) {
    start = Math.max(1, end - maxButtons + 1);
  }

  for (let p = start; p <= end; p++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `page-number-btn ${p === currentPage ? "active" : ""}`;
    btn.textContent = p;
    btn.addEventListener("click", () => {
      currentPage = p;
      renderTable();
    });
    pageNumbers.appendChild(btn);
  }
}

function highlightSnippet(context, matchedText) {
  if (!context) return "";
  const safe = escapeHtml(context);
  if (!matchedText) return safe;
  // Match against the escaped haystack, so terms containing & < > " ' still mark.
  const re = new RegExp(`(${escapeRegExp(escapeHtml(matchedText))})`, "gi");
  return safe.replace(re, `<mark style="background:#fef08a;color:#854d0e;padding:1px 3px;border-radius:2px;">$1</mark>`);
}

// ---------------------------------------------------------------------
// Verify Again
// ---------------------------------------------------------------------
async function onVerifyAgain() {
  if (!scanData) return;

  const baseline = scanData;
  // Must be the first call in the click handler: chrome.permissions.request
  // needs the user gesture, and an awaited check beforehand consumes it.
  // Without host access every fetch fails and the diff would falsely report
  // that everything was fixed.
  const granted = await requestSiteAccess(baseline.site);
  if (!granted) {
    alert("SiteFind needs permission to read this site before it can verify. Verification cancelled.");
    return;
  }

  headerVerifyBtn.disabled = true;
  headerVerifyBtn.textContent = "Verifying…";

  try {
    if (baseline.scope === "current_page") {
      const targetUrl = baseline.allScannedUrls?.[0] || baseline.site;
      const res = await chrome.runtime.sendMessage({
        type: "SCAN_URL_PAGE",
        url: targetUrl,
        terms: baseline.terms,
      });
      if (!res?.ok) throw new Error(res?.error || "Could not verify this page.");
      scanData = res.scan;
      renderWorkspace();
      renderDiff(baseline, scanData);
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: "START_CRAWL",
      origin: baseline.site,
      terms: baseline.terms,
      maxPages: baseline.maxPages,
    });
    if (!res?.ok) throw new Error(res?.error || "Could not start verify scan");

    const crawlId = res.crawlId;
    await new Promise((resolve, reject) => {
      let misses = 0;
      const poll = setInterval(async () => {
        const stateRes = await chrome.runtime.sendMessage({ type: "GET_CRAWL_STATE", crawlId });
        const s = stateRes?.state;
        if (!s) {
          // Do not poll a crawl that no longer exists forever.
          if (++misses > 20) {
            clearInterval(poll);
            reject(new Error("The verification scan was interrupted."));
          }
          return;
        }
        misses = 0;
        if (s.status === "interrupted" || isCrawlStateStale(s)) {
          clearInterval(poll);
          reject(new Error(s.error || "The verification scan was interrupted by Chrome."));
          return;
        }
        if (s.status === "done" || s.status === "stopped") {
          if (!s.scan) return; // waiting for in-flight pages to drain
          clearInterval(poll);
          scanData = s.scan;
          renderWorkspace();
          renderDiff(baseline, scanData);
          resolve();
        }
      }, 600);
    });
  } catch (err) {
    alert("Verification failed: " + (err?.message || err));
  } finally {
    headerVerifyBtn.disabled = false;
    headerVerifyBtn.textContent = "Verify Again";
  }
}

async function requestSiteAccess(site) {
  let pattern = "";
  try {
    pattern = `${new URL(site).origin}/*`;
  } catch {
    return false;
  }
  try {
    // Resolves true without prompting when access is already granted.
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return chrome.permissions.contains({ origins: [pattern] });
  }
}

function renderDiff(prev, cur) {
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

  diffSection.classList.remove("hidden");
  diffContent.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
      <thead>
        <tr style="text-align:left;border-bottom:1px solid var(--line);">
          <th style="padding:6px 8px;">Search Term</th>
          <th style="padding:6px 8px;">Before</th>
          <th style="padding:6px 8px;">Now</th>
          <th style="padding:6px 8px;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr style="border-bottom:1px solid var(--line-soft);">
            <td style="padding:6px 8px;font-weight:600;">${escapeHtml(r.label)}</td>
            <td style="padding:6px 8px;">${r.before}</td>
            <td style="padding:6px 8px;">${r.now}</td>
            <td style="padding:6px 8px;font-weight:700;color:${r.status.includes('Removed') || r.status.includes('Clean') ? 'var(--success)' : r.status.includes('New') ? 'var(--danger)' : 'var(--warn)'};">${r.status}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------
function getActiveFilteredUrls() {
  const searchQuery = (workspaceSearchInput.value || "").trim().toLowerCase();
  const selectedTerm = workspaceTermFilter.value;
  if (!searchQuery && !selectedTerm && viewMode === "all") return null;
  // Every filtered row, not just the current pagination page.
  return Array.from(new Set(lastFilteredRows.map((r) => r.url)));
}

function onExportCsv() {
  if (!scanData) return;
  const filtered = getActiveFilteredUrls();
  const csv = toCsv(scanData, filtered);
  downloadFile(fileNameFor(scanData, "csv"), csv, "text/csv");
  showToast(filtered ? "CSV exported (filtered rows)" : "CSV exported");
}

function onExportJson() {
  if (!scanData) return;
  const filtered = getActiveFilteredUrls();
  const json = toJson(scanData, filtered);
  downloadFile(fileNameFor(scanData, "json"), json, "application/json");
  showToast(filtered ? "JSON exported (filtered rows)" : "JSON exported");
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
