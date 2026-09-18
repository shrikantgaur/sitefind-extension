// Normalization helpers used for deduplication and matching.

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "_ga", "_gl", "msclkid",
  "twclid", "yclid", "wickedid", "igshid"
]);

/**
 * Normalize a URL for crawl deduplication:
 * - lowercases scheme + host
 * - strips the fragment (#...)
 * - strips known tracking params
 * - sorts remaining query params for stable comparison
 * - removes trailing slash on the path (except root '/')
 */
export function normalizeUrl(rawUrl, baseUrl) {
  let u;
  try {
    u = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();

  const params = new URLSearchParams(u.search);
  const kept = [];
  for (const [k, v] of params.entries()) {
    if (TRACKING_PARAMS.has(k.toLowerCase())) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  u.search = kept.length ? "?" + kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";

  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  u.pathname = path || "/";

  return u.toString();
}

export function isSameSite(url, siteOrigin) {
  try {
    const a = new URL(url);
    const b = new URL(siteOrigin);
    return a.hostname.toLowerCase() === b.hostname.toLowerCase();
  } catch {
    return false;
  }
}

const EXPLOSIVE_PARAMS = new Set([
  "date", "from_date", "to_date", "month", "day", "year",
  "cal", "calendar", "page", "p", "paged", "offset",
  "sort", "sort_by", "order", "orderby", "filter", "filters",
  "view", "start", "end", "limit", "per_page",
]);

/**
 * Heuristic: check if URL likely explodes into infinite variants
 * (calendars, faceted search loops, pagination depth traps).
 */
export function looksExplosive(url) {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.keys()].map((k) => k.toLowerCase());
    // Exact keys only. Substring matching here used to flag "p" inside
    // "product" or "type", which made almost every URL look explosive.
    const hasExplosiveParam = params.some((k) => EXPLOSIVE_PARAMS.has(k));
    const hasManyParams = params.length >= 4;
    return hasExplosiveParam || hasManyParams;
  } catch {
    return false;
  }
}

/**
 * Decode common HTML entities to literal characters before matching.
 */
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Normalize whitespace by collapsing multiple space/newline/tab sequences into single spaces.
 */
export function normalizeWhitespace(str) {
  return (str || "").replace(/\s+/g, " ").trim();
}

/**
 * Normalize an email address for comparison (lower-case, trim, strip trailing punctuation).
 */
export function normalizeEmail(str) {
  if (!str) return "";
  let clean = decodeHtmlEntities(str).trim().toLowerCase();
  clean = clean.replace(/[.,;:]+$/, "");
  return clean;
}

/**
 * Normalize phone numbers to a digit-only comparable form.
 * Strips formatting punctuation and normalizes 11-digit numbers starting with 1
 * so +1 (800) 123-4567, 1-800-123-4567, and (800) 123-4567 all compare equal.
 */
export function normalizePhone(str) {
  if (!str) return "";
  const trimmed = decodeHtmlEntities(str).trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Check if a string plausibly represents a phone number.
 */
export function looksLikePhone(str) {
  if (!str) return false;
  const digits = str.replace(/[^\d]/g, "");
  return digits.length >= 7 && digits.length <= 15;
}
