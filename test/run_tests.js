import assert from "node:assert";
import { normalizeUrl, isSameSite, looksExplosive, decodeHtmlEntities, normalizeWhitespace, normalizeEmail, normalizePhone, looksLikePhone } from "../lib/normalize.js";
import { classifyTerm, classifyTerms, findMatchesInString, scanPage } from "../lib/matcher.js";
import { toCsv, toJson } from "../lib/export.js";
import { getCleanPageHits, countScanMatches, countTermMatches, affectedUrls } from "../lib/hits.js";

console.log("Starting SiteFind Unit & Integration Tests...\n");

// ---------------------------------------------------------------------
// Test Normalize
// ---------------------------------------------------------------------
console.log("1. Testing Normalize Module...");
// HTML entities
assert.strictEqual(decodeHtmlEntities("&amp; &lt; &gt; &quot; &#39;"), "& < > \" '");
assert.strictEqual(decodeHtmlEntities("hello&#64;world.com"), "hello@world.com");

// Whitespace
assert.strictEqual(normalizeWhitespace("  hello   world \n\t foo "), "hello world foo");

// Emails
assert.strictEqual(normalizeEmail(" John.Doe@Example.COM. "), "john.doe@example.com");

// Phones
assert.strictEqual(normalizePhone("+1 (800) 123-4567"), "8001234567");
assert.strictEqual(normalizePhone("1-800-123-4567"), "8001234567");
assert.strictEqual(normalizePhone("(800) 123-4567"), "8001234567");
assert.strictEqual(normalizePhone("800.123.4567"), "8001234567");
assert.strictEqual(looksLikePhone("800-123-4567"), true);
assert.strictEqual(looksLikePhone("2024"), false);

// URLs
const rawUrl = "https://example.com/about/?utm_source=google&b=2&a=1#section";
const normUrl = normalizeUrl(rawUrl, "https://example.com");
assert.strictEqual(normUrl, "https://example.com/about?a=1&b=2");
assert.strictEqual(isSameSite("https://example.com/page", "https://example.com"), true);
assert.strictEqual(isSameSite("https://other.com", "https://example.com"), false);
assert.strictEqual(looksExplosive("https://example.com/events?date=2024-01-01"), true);
assert.strictEqual(looksExplosive("https://example.com/about"), false);

console.log("✓ Normalize tests passed!");

// ---------------------------------------------------------------------
// Test Matcher
// ---------------------------------------------------------------------
console.log("\n2. Testing Matcher Module...");
const classified = classifyTerms(["old@company.com", "+1 800 123 4567", "Old Brand Name"]);
assert.strictEqual(classified.length, 3);
assert.strictEqual(classified[0].type, "email");
assert.strictEqual(classified[1].type, "phone");
assert.strictEqual(classified[2].type, "custom");

// String matching
const strHits = findMatchesInString(classified[0], "Contact us at old@company.com or sales@company.com");
assert.strictEqual(strHits.length, 1);
assert.strictEqual(strHits[0].matchedText, "old@company.com");

const phoneHits = findMatchesInString(classified[1], "Call 1-800-123-4567 today!");
assert.strictEqual(phoneHits.length, 1);

// Page scanning with rich metadata
const mockPage = {
  url: "https://example.com/contact",
  title: "Contact Us - Old Brand Name",
  metaDescription: "Email old@company.com for inquiries",
  items: [
    {
      text: "Customer Support: old@company.com",
      tag: "p",
      elementType: "paragraph",
      matchSource: "visible_text",
      selector: "body > p",
    },
    {
      text: "Call us",
      href: "tel:+18001234567",
      tag: "a",
      elementType: "link",
      matchSource: "visible_text",
      selector: "body > a",
    },
    {
      text: "Enter your phone like 1-800-123-4567",
      tag: "input",
      elementType: "attribute (placeholder)",
      matchSource: "attribute_placeholder",
      selector: "#phone-input",
    }
  ],
  mailtoHrefs: ["mailto:old@company.com"],
  telHrefs: ["tel:+18001234567"],
};

const scanResults = scanPage(mockPage, classified);
assert(scanResults["old@company.com"].length >= 2, "Should find email in title/meta/items");
assert(scanResults["+1 800 123 4567"].length >= 2, "Should find phone in items and tel href");
assert(scanResults["Old Brand Name"].length >= 1, "Should find brand name in title");

const firstHit = scanResults["old@company.com"][0];
assert.strictEqual(firstHit.pageUrl, "https://example.com/contact");
assert.strictEqual(firstHit.term, "old@company.com");
assert(firstHit.context.length > 0);
assert(firstHit.tag);
assert(firstHit.elementType);
assert(firstHit.occurrenceIndex >= 1);

