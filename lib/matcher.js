import { normalizeEmail, normalizePhone, looksLikePhone, decodeHtmlEntities, normalizeWhitespace } from "./normalize.js";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?\d[\d\-.\s()]{6,18}\d)/g;

/**
 * Classify a raw search term the user typed:
 * "email" | "phone" | "custom"
 */
export function classifyTerm(raw) {
  const term = decodeHtmlEntities(raw).trim();
  if (!term) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(term)) {
    return { type: "email", raw, clean: term, value: normalizeEmail(term) };
  }
  if (looksLikePhone(term) && /^[+\d][\d\-.\s()]*$/.test(term)) {
    return { type: "phone", raw, clean: term, value: normalizePhone(term) };
  }
  return { type: "custom", raw, clean: term, value: term.toLowerCase() };
}

export function classifyTerms(rawTerms) {
  return (rawTerms || [])
    .map((t) => classifyTerm(t))
    .filter((t) => t && t.value);
}

function contextAround(text, index, len, radius = 60) {
  if (!text) return "";
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + len + radius);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

/**
 * Scan a text string against a classified term.
 * Returns array of { matchedText, context, index }
 */
export function findMatchesInString(term, rawString) {
  if (!rawString || typeof rawString !== "string") return [];
  const text = decodeHtmlEntities(rawString);
  const hits = [];

  if (term.type === "custom") {
    // Check both exact casing and case-insensitive
    const hay = text.toLowerCase();
    const needle = term.value;
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      const matched = text.substr(idx, term.clean.length);
      hits.push({
        matchedText: matched,
        context: contextAround(text, idx, term.clean.length),
        index: idx,
      });
      idx = hay.indexOf(needle, idx + needle.length);
    }
  } else if (term.type === "email") {
    EMAIL_RE.lastIndex = 0;
    let m;
    while ((m = EMAIL_RE.exec(text))) {
      if (normalizeEmail(m[0]) === term.value) {
        hits.push({
          matchedText: m[0],
          context: contextAround(text, m.index, m[0].length),
          index: m.index,
        });
      }
    }
  } else if (term.type === "phone") {
    PHONE_RE.lastIndex = 0;
    let m;
    while ((m = PHONE_RE.exec(text))) {
      const digits = m[0].replace(/[^\d]/g, "");
      if (digits.length < 7) continue;
      if (normalizePhone(m[0]) === term.value) {
        hits.push({
          matchedText: m[0],
          context: contextAround(text, m.index, m[0].length),
          index: m.index,
        });
      }
    }
  }

  return hits;
}

/**
 * Scan a page's extracted content items against classified terms.
 * page shape:
 * {
 *   url: string,
 *   title: string,
 *   metaDescription: string,
 *   items: Array<{
 *     text: string,
 *     tag: string,
 *     elementType: string,
 *     matchSource: string,
 *     selector: string,
 *     href?: string
 *   }>,
 *   mailtoHrefs?: string[],
 *   telHrefs?: string[]
 * }
 *
 * Returns: { [termRaw]: Array<MatchMetadata> }
 */
