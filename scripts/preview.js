#!/usr/bin/env node
// Dev-only: renders the real popup markup + JS against a stubbed chrome API so
// the UI can be screenshotted outside the extension. Never shipped.
//
//   node scripts/preview.js [setup|results|progress|history]
//   → preview.local.html   (gitignored, excluded from the build allowlist)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const view = process.argv[2] || "setup";

const scan = {
  id: "scan_preview",
  site: "https://northwind-supply.com",
  startedAt: Date.now() - 42000,
  finishedAt: Date.now(),
  scope: "entire_site",
  maxPages: 500,
  terms: ["hello@oldbrand.com", "+1 (415) 555-0132", "Oldbrand Inc."],
  pagesDiscovered: 128,
  pagesScanned: 118,
  pagesFailed: 2,
  status: "Needs Attention",
  allScannedUrls: [
    "https://northwind-supply.com/contact",
    "https://northwind-supply.com/about",
    "https://northwind-supply.com/pricing",
    "https://northwind-supply.com/support/returns",
  ],
  failedPages: [
    { url: "https://northwind-supply.com/legacy/portal", reason: "Blocked (403 Forbidden)" },
    { url: "https://northwind-supply.com/tmp/old", reason: "Not found (404)" },
  ],
  matchesByTerm: {
    "hello@oldbrand.com": {
      pages: [
        {
          url: "https://northwind-supply.com/contact",
          hits: [
            { matchedText: "hello@oldbrand.com", context: "Questions? Write to hello@oldbrand.com and our team will reply within one business day.", tag: "paragraph", matchSource: "visible_text", occurrenceIndex: 1 },
            { matchedText: "hello@oldbrand.com", context: "Support: hello@oldbrand.com · Sales: sales@northwind-supply.com", tag: "footer text", matchSource: "visible_text", occurrenceIndex: 2 },
          ],
        },
        {
          url: "https://northwind-supply.com/support/returns",
          hits: [{ matchedText: "hello@oldbrand.com", context: "Send your return label request to hello@oldbrand.com before shipping the item back.", tag: "list item", matchSource: "visible_text", occurrenceIndex: 1 }],
        },
      ],
    },
    "+1 (415) 555-0132": {
      pages: [
        {
          url: "https://northwind-supply.com/about",
          hits: [{ matchedText: "(415) 555-0132", context: "Head office · 400 Market Street · (415) 555-0132", tag: "paragraph", matchSource: "visible_text", occurrenceIndex: 1 }],
        },
      ],
    },
    "Oldbrand Inc.": {
      pages: [
        {
          url: "https://northwind-supply.com/pricing",
          hits: [{ matchedText: "Oldbrand Inc.", context: "All plans are billed by Oldbrand Inc. and renew automatically each month.", tag: "table cell", matchSource: "visible_text", occurrenceIndex: 1 }],
        },
      ],
    },
  },
};

const store = {
  sitefind_history: [scan],
  sitefind_draft_state: {
    terms: view === "setup" ? ["hello@oldbrand.com", "+1 (415) 555-0132"] : scan.terms,
    scope: "entire_site",
    maxPages: "500",
  },
  sitefind_onboarding_dismissed: view !== "setup",
  ...(view === "results" ? { sitefind_active_view_state: { view: "results", scanId: scan.id } } : {}),
  ...(view === "progress"
    ? {
        sitefind_active_scan: {
          crawlId: "crawl_preview",
          origin: scan.site,
          status: "running",
          updatedAt: Date.now(),
          maxPages: 500,
          discovered: 128,
          scanned: 74,
          currentUrl: "https://northwind-supply.com/support/returns",
          elementsChecked: 8421,
          failedCount: 2,
          matchesCount: 5,
          queueLength: 54,
          scan: null,
        },
      }
    : {}),
};

const stub = `
<script>
  const __store = ${JSON.stringify(store)};
  const __suggestions = { emails: ["hello@oldbrand.com", "support@northwind-supply.com"], phones: ["(415) 555-0132"] };
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === "DETECT_SUGGESTIONS") return { ok: true, suggestions: __suggestions };
        if (msg.type === "GET_CRAWL_STATE") return { ok: true, state: __store.sitefind_active_scan };
        return { ok: true };
      },
      lastError: null,
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://northwind-supply.com/contact", windowId: 1 }],
      create: async () => ({ id: 2 }),
    },
    storage: {
      local: {
        get: async (key) => (typeof key === "string" ? { [key]: __store[key] } : { ...__store }),
        set: async (obj) => Object.assign(__store, obj),
        remove: async (key) => { delete __store[key]; },
      },
    },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { executeScript: async () => [{ result: null }] },
  };
<\/script>
`;

const html = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8")
  .replace('<script type="module" src="popup.js"></script>', `${stub}<script type="module" src="popup.js"><\/script>`);

fs.writeFileSync(path.join(ROOT, "preview.local.html"), html);
console.log(`preview.local.html written for view: ${view}`);