console.log("✓ Matcher tests passed!");

// ---------------------------------------------------------------------
// Test Export
// ---------------------------------------------------------------------
console.log("\n3. Testing Export Module...");
const mockScan = {
  id: "scan_123",
  site: "https://example.com",
  startedAt: 1710000000000,
  finishedAt: 1710000010000,
  scope: "entire_site",
  maxPages: 500,
  terms: ["old@company.com"],
  pagesDiscovered: 2,
  pagesScanned: 2,
  pagesFailed: 0,
  matchesByTerm: {
    "old@company.com": {
      pages: [
        {
          url: "https://example.com/contact",
          hits: [
            {
              tag: "p",
              elementType: "paragraph",
              matchedText: "old@company.com",
              context: "Contact us at old@company.com",
            }
          ]
        }
      ]
    }
  },
  failedPages: [],
  allScannedUrls: ["https://example.com", "https://example.com/contact"],
};

const csv = toCsv(mockScan);
assert(csv.includes("Scan Date,Page,Search Term,Element,Matched Text,Context,Status"), "CSV has header");
assert(csv.includes("https://example.com/contact"), "CSV includes URL");
assert(csv.includes("old@company.com"), "CSV includes search term");

// Filtered export
const filteredCsv = toCsv(mockScan, ["https://example.com/non-existent"]);
assert(!filteredCsv.includes("https://example.com/contact"), "Filtered CSV excludes non-matched URLs");

const json = toJson(mockScan);
const parsedJson = JSON.parse(json);
assert.strictEqual(parsedJson.id, "scan_123");
assert.strictEqual(parsedJson.terms[0], "old@company.com");

console.log("✓ Export tests passed!");

// ---------------------------------------------------------------------
// Test Page Suggestion Extraction & Garbage Filtering
// ---------------------------------------------------------------------
console.log("\n4. Testing Suggestion Extraction & Filtering...");

const PHONE_REGEX = /(?:^|[^0-9a-zA-Z])((?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.-]?[2-9]\d{2}[\s.-]?\d{4}|\+\d{1,4}[\s.-]?(?:\(?\d{1,4}\)?[\s.-])?\d{2,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?)(?=[^0-9a-zA-Z]|$)/g;

function isValidPhoneSuggestion(raw) {
  if (!raw || typeof raw !== "string") return false;
  const str = raw.trim();
  if (/[a-zA-Z]/.test(str)) return false;
  if (/\d+\.\d{1,2}(?!\d)/.test(str)) {
    if (!/^\+?1?[.]?[2-9]\d{2}[.][2-9]\d{2}[.]\d{4}$/.test(str)) return false;
  }
  if (/^(?:19|20)\d{2}[-./]\d{1,2}/.test(str)) return false;
  if (/-\d+\.\d+/.test(str) || /\d+-\d+-\d+\.\d+/.test(str)) return false;
  const digits = str.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  if (/(\d)\1{5,}/.test(digits)) return false;
  const chunks = str.split(/[\s\-().+]+/).filter(Boolean);
  if (chunks.length > 1) {
    for (const c of chunks) {
      if (c.length > 5) return false;
    }
    const singleDigits = chunks.filter((c) => c.length === 1 && /^\d$/.test(c));
    if (singleDigits.length >= 3) return false;
  }
  if (/^\d+$/.test(str)) {
    if (digits.length === 11 && digits.startsWith("1")) return true;
    if (digits.length === 10 && digits[0] >= "2") return true;
    return false;
  }
  if (digits.length === 10) {
    if (digits[0] < "2") return false;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    if (digits[1] < "2") return false;
  }
  return true;
}

function isValidEmailSuggestion(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}$/.test(e)) return false;
  if (/\.(png|jpg|jpeg|gif|svg|webp|js|css|ico|woff|woff2)$/i.test(e)) return false;
  if (e.endsWith("@example.com") || e.endsWith("@test.com")) return false;
  return true;
}

// Valid phones
assert.strictEqual(isValidPhoneSuggestion("+1-877-958-1450"), true);
assert.strictEqual(isValidPhoneSuggestion("+1-877-958-1499"), true);
assert.strictEqual(isValidPhoneSuggestion("(877) 958-1450"), true);
assert.strictEqual(isValidPhoneSuggestion("877-958-1450"), true);
assert.strictEqual(isValidPhoneSuggestion("+44 20 7946 0958"), true);

