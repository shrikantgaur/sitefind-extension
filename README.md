# SiteFind — Ctrl+F for Your Entire Website

A Manifest V3 Chrome extension (by [Shri Kant](https://github.com/shrikantgaur)) that finds outdated text, emails, phone numbers, or any custom text still present anywhere on a website after a rebrand or update — and lets you re-verify once you've fixed it.

## Key Features

- **Domain Auto-Detect & Term Suggestions**: Detects the active website, and — when you click **Detect from this page** — extracts emails & phone numbers as one-click suggestions. The page is only read when you ask for it.
- **Dynamic Search Term Inputs**: Add and remove multiple terms freely with Clear All and Quick Add presets (`Email`, `Phone`, `Domain`, `Company`, `Address`, `Custom`). Draft terms persist across popup closes.
- **High-Coverage Search Engine**: Scans visible text, headings, paragraphs, lists, tables, buttons, form values, placeholders, aria-labels, alt text, link text, and `mailto:` / `tel:` hrefs.
- **Live Background Scanning**: Crawl continues seamlessly even if the popup is closed. Reopening the popup re-attaches to live progress.
- **Page-Centric Dynamic Table**: Dynamic column per search term (`Page | Email | Phone | Total | Actions`). Affected Only vs All Scanned toggle, text filter, and expandable row details.
- **Open & Highlight**: Click any match to open or focus the target tab, scroll smoothly to the element, and navigate matches with the floating **SiteFind Match Navigator HUD** (`Match 1 of 4`, Next, Prev, Highlight All).
- **Dedicated Full Results Workspace**: Click `Full Results ↗` to open a dedicated full-tab dashboard (`results.html`) with wide multi-column layout, metrics cards, search/filter, and pagination (25 / 50 / 100 rows per page).
- **Verify Again Comparison**: Re-runs scan and displays a before-and-after diff tracking `Removed ✓`, `Remaining ⚠`, and `New ⚠` matches without losing scan history.
- **Filter-Aware Export**: Export all or currently filtered results to standard CSV or structured JSON.
- **Keyboard-First & Themed**: `Enter` scans, `Shift+Enter` adds a term, `/` focuses search, `Esc` goes back; arrow keys page through the workspace. Light and dark themes follow your system setting.

## Install (Load Unpacked)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select this project directory.
4. Pin the **SiteFind** icon from the Chrome extensions toolbar.

## Architecture

```
manifest.json          Manifest V3 config (storage, activeTab, scripting, offscreen)
popup.html/css/js      Lightweight popup UI: setup, suggestions, progress, compact results
results.html/css/js    Dedicated Full Results Workspace with pagination & wide table
background.js          Service worker: BFS crawler, sitemaps, active scan persistence
content.js             Injected content script: high-coverage DOM extraction & suggestions
offscreen.html/js      Offscreen document for DOMParser-based HTML/XML parsing
lib/normalize.js       URL, email, phone normalization, HTML entity decoder
lib/matcher.js         Term classifier & content matcher with rich metadata
lib/hits.js            Shared match counting used by every surface (UI, export, diff)
lib/storage.js         Local storage (chrome.storage.local) for history, active scan & drafts
lib/highlighter.js     In-page match highlighter & floating HUD navigator
lib/export.js          Filter-aware CSV & JSON builders
scripts/build.js       Validates the extension and builds the Web Store zip
test/run_tests.js      Unit & integration tests (no dependencies)
```

## Development

```bash
npm test     # unit & integration tests
npm run build # validates, stages dist/sitefind-extension and writes dist/sitefind-<version>.zip
```

`npm run build` ships only the files the extension needs — tests, planning notes,
build scripts and OS artefacts never reach the package. It fails the build if a
shipped page or module references a file that would not be included.

Requires Chrome 127+ (`chrome.action.openPopup`, used by the in-page HUD).

## Privacy

- **100% Local-First**: No remote backend, zero analytics, zero external network calls.
- **Client-Side Storage**: All scan configurations and results reside strictly in `chrome.storage.local`.
- **Minimum Permissions**: `activeTab` for the current page; per-site host access requested only when crawling an entire domain. No `tabs` permission, so SiteFind cannot see the URLs of tabs you have not granted it access to.
