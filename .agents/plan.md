# StaleCheck — Implementation Plan

## Repo state
Fresh project, no existing conventions. Starting from scratch per spec.

## Architecture decision
Spec suggests a React UI, but also mandates "keep dependencies minimal",
"no unnecessary dependencies", and YAGNI. A popup this size (one form, one
results list, one history list) does not need a build step or a UI
framework. Building it as vanilla HTML/CSS/JS with small, focused modules
gets the same result with zero build tooling, zero bundle-size risk, and
no supply-chain surface — which better serves the stated "trustworthy,
lightweight" goal than pulling in React. Documented here as a deliberate
deviation from the "React UI" line in Technical Direction.

MV3 service workers have no DOM (no DOMParser/document), so the crawler
cannot parse fetched HTML in the background script directly. Using
`chrome.offscreen` (an offscreen document with real DOM APIs) to parse
fetched HTML strings — extract `<a>` links, visible text, meta tags,
mailto:/tel: hrefs — without ever opening a visible tab per crawled page.
This is the standard MV3-compatible way to do this kind of work.

## Permissions strategy (privacy-first, minimum necessary)
- `storage` — scan history persistence (local only).
- `activeTab` + `scripting` — current-page scan: inject a content script
  into the tab the user is already looking at, only when they click Scan.
- `offscreen` — DOM parsing for the crawler.
- Host permissions are **not** requested up front. `optional_host_permissions`
  for `http://*/*` and `https://*/*` are declared, and the extension calls
  `chrome.permissions.request` for the *specific origin* only when the user
  picks "Entire website" and clicks Scan. The popup explains why before
  asking. Current-page-only users never see a host permission prompt.

## Modules
- `lib/normalize.js` — URL normalization (strip fragment/tracking noise,
  canonical form for dedup), phone normalization, email normalization.
- `lib/matcher.js` — term classification (email/phone/custom) + match
  finding with context snippets, over text/html/mailto/tel/attributes/meta.
- `lib/storage.js` — chrome.storage.local read/write for scan history,
  with a cap on stored size (no raw page HTML kept, only findings).
- `lib/export.js` — CSV/JSON export builders.
- `content.js` — current-page scan: reads DOM, returns matches.
- `offscreen.js` — parses a fetched HTML string into links/text/meta for
  the crawler, on request from the background worker.
- `background.js` — service worker: message router, BFS crawler
  (queue, dedupe, robots-friendly pacing, redirect/error handling,
  sitemap.xml discovery), orchestrates offscreen parsing, persists results.
- `popup.html/css/js` — UI: search terms, scope picker, live progress,
  results grouped by term, history list, verify-again, export buttons.

## Risks identified
1. **CORS/network errors on crawled pages** (3rd-party blocks, CSP on the
   *extension's* fetch is not an issue since fetch from a service worker is
   not subject to the page's CSP, but the *target site* may 403/429/timeout
   or require auth) → must be classified as "Could not scan", never "clean".
2. **Infinite/explosive URL spaces** (calendars, faceted filters, session
   params) → normalize query strings, cap crawl to `maxPages`, cap queue
   size, dedupe by normalized URL, drop obvious calendar/pagination patterns
   only as a soft de-prioritization, not a hard content filter (avoid false
   "clean" reports).
3. **Redirect loops** → track visited + a max-redirect-hops guard via
   `fetch(..., {redirect: "follow"})` and dedupe on final normalized URL.
4. **Service worker lifecycle** (MV3 workers can be killed) → persist crawl
   progress/state to `chrome.storage.session` (or local) so a resumed worker
   can continue reporting to an open popup, and finalize partial results
   gracefully if the popup is reopened mid-crawl.
5. **Offscreen document singleton** — Chrome allows only one offscreen
   document at a time; guard creation with an existence check.
6. **Rate limiting target sites** — small concurrency (e.g. 4 in flight),
   short per-request timeout, so we don't hammer the site being audited.

## Build order (per spec)
1. Extension shell + popup UI (static, no logic)
2. Current-page custom search (content script + matcher)
3. Results rendering
4. Same-domain crawler (background + offscreen)
5. Sitemap discovery + URL normalization
6. Live progress messaging
7. History (chrome.storage.local)
8. Verify Again + comparison view
9. CSV/JSON export
10. Edge cases, empty/error states, a11y, polish