// Garbage numbers (SVG paths, profiler memory, timestamps, dates)
assert.strictEqual(isValidPhoneSuggestion("2026.09.2"), false);
assert.strictEqual(isValidPhoneSuggestion("537898912"), false);
assert.strictEqual(isValidPhoneSuggestion("50000000"), false);
assert.strictEqual(isValidPhoneSuggestion("5.8 0 0 5.8 0 13"), false);
assert.strictEqual(isValidPhoneSuggestion("0 7.2 5.8 13 13 13"), false);
assert.strictEqual(isValidPhoneSuggestion("7.2 0 13-5.8 13-13"), false);
assert.strictEqual(isValidPhoneSuggestion("26 5.8 20.2 0 13 0"), false);
assert.strictEqual(isValidPhoneSuggestion("0.6 0-1-0.3-1-0.9"), false);
assert.strictEqual(isValidPhoneSuggestion("898912 5000"), false);

// Emails
assert.strictEqual(isValidEmailSuggestion("sales@yardsignplus.com"), true);
assert.strictEqual(isValidEmailSuggestion("support@yardsignplus.com"), true);
assert.strictEqual(isValidEmailSuggestion("logo@2x.png"), false);
assert.strictEqual(isValidEmailSuggestion("icon@test.svg"), false);

console.log("✓ Suggestion Extraction & Filtering tests passed!");

// ---------------------------------------------------------------------
// 5. Hit counting — the single source of truth every surface must agree on
// ---------------------------------------------------------------------
console.log("\n5. Testing Hit Counting (popup / workspace / export parity)...");

const contactScan = {
  terms: ["old@acme.com", "Acme Corp"],
  startedAt: 1737000000000,
  finishedAt: 1737000060000,
  site: "https://example.com",
  allScannedUrls: ["https://example.com/contact", "https://example.com/about"],
  matchesByTerm: {
    "old@acme.com": {
      pages: [
        {
          url: "https://example.com/contact",
          hits: [
            { matchedText: "old@acme.com", matchSource: "visible_text", context: "Email us at old@acme.com today" },
            { matchedText: "old@acme.com", matchSource: "mailto", context: "mailto:old@acme.com" },
          ],
        },
      ],
    },
    "Acme Corp": {
      pages: [
        {
          url: "https://example.com/about",
          hits: [{ matchedText: "Acme Corp", matchSource: "visible_text", context: "About Acme Corp" }],
        },
      ],
    },
  },
};

// The mailto duplicate of a visible match must not be counted twice.
assert.strictEqual(getCleanPageHits(contactScan.matchesByTerm["old@acme.com"].pages[0]).length, 1);
assert.strictEqual(countTermMatches(contactScan, "old@acme.com"), 1);
assert.strictEqual(countScanMatches(contactScan), 2);
assert.deepStrictEqual(
  [...affectedUrls(contactScan)].sort(),
  ["https://example.com/about", "https://example.com/contact"]
);

// A mailto-only page keeps its hit: it is the only evidence there is.
const mailtoOnly = { url: "https://example.com/x", hits: [{ matchedText: "old@acme.com", matchSource: "mailto", context: "mailto:old@acme.com" }] };
assert.strictEqual(getCleanPageHits(mailtoOnly).length, 1);

// Export rows are built from the same records the counters see.
const parityCsv = toCsv(contactScan);
assert.ok(parityCsv.includes("https://example.com/contact"));
assert.ok(parityCsv.includes("Acme Corp"));
// One CSV row per counted match: the mailto duplicate must not reappear here.
assert.strictEqual(parityCsv.trim().split("\r\n").length - 1, countScanMatches(contactScan));
// A record with no timestamps must still export instead of throwing.
assert.ok(toCsv({ terms: [], matchesByTerm: {} }).startsWith("Scan Date"));

console.log("✓ Hit counting tests passed!");

// ---------------------------------------------------------------------
// 6. Crawl-order heuristic — exact param keys only
// ---------------------------------------------------------------------
console.log("\n6. Testing Crawl Heuristics...");

// Regression: substring matching flagged "product" (contains "p") as explosive.
assert.strictEqual(looksExplosive("https://example.com/shop?product=123"), false);
assert.strictEqual(looksExplosive("https://example.com/shop?type=hat"), false);
assert.strictEqual(looksExplosive("https://example.com/vendors?vendor=acme"), false);
assert.strictEqual(looksExplosive("https://example.com/blog?page=4"), true);
assert.strictEqual(looksExplosive("https://example.com/events?date=2024-01-01"), true);
assert.strictEqual(looksExplosive("https://example.com/s?a=1&b=2&c=3&d=4"), true);

console.log("✓ Crawl heuristic tests passed!");

console.log("\n==========================================");
console.log("ALL UNIT & INTEGRATION TESTS PASSED 100%!");
console.log("==========================================\n");
