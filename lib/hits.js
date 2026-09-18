// Single source of truth for "how many matches does this scan have?".
//
// A page can report the same address both as visible text and as the href of a
// mailto:/tel: link. When both exist we only count the visible one, otherwise
// every contact block would report double. Every surface (popup, workspace,
// export, verification diff, crawl progress) must use these helpers so the
// numbers agree.

function isHrefOnlyHit(hit) {
  if (!hit) return false;
  if (hit.matchSource === "mailto" || hit.matchSource === "tel") return true;
  const ctx = (hit.context || "").toLowerCase();
  return ctx.startsWith("mailto:") || ctx.startsWith("tel:");
}

/**
 * Hits for one { url, hits } page entry, with href-only duplicates dropped
 * when the same page also has a visible-text hit.
 */
export function getCleanPageHits(page) {
  if (!page || !Array.isArray(page.hits)) return [];
  const hits = page.hits;
  const hasVisible = hits.some((h) => !isHrefOnlyHit(h));
  if (!hasVisible) return hits;
  return hits.filter((h) => !isHrefOnlyHit(h));
}

/** Total match count for a whole scan record. */
export function countScanMatches(scan) {
  return Object.values(scan?.matchesByTerm || {}).reduce(
    (sum, data) => sum + (data.pages || []).reduce((pSum, p) => pSum + getCleanPageHits(p).length, 0),
    0
  );
}

/** Total match count for a single term within a scan record. */
export function countTermMatches(scan, term) {
  return (scan?.matchesByTerm?.[term]?.pages || []).reduce(
    (sum, p) => sum + getCleanPageHits(p).length,
    0
  );
}

/** Match count for one term on one page. */
export function countTermMatchesOnPage(scan, term, url) {
  const page = (scan?.matchesByTerm?.[term]?.pages || []).find((p) => p.url === url);
  return getCleanPageHits(page).length;
}

/** Set of URLs that have at least one counted match. */
export function affectedUrls(scan) {
  const urls = new Set();
  Object.values(scan?.matchesByTerm || {}).forEach((data) => {
    (data.pages || []).forEach((p) => {
      if (getCleanPageHits(p).length > 0) urls.add(p.url);
    });
  });
  return urls;
}
