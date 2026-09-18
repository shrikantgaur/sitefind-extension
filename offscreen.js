// Offscreen document — DOM parsing for crawled HTML / XML.
// Service worker passes fetched HTML here to extract links, visible text, and structured items.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "offscreen") return false;

  if (msg.type === "PARSE_HTML") {
    try {
      const parsed = parseHtml(msg.html, msg.baseUrl);
      sendResponse({ ok: true, data: parsed });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
    return true;
  }

  if (msg.type === "PARSE_SITEMAP") {
    try {
      const urls = parseSitemap(msg.xml);
      sendResponse({ ok: true, urls });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
    return true;
  }

  return false;
});

const CONTENT_SELECTOR =
  "h1, h2, h3, h4, h5, h6, p, li, dt, dd, td, th, caption, button, label, input, textarea, select, [alt], [title], [aria-label], [placeholder]";

// Text that belongs to this element and not to a nested element we also
// extract. Without this an <li> inside an <li>, or a <p> inside a <td>, is
// emitted once per ancestor and the same match is counted several times.
// Inline children (span, strong, a…) are kept, only extracted blocks are cut.
const NESTED_SELECTOR = CONTENT_SELECTOR + ", a";

function ownText(el) {
  if (!el.querySelector(NESTED_SELECTOR)) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }
  const clone = el.cloneNode(true);
  clone.querySelectorAll(NESTED_SELECTOR).forEach((child) => child.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function parseHtml(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Remove non-content elements
  doc.querySelectorAll("script, style, noscript, template, svg").forEach((el) => el.remove());

  const links = [];
  const mailtoHrefs = [];
  const telHrefs = [];
  const items = [];

  // 1. Links
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (href) {
      if (href.toLowerCase().startsWith("mailto:")) {
        mailtoHrefs.push(href);
      } else if (href.toLowerCase().startsWith("tel:")) {
        telHrefs.push(href);
      } else {
        links.push(href);
      }
    }

    const linkText = ownText(a);
    if (linkText) {
      items.push({
        text: linkText,
        href,
        tag: "a",
        elementType: "link",
        matchSource: "visible_text",
        selector: "a",
      });
    }
  });

  // 2. Structured elements & attributes
  const allElements = doc.querySelectorAll(CONTENT_SELECTOR);

  allElements.forEach((el) => {
    const tag = el.tagName.toLowerCase();

    // Attributes
    for (const attr of ["alt", "title", "aria-label", "placeholder"]) {
      const val = el.getAttribute(attr);
      if (val && val.trim()) {
        items.push({
          text: val.trim(),
          tag,
          elementType: `attribute (${attr})`,
          matchSource: `attribute_${attr}`,
          selector: tag,
        });
      }
    }

    // Input values
    if (tag === "input" || tag === "textarea") {
      const val = el.getAttribute("value");
      if (val && val.trim()) {
        items.push({
          text: val.trim(),
          tag,
          elementType: "input value",
          matchSource: "input_value",
          selector: tag,
        });
      }
      return;
    }

    // Tag content
    if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
      const text = ownText(el);
      if (text) items.push({ text, tag, elementType: "heading", matchSource: "visible_text", selector: tag });
    } else if (["td", "th", "caption"].includes(tag)) {
      const text = ownText(el);
      if (text) items.push({ text, tag, elementType: "table cell", matchSource: "visible_text", selector: tag });
    } else if (["li", "dt", "dd"].includes(tag)) {
      const text = ownText(el);
      if (text) items.push({ text, tag, elementType: "list item", matchSource: "visible_text", selector: tag });
    } else if (tag === "button") {
      const text = ownText(el);
      if (text) items.push({ text, tag, elementType: "button", matchSource: "visible_text", selector: tag });
    } else if (tag === "p") {
      const text = ownText(el);
      if (text) items.push({ text, tag, elementType: "paragraph", matchSource: "visible_text", selector: tag });
    }
  });

  const text = doc.body ? doc.body.textContent || "" : "";
  const title = doc.querySelector("title")?.textContent || "";
  const metaDescription =
    doc.querySelector('meta[name="description" i]')?.getAttribute("content") || "";

  return {
    links,
    mailtoHrefs: Array.from(new Set(mailtoHrefs)),
    telHrefs: Array.from(new Set(telHrefs)),
    items,
    text,
    title,
    metaDescription,
  };
}

function parseSitemap(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const locs = Array.from(doc.querySelectorAll("loc")).map((el) => el.textContent.trim()).filter(Boolean);
  return locs;
}
