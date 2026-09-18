// Builds export payloads (CSV and JSON) from a scan record.

import { getCleanPageHits } from "./hits.js";

function scanDateOf(scan) {
  const stamp = Number(scan?.finishedAt || scan?.startedAt);
  const date = new Date(Number.isFinite(stamp) && stamp > 0 ? stamp : Date.now());
  return date.toISOString();
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Flatten a scan record's matches into rows:
 * Scan Date, Page, Search Term, Element, Matched Text, Context, Status
 *
 * @param {Object} scan - The scan object
 * @param {Array<string>|null} allowedUrls - Optional list of URLs if filtering is applied
 */
export function scanToRows(scan, allowedUrls = null) {
  const rows = [];
  const scanDate = scanDateOf(scan);
  const urlFilter = allowedUrls ? new Set(allowedUrls) : null;

  for (const [term, data] of Object.entries(scan.matchesByTerm || {})) {
    for (const page of data.pages) {
      if (urlFilter && !urlFilter.has(page.url)) continue;

      for (const hit of getCleanPageHits(page)) {
        rows.push({
          scanDate,
          page: page.url,
          searchTerm: term,
          element: hit.tag || hit.elementType || "text",
          matchedText: hit.matchedText || "",
          context: hit.context || "",
          status: "Needs attention",
        });
      }
    }
  }

  for (const failed of scan.failedPages || []) {
    if (urlFilter && !urlFilter.has(failed.url)) continue;

    rows.push({
      scanDate,
      page: failed.url,
      searchTerm: "",
      element: "",
      matchedText: "",
      context: failed.reason || "Could not scan",
      status: "Could not scan",
    });
  }

  return rows;
}

export function toCsv(scan, allowedUrls = null) {
  const rows = scanToRows(scan, allowedUrls);
  const header = ["Scan Date", "Page", "Search Term", "Element", "Matched Text", "Context", "Status"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.scanDate, r.page, r.searchTerm, r.element, r.matchedText, r.context, r.status]
        .map(csvEscape)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

export function toJson(scan, allowedUrls = null) {
  if (!allowedUrls) {
    return JSON.stringify(scan, null, 2);
  }

  const urlFilter = new Set(allowedUrls);
  const filteredMatches = {};
  for (const [term, data] of Object.entries(scan.matchesByTerm || {})) {
    const pages = (data.pages || [])
      .filter((p) => urlFilter.has(p.url))
      .map((p) => ({ ...p, hits: getCleanPageHits(p) }));
    if (pages.length > 0) {
      filteredMatches[term] = { pages };
    }
  }

  const filteredScan = {
    ...scan,
    matchesByTerm: filteredMatches,
    failedPages: (scan.failedPages || []).filter((f) => urlFilter.has(f.url)),
  };

  return JSON.stringify(filteredScan, null, 2);
}
