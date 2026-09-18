// Injected on demand via chrome.scripting.executeScript.
// High-coverage DOM extraction for SiteFind:
// - Visible text, headings, paragraphs, lists, tables, buttons, labels
// - Link text and hrefs (mailto, tel, http)
// - Form attributes: placeholder, value, aria-label, title, alt
// - Suggestions detector: emails and phone numbers on current page

(function extractPageContent() {
  const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}/g;
  const PHONE_REGEX = /(?:^|[^0-9a-zA-Z])((?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.-]?[2-9]\d{2}[\s.-]?\d{4}|\+\d{1,4}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?)?\d{2,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?)(?=[^0-9a-zA-Z]|$)/g;

  function isValidEmailSuggestion(email) {
    if (!email || typeof email !== "string") return false;
    const e = email.trim().toLowerCase();
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}$/.test(e)) return false;
    if (/\.(png|jpg|jpeg|gif|svg|webp|js|css|ico|woff|woff2)$/i.test(e)) return false;
    if (e.endsWith("@example.com") || e.endsWith("@test.com")) return false;
    return true;
  }

  function isValidPhoneSuggestion(raw) {
    if (!raw || typeof raw !== "string") return false;
    const str = raw.trim();

    // Reject letters (e.g. SVG path commands M, C, Z, or debug bar strings)
    if (/[a-zA-Z]/.test(str)) return false;

    // Reject decimals like 5.8, 20.2, 0.6 unless exact phone format with dots (e.g. 877.958.1450)
    if (/\d+\.\d{1,2}(?!\d)/.test(str)) {
      if (!/^\+?1?[.]?[2-9]\d{2}[.][2-9]\d{2}[.]\d{4}$/.test(str)) {
        return false;
      }
    }

    // Reject dates / versions like 2026.09.2, 2024-01-01, 2026/09/02
    if (/^(?:19|20)\d{2}[-./]\d{1,2}/.test(str)) return false;

    // Reject SVG negative coordinates like 13-5.8 or 0-1-0.3
    if (/-\d+\.\d+/.test(str) || /\d+-\d+-\d+\.\d+/.test(str)) return false;

    // Extract digits
    const digits = str.replace(/[^\d]/g, "");
    if (digits.length < 10 || digits.length > 15) return false;

    // Reject repetitive numbers like 50000000, 0000000000
    if (/(\d)\1{5,}/.test(digits)) return false;

    // Check chunking if separators exist (spaces, dashes, dots)
    const chunks = str.split(/[\s\-().+]+/).filter(Boolean);
    if (chunks.length > 1) {
      // If any chunk is longer than 5 digits, reject
      for (const c of chunks) {
        if (c.length > 5) return false;
      }
      // Single digit sequences like "5 0 0 5 0 13" in SVG
      const singleDigits = chunks.filter(c => c.length === 1 && /^\d$/.test(c));
      if (singleDigits.length >= 3) return false;
    }

    // Plain digits without grouping must be 10 digits or 11 digits starting with 1
    if (/^\d+$/.test(str)) {
      if (digits.length === 11 && digits.startsWith("1")) return true;
      if (digits.length === 10 && digits[0] >= "2") return true;
      return false;
    }

    // If US number (10 or 11 digits starting with 1), verify area code doesn't start with 0 or 1
    if (digits.length === 10) {
      if (digits[0] < "2") return false;
    } else if (digits.length === 11 && digits.startsWith("1")) {
      if (digits[1] < "2") return false;
    }

    return true;
  }

  function getUniqueSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    if (el.id) return `#${CSS.escape(el.id)}`;
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body) {
      let selector = el.tagName.toLowerCase();
      if (el.className && typeof el.className === "string") {
        const firstClass = el.className.trim().split(/\s+/)[0];
        if (firstClass && !firstClass.startsWith("sitefind")) {
          selector += `.${CSS.escape(firstClass)}`;
        }
      }
      let siblingIndex = 1;
      let sibling = el.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === el.tagName) siblingIndex++;
        sibling = sibling.previousElementSibling;
      }
      if (siblingIndex > 1) selector += `:nth-of-type(${siblingIndex})`;
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(" > ");
  }

  const CONTENT_SELECTOR =
    "h1, h2, h3, h4, h5, h6, p, li, dt, dd, td, th, caption, button, a, label, input, textarea, select, [alt], [title], [aria-label], [placeholder]";

  // Text owned by this element, excluding nested elements we extract on their
  // own. Prevents the same match being counted once per ancestor (a <p> inside
  // a <td>, an <li> inside an <li>, a link inside a paragraph).
  function ownText(el) {
    if (!el.querySelector(CONTENT_SELECTOR)) {
      return (el.innerText || el.textContent || "").trim();
    }
    const clone = el.cloneNode(true);
    clone.querySelectorAll(CONTENT_SELECTOR).forEach((child) => child.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  const items = [];
  const detectedEmails = new Set();
  const detectedPhones = new Set();
  const mailtoHrefs = [];
  const telHrefs = [];

  // Helper to harvest suggestions from any text string
  function collectSuggestions(text) {
    if (!text || typeof text !== "string") return;
    EMAIL_REGEX.lastIndex = 0;
    let m;
    while ((m = EMAIL_REGEX.exec(text))) {
      const e = m[0].replace(/[.,;:]+$/, "").trim().toLowerCase();
      if (isValidEmailSuggestion(e)) detectedEmails.add(e);
    }
    PHONE_REGEX.lastIndex = 0;
    while ((m = PHONE_REGEX.exec(text))) {
      const candidate = (m[1] || m[0]).replace(/[.,;:]+$/, "").trim();
      if (isValidPhoneSuggestion(candidate)) {
        detectedPhones.add(candidate);
      }
    }
  }

  // 1. Traverse document elements (strictly excluding SiteFind UI, SVGs, profiler bars)
  const allElements = document.querySelectorAll(CONTENT_SELECTOR);

  allElements.forEach((el) => {
    // Strictly ignore any element inside SiteFind's floating widget, HUD, SVGs, or dev profiler bars
    if (el.closest("#sitefind-hud, #sitefind-floating-widget, [id^='sitefind'], [class^='sitefind'], mark.sitefind-mark, svg, path, g, canvas, script, style, noscript, [id*='debug'], [class*='debug'], [id*='profiler'], [class*='profiler']")) {
      return;
    }

    const tag = el.tagName.toLowerCase();
    const selector = getUniqueSelector(el);

    // Attribute sweeps
    for (const attr of ["alt", "title", "aria-label", "placeholder"]) {
      const val = el.getAttribute(attr);
      if (val && val.trim()) {
        const trimmed = val.trim();
        collectSuggestions(trimmed);
        items.push({
          text: trimmed,
          tag,
          elementType: `attribute (${attr})`,
          matchSource: `attribute_${attr}`,
          selector,
        });
      }
    }

    // Input / Textarea values
    if (tag === "input" || tag === "textarea") {
      const val = el.value;
      if (val && val.trim()) {
        const trimmed = val.trim();
        collectSuggestions(trimmed);
        items.push({
          text: trimmed,
          tag,
          elementType: "input value",
          matchSource: "input_value",
          selector,
        });
      }
    }

    // Links (a tag)
    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      if (href) {
        if (href.toLowerCase().startsWith("mailto:")) {
          mailtoHrefs.push(href);
          const mail = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
          if (isValidEmailSuggestion(mail)) detectedEmails.add(mail);
        } else if (href.toLowerCase().startsWith("tel:")) {
          telHrefs.push(href);
          const phone = href.replace(/^tel:/i, "").trim();
          if (isValidPhoneSuggestion(phone)) detectedPhones.add(phone);
        }
      }

      const linkText = ownText(el);
      if (linkText) {
        collectSuggestions(linkText);
        items.push({
          text: linkText,
          href,
          tag: "a",
          elementType: "link",
          matchSource: "visible_text",
          selector,
        });
      }
      return;
    }

    // Headings, paragraphs, table cells, buttons, labels
    if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
      const text = ownText(el);
      if (text) {
        collectSuggestions(text);
        items.push({ text, tag, elementType: "heading", matchSource: "visible_text", selector });
      }
    } else if (["td", "th", "caption"].includes(tag)) {
      const text = ownText(el);
      if (text) {
        collectSuggestions(text);
        items.push({ text, tag, elementType: "table cell", matchSource: "visible_text", selector });
      }
    } else if (["li", "dt", "dd"].includes(tag)) {
      const text = ownText(el);
      if (text) {
        collectSuggestions(text);
        items.push({ text, tag, elementType: "list item", matchSource: "visible_text", selector });
      }
    } else if (tag === "button" || el.getAttribute("role") === "button") {
      const text = ownText(el);
      if (text) {
        collectSuggestions(text);
        items.push({ text, tag, elementType: "button", matchSource: "visible_text", selector });
      }
    } else if (tag === "p") {
      // Link text inside the paragraph is extracted as its own item, so
      // ownText() already excludes it.
      const text = ownText(el);
      if (text) {
        collectSuggestions(text);
        items.push({ text, tag, elementType: "paragraph", matchSource: "visible_text", selector });
      }
    }
  });

  // Collect suggestions and clean visible text from page body without extension UI or SVGs
  let bodyVisibleText = "";
  if (document.body) {
    try {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll("#sitefind-hud, #sitefind-floating-widget, [id^='sitefind'], [class^='sitefind'], mark.sitefind-mark, svg, path, script, style, noscript, canvas, [id*='debug'], [class*='debug'], [id*='profiler'], [class*='profiler']").forEach((n) => n.remove());
      bodyVisibleText = clone.innerText || "";
    } catch {
      bodyVisibleText = document.body.innerText || "";
    }
    collectSuggestions(bodyVisibleText);
  }

  const title = document.title || "";
  collectSuggestions(title);

  const metaDescEl = document.querySelector('meta[name="description" i]');
  const metaDescription = metaDescEl?.getAttribute("content") || "";
  collectSuggestions(metaDescription);

  return {
    url: location.href,
    title,
    metaDescription,
    items,
    text: bodyVisibleText,
    mailtoHrefs: Array.from(new Set(mailtoHrefs)),
    telHrefs: Array.from(new Set(telHrefs)),
    suggestions: {
      emails: Array.from(detectedEmails).slice(0, 10),
      phones: Array.from(detectedPhones).slice(0, 10),
    },
  };
})();
