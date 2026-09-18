# StaleCheck — Audit Remediation Tasks

Source: code audit of 2026-09-18. Status legend: [ ] todo · [x] done

## Blocking
- [x] T1  results.js:405 `scan.terms` ReferenceError breaks Open & Highlight
- [x] T2  Dead service worker leaves persisted crawl stuck in `running` forever
- [x] T3  Stopping a crawl writes two history records (stop + final)

## High
- [x] T4  openAndHighlight falls back to any same-origin tab → highlights wrong page
- [x] T5  404s counted as successfully scanned pages
- [x] T6  Match counts disagree across popup / workspace / CSV / diff
- [x] T7  Verify Again from History re-scans the active tab, not the scanned page
- [x] T8  results.js Verify never requests host permission; ignores current_page scope

## Medium
- [x] T9  storage.local quota unguarded; saveScan rejection loses the scan
- [x] T10 Crawl concurrency collapses to a single worker
- [x] T11 Nested elements double-count matches on crawled pages
- [x] T12 Highlighter leaks a keydown listener per injection
- [x] T13 revealElement clicks arbitrary page buttons/links
- [x] T14 looksExplosive treats nearly every URL as explosive ("p" substring)
- [x] T15 minimum_chrome_version 116 vs chrome.action.openPopup (127)

## Low
- [x] T16 clearTermsBtn bound twice
- [x] T17 Floating widget leaks a <style> element per injection
- [x] T18 startCrawl has no .catch on seedFromSitemaps
- [x] T19 Filtered export only covers the visible pagination page
- [x] T20 highlightSnippet misses matches containing & < > ' "
- [x] T21 Popup auto-injects content.js on every open
- [x] T22 `tabs` permission is broader than needed

## Release
- [x] T23 .gitignore + packaging script producing a store-ready zip (no .DS_Store/test/.agents)
- [x] T24 Regression tests for the fixed logic; full suite green

All tasks completed 2026-09-18. `npm test` green (6 suites), `npm run build`
produces dist/stalecheck-1.0.0.zip.

Known limitation (by design, not a defect): verifying a `current_page` scan for
a page that is not in the active tab requires host access for that origin. If it
has not been granted, StaleCheck asks the user to open the page instead of
verifying a different one.

## UI / UX pass (2026-09-18)
- [x] U1  First-run onboarding card (3 steps), dismissed permanently after "Got it"
- [x] U2  Primary button states what it will do: "Scan this page · 2 terms"; disabled with 0 terms
- [x] U3  Enter scans, Shift+Enter adds a term; "/" focuses results search, Esc goes back / clears
- [x] U4  Live term-type badge per input (Email / Phone / Text) + duplicate warning
- [x] U5  Sticky primary action and results action bar — CTA no longer below the fold
- [x] U6  Toast feedback for exports, copies and suggestion adds
- [x] U7  Copy page URL per row, Copy URLs for the whole filtered set, Copy match in workspace
- [x] U8  Elapsed timer + "Stopping…" state during scans; live regions for screen readers
- [x] U9  Actionable empty states ("Nothing stale found 🎉" vs filtered-out vs no scan yet)
- [x] U10 Sticky workspace filter bar, arrow-key pagination, hover rows
- [x] U11 Dark mode across popup and workspace; neutral suggestions panel; focus-visible rings
- [x] U12 Result count line ("12 matches on 4 pages"), wider action column

## Professional redesign (2026-09-18)
- [x] D1  Single design system: tokens for colour, type scale, spacing, radius, focus — shared by popup and workspace
- [x] D2  Popup rebuilt on component classes (btn/input/select/chip/panel/option/badge/segmented/empty/toast); no inline styles
- [x] D3  Popup resized 560x600 → 420x580 (standard extension width); scroll body + fixed action bar
- [x] D4  Results table in popup replaced by readable match cards (page · term · context · actions)
- [x] D5  Workspace stylesheet rewritten on the same tokens (header, metrics, toolbar, table, drawer, pagination)
- [x] D6  In-page HUD and floating widget restyled to the same palette; gradients/pulse/emoji removed
- [x] D7  Indigo accent replaces mixed blue/orange/green accents; semantic colour reserved for status
- [x] D8  scripts/preview.js — dev-only harness that renders the popup with stubbed chrome APIs