export function scanPage(page, terms) {
  if (!page) return {};
  const results = {};
  const pageUrl = page.url || "";
  let occurrenceCounter = {};

  for (const term of terms) {
    results[term.raw] = [];
    occurrenceCounter[term.raw] = 0;
    const seenOnPage = new Set();

    function addHit(hitObj) {
      const cleanMatch = (hitObj.matchedText || "").trim().toLowerCase();
      const normCtx = (hitObj.context || "").replace(/\s+/g, " ").trim().toLowerCase();
      // Keyed by term, matched text, selector, and context
      const key = `${term.raw}:::${cleanMatch}:::${hitObj.selector || ""}:::${normCtx.slice(0, 50)}`;
      const altKey = `${term.raw}:::${cleanMatch}:::${normCtx.slice(0, 50)}`;

      if (seenOnPage.has(key) || (normCtx.length > 5 && seenOnPage.has(altKey))) {
        return;
      }
      seenOnPage.add(key);
      if (normCtx.length > 5) seenOnPage.add(altKey);

      occurrenceCounter[term.raw] += 1;
      hitObj.occurrenceIndex = occurrenceCounter[term.raw];
      results[term.raw].push(hitObj);
    }

    // 1. Scan structured extracted items (headings, paragraphs, inputs, buttons, etc.)
    if (Array.isArray(page.items)) {
      for (const item of page.items) {
        let matchedInText = false;
        // Match against item visible or attribute text
        if (item.text) {
          const stringHits = findMatchesInString(term, item.text);
          if (stringHits.length > 0) {
            matchedInText = true;
            for (const hit of stringHits) {
              addHit({
                pageUrl,
                term: term.raw,
                normalizedTerm: term.value,
                matchedText: hit.matchedText,
                tag: item.tag || "div",
                elementType: item.elementType || "visible text",
                context: hit.context,
                matchSource: item.matchSource || "visible_text",
                selector: item.selector || "",
              });
            }
          }
        }

        // Match against item href if link (only if visible text did not already match)
        if (item.href && !matchedInText) {
          if (term.type === "email" && item.href.toLowerCase().startsWith("mailto:")) {
            const addr = item.href.replace(/^mailto:/i, "").split("?")[0];
            if (normalizeEmail(decodeURIComponent(addr)) === term.value) {
              const alreadyHasVisibleMatch = results[term.raw].some((m) =>
                normalizeEmail(m.matchedText) === term.value
              );
              if (!alreadyHasVisibleMatch) {
                addHit({
                  pageUrl,
                  term: term.raw,
                  normalizedTerm: term.value,
                  matchedText: addr,
                  tag: item.tag || "a",
                  elementType: "link (mailto)",
                  context: item.href,
                  matchSource: "mailto",
                  selector: item.selector || "a",
                });
              }
            }
          } else if (term.type === "phone" && item.href.toLowerCase().startsWith("tel:")) {
            const num = item.href.replace(/^tel:/i, "");
            if (normalizePhone(decodeURIComponent(num)) === term.value) {
              const alreadyHasVisibleMatch = results[term.raw].some((m) =>
                normalizePhone(m.matchedText) === term.value
              );
              if (!alreadyHasVisibleMatch) {
                addHit({
                  pageUrl,
                  term: term.raw,
                  normalizedTerm: term.value,
                  matchedText: num,
                  tag: item.tag || "a",
                  elementType: "link (tel)",
                  context: item.href,
                  matchSource: "tel",
                  selector: item.selector || "a",
                });
              }
            }
          } else if (term.type === "custom") {
            const hrefHits = findMatchesInString(term, item.href);
            for (const hit of hrefHits) {
              addHit({
                pageUrl,
                term: term.raw,
                normalizedTerm: term.value,
                matchedText: hit.matchedText,
                tag: item.tag || "a",
                elementType: "link (href)",
                context: hit.context,
                matchSource: "href",
                selector: item.selector || "a",
              });
            }
          }
        }
      }
    }

    // 2. Scan title
    if (page.title) {
      const titleHits = findMatchesInString(term, page.title);
      for (const hit of titleHits) {
        addHit({
          pageUrl,
          term: term.raw,
          normalizedTerm: term.value,
          matchedText: hit.matchedText,
          tag: "title",
          elementType: "page title",
          context: hit.context,
          matchSource: "title",
          selector: "title",
        });
      }
    }

    // 3. Scan meta description
    if (page.metaDescription) {
      const metaHits = findMatchesInString(term, page.metaDescription);
      for (const hit of metaHits) {
        addHit({
          pageUrl,
          term: term.raw,
          normalizedTerm: term.value,
          matchedText: hit.matchedText,
          tag: "meta",
          elementType: "meta description",
          context: hit.context,
          matchSource: "meta",
          selector: 'meta[name="description"]',
        });
      }
    }

    // 4. Fallback text scanning if page.items wasn't populated (e.g. basic crawl)
    if ((!page.items || page.items.length === 0) && page.text) {
      const fallbackHits = findMatchesInString(term, page.text);
      for (const hit of fallbackHits) {
        addHit({
          pageUrl,
          term: term.raw,
          normalizedTerm: term.value,
          matchedText: hit.matchedText,
          tag: "body",
          elementType: "fallback body text",
          context: hit.context,
          matchSource: "fallback_crawl",
          selector: "body",
        });
      }
    }

    // 5. Fallback mailto/tel hrefs (only if email/phone was not already matched in visible text on this page)
    if (term.type === "email" && Array.isArray(page.mailtoHrefs)) {
      const alreadyHasVisibleMatch = results[term.raw].some((m) =>
        normalizeEmail(m.matchedText) === term.value
      );
      if (!alreadyHasVisibleMatch) {
        for (const href of page.mailtoHrefs) {
          const addr = href.replace(/^mailto:/i, "").split("?")[0];
          if (normalizeEmail(decodeURIComponent(addr)) === term.value) {
            // Avoid duplicate if already found in items
            const exists = results[term.raw].some((m) => m.context === href || m.matchedText === addr);
            if (!exists) {
              occurrenceCounter[term.raw] += 1;
              results[term.raw].push({
                pageUrl,
                term: term.raw,
                normalizedTerm: term.value,
                matchedText: addr,
                tag: "a",
                elementType: "link (mailto)",
                context: href,
                occurrenceIndex: occurrenceCounter[term.raw],
                matchSource: "mailto",
                selector: `a[href*="${addr}"]`,
              });
            }
          }
        }
      }
    }

    if (term.type === "phone" && Array.isArray(page.telHrefs)) {
      const alreadyHasVisibleMatch = results[term.raw].some((m) =>
        normalizePhone(m.matchedText) === term.value
      );
      if (!alreadyHasVisibleMatch) {
        for (const href of page.telHrefs) {
          const num = href.replace(/^tel:/i, "");
          if (normalizePhone(decodeURIComponent(num)) === term.value) {
            const exists = results[term.raw].some((m) => m.context === href || m.matchedText === num);
            if (!exists) {
              occurrenceCounter[term.raw] += 1;
              results[term.raw].push({
                pageUrl,
                term: term.raw,
                normalizedTerm: term.value,
                matchedText: num,
                tag: "a",
                elementType: "link (tel)",
                context: href,
                occurrenceIndex: occurrenceCounter[term.raw],
                matchSource: "tel",
                selector: `a[href*="${num}"]`,
              });
            }
          }
        }
      }
    }

    // Clean up empty terms
    if (results[term.raw].length === 0) {
      delete results[term.raw];
    }
  }

  return results;
}
