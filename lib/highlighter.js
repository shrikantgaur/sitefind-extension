// In-page highlight engine & floating match navigator HUD.
// Injected via chrome.scripting.executeScript.
// Fully self-contained closure. Supports single or multi-selected term highlights with in-HUD filtering.

export function runInPageHighlighter(options = {}) {
  // Collect all target search terms and matched texts
  const allTerms = Array.isArray(options.allTerms)
    ? options.allTerms
    : (Array.isArray(options.terms) ? options.terms : (options.term ? [options.term] : []));

  const rawList = [];
  if (Array.isArray(options.allTerms)) rawList.push(...options.allTerms);
  if (Array.isArray(options.matchedTexts)) rawList.push(...options.matchedTexts);
  if (Array.isArray(options.terms)) rawList.push(...options.terms);
  if (options.matchedText) rawList.push(options.matchedText);
  if (options.term) rawList.push(options.term);

  const searchStrings = Array.from(
    new Set(rawList.map((s) => String(s || "").trim()).filter(Boolean))
  );

  const initialActiveTerm = options.activeTerm || options.term || "";
  const initialOccurrenceIndex = options.occurrenceIndex || 1;
  const initialSelector = options.selector || "";

  // 1. Helper: escape HTML & Regex
  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function escapeRegExp(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 2. Helper: clean prior highlights
  function cleanPriorHighlights() {
    document.querySelectorAll("mark.sitefind-mark").forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        mark.remove();
        parent.normalize();
      }
    });

    document.querySelectorAll(".sitefind-highlight-target, .sitefind-highlight-active").forEach((el) => {
      el.classList.remove("sitefind-highlight-target", "sitefind-highlight-active");
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
    });

    const oldHud = document.getElementById("sitefind-hud");
    if (oldHud) oldHud.remove();
    const oldStyles = document.getElementById("sitefind-highlighter-styles");
    if (oldStyles) oldStyles.remove();

    // Each injection is a fresh closure, so removing our own handler reference
    // would leave the previous injection's listener attached. The live handler
    // is parked on window so any run can detach it.
    if (window.__sitefindKeyHandler) {
      document.removeEventListener("keydown", window.__sitefindKeyHandler);
      window.__sitefindKeyHandler = null;
    }
  }

  cleanPriorHighlights();

  // If no search strings passed
  if (searchStrings.length === 0) return;

  // 3. Inject high-visibility modern CSS styles (Requested: UI improve kare)
  const styleEl = document.createElement("style");
  styleEl.id = "sitefind-highlighter-styles";
  styleEl.textContent = `
    mark.sitefind-mark {
      background: #fef3c7 !important;
      color: #92400e !important;
      font-weight: 650 !important;
      padding: 1px 3px !important;
      border-radius: 3px !important;
      box-shadow: inset 0 0 0 1px #fcd34d !important;
      cursor: pointer !important;
    }
    mark.sitefind-mark.sitefind-mark-active {
      background: #4f46e5 !important;
      color: #ffffff !important;
      box-shadow: inset 0 0 0 1px #4338ca, 0 0 0 3px rgba(79, 70, 229, 0.25) !important;
    }
    .sitefind-highlight-target {
      outline: 2px dashed #a5b4fc !important;
      outline-offset: 2px !important;
      border-radius: 4px !important;
    }
    .sitefind-highlight-active {
      outline: 2px solid #4f46e5 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.22) !important;
    }

    #sitefind-hud {
      position: fixed !important;
      right: 20px !important;
      bottom: 20px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 8px 10px !important;
      border-radius: 10px !important;
      background: #0f1523 !important;
      color: #e6ebf4 !important;
      border: 1px solid #24304a !important;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.35) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 12px !important;
      line-height: 1.4 !important;
      max-width: min(520px, calc(100vw - 40px)) !important;
    }
    #sitefind-hud.sitefind-hud-dragging { opacity: 0.92 !important; }

    .sitefind-hud-drag-handle {
      cursor: grab !important;
      color: #64748b !important;
      font-size: 13px !important;
      user-select: none !important;
      padding: 0 2px !important;
    }

    .sitefind-hud-brand {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      font-weight: 650 !important;
      color: #e6ebf4 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
    }
    .sitefind-hud-brand:hover { color: #a5b4fc !important; }

    .sitefind-hud-filter-box { display: flex !important; align-items: center !important; }

    .sitefind-hud-select {
      background: #151d2e !important;
      color: #e6ebf4 !important;
      border: 1px solid #35435f !important;
      border-radius: 6px !important;
      font: inherit !important;
      font-size: 11.5px !important;
      padding: 4px 6px !important;
      max-width: 170px !important;
      cursor: pointer !important;
    }

    .sitefind-counter {
      color: #94a3b8 !important;
      font-variant-numeric: tabular-nums !important;
      white-space: nowrap !important;
    }

    .sitefind-hud-controls { display: flex !important; align-items: center !important; gap: 4px !important; }

    #sitefind-hud button {
      font: inherit !important;
      font-size: 11.5px !important;
      font-weight: 550 !important;
      border-radius: 6px !important;
      border: 1px solid #35435f !important;
      background: #151d2e !important;
      color: #e6ebf4 !important;
      padding: 4px 9px !important;
      cursor: pointer !important;
      white-space: nowrap !important;
    }
    #sitefind-hud button:hover { background: #1e2739 !important; }
    #sitefind-hud .sitefind-btn-action {
      background: #4f46e5 !important;
      border-color: #4f46e5 !important;
      color: #ffffff !important;
    }
    #sitefind-hud .sitefind-btn-action:hover { background: #4338ca !important; }
    #sitefind-hud .sitefind-btn-close {
      border-color: transparent !important;
      background: transparent !important;
      color: #94a3b8 !important;
      padding: 4px 7px !important;
    }
    #sitefind-hud .sitefind-btn-close:hover { background: #2b1315 !important; color: #f87171 !important; }

    @media (prefers-reduced-motion: reduce) {
      #sitefind-hud, mark.sitefind-mark { transition: none !important; }
    }
  `;
  document.head.appendChild(styleEl);

  // Helper: map a matched string to its canonical search term
  function findMatchingTerm(str) {
    const s = String(str || "").toLowerCase();
    for (const t of allTerms) {
      if (s === t.toLowerCase()) return t;
      if (s.includes(t.toLowerCase()) || t.toLowerCase().includes(s)) return t;
      const d1 = s.replace(/[^\d]/g, "");
      const d2 = t.replace(/[^\d]/g, "");
      if (d1.length >= 7 && d2.length >= 7 && (d1.includes(d2) || d2.includes(d1))) return t;
    }
    // Fallback: strictly map to initialActiveTerm or first search term
    return initialActiveTerm || allTerms[0] || str;
  }

  // Also include digit-only variants for phones
  const allSearchPatterns = [...searchStrings];
  searchStrings.forEach((s) => {
    const d = s.replace(/[^\d]/g, "");
    if (d.length >= 7 && !allSearchPatterns.includes(d)) {
      allSearchPatterns.push(d);
    }
  });

  function getMatchingSubstrings(text) {
    if (!text || typeof text !== "string") return [];
    const lower = text.toLowerCase();
    const hits = [];
    allSearchPatterns.forEach((s) => {
      const needle = s.toLowerCase();
      let idx = lower.indexOf(needle);
      while (idx !== -1) {
        hits.push({ start: idx, end: idx + needle.length, sub: text.substr(idx, needle.length) });
        idx = lower.indexOf(needle, idx + needle.length);
      }
    });
    return hits;
  }

  // Helper: check if element is inside an expandable/collapsible container or "Read More" section
  function canBeRevealed(el) {
    if (!el || typeof el.closest !== "function") return false;
    // Native HTML <details>
    if (el.closest("details")) return true;
    // Common accordion, collapse, readmore, tabpanel or truncated containers
    if (el.closest("details, .collapse, [class*='collapse'], [class*='accordion'], [class*='readmore'], [class*='read-more'], [class*='expandable'], [class*='truncate'], [class*='truncated'], [role='tabpanel'], [aria-hidden='true']")) {
      return true;
    }
    // Check if ancestor has an ID referenced by an aria-controls or data toggle trigger
    let curr = el;
    for (let i = 0; i < 6 && curr && curr !== document.body; i++) {
      if (curr.id) {
        try {
          if (document.querySelector(`[aria-controls="${CSS.escape(curr.id)}"]`)) {
            return true;
          }
        } catch {}
      }
      curr = curr.parentElement;
    }
    return false;
  }

  // Helper: expand any parent accordion, <details>, or "Read More" container
  function revealElement(el) {
    if (!el || typeof el.closest !== "function") return;
    try {
      let curr = el;
      while (curr && curr !== document.body) {
        // 1. Native HTML details
        if (curr.tagName && curr.tagName.toLowerCase() === "details") {
          curr.open = true;
        }

        // 2. Disclosure widgets that explicitly say they control this element.
        // Only aria-expanded="false" toggles are clicked: clicking anything that
        // merely reads "read more" used to navigate away or submit forms.
        if (curr.id) {
          try {
            const triggers = document.querySelectorAll(
              `[aria-controls="${CSS.escape(curr.id)}"][aria-expanded="false"]`
            );
            triggers.forEach((btn) => {
              try { btn.click(); } catch {}
            });
          } catch {}
        }

        // 3. Expand CSS collapse classes
        if (curr.classList) {
          if (curr.classList.contains("collapse") && !curr.classList.contains("show")) {
            curr.classList.add("show");
          }
          curr.classList.remove("collapsed");
        }

        // 4. Force unhide inline styles if collapsed by CSS
        const style = window.getComputedStyle(curr);
        if (style.display === "none") {
          curr.style.setProperty("display", "block", "important");
        }
        if (style.visibility === "hidden") {
          curr.style.setProperty("visibility", "visible", "important");
        }
        if (style.maxHeight === "0px" || style.maxHeight === "0") {
          curr.style.setProperty("max-height", "none", "important");
        }
        if (style.overflow === "hidden" && (curr.scrollHeight > curr.clientHeight || curr.offsetHeight === 0)) {
          curr.style.setProperty("overflow", "visible", "important");
        }
        if (curr.getAttribute("aria-hidden") === "true") {
          curr.setAttribute("aria-hidden", "false");
        }

        curr = curr.parentElement;
      }
    } catch (err) {
      console.warn("SiteFind: Error revealing element:", err);
    }
  }

  // Helper: check if element is explicitly hidden (display: none or visibility: hidden)
  function isElementVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    try {
      const tag = el.tagName.toLowerCase();
      if (["script", "style", "noscript", "template", "head"].includes(tag)) return false;
      if (el.closest("script, style, noscript, template, head")) return false;

      // Expandable / Read-more containers should NOT be discarded
      if (canBeRevealed(el)) return true;

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;

      // Only check offsetParent for zero-dimension elements to avoid false negatives on modern layouts
      if (el.offsetParent === null && style.position !== "fixed" && style.position !== "sticky") {
        if (el.offsetWidth === 0 && el.offsetHeight === 0) {
          const parent = el.parentElement;
          if (parent) {
            const pStyle = window.getComputedStyle(parent);
            if (pStyle.display === "none" || pStyle.visibility === "hidden") {
              if (canBeRevealed(parent)) return true;
              return false;
            }
          }
          return false;
        }
      }
    } catch {
      return true; // Fallback: default to visible so we never drop matches or crash
    }
    return true;
  }

  const matchesFound = [];

  // Strategy A: TreeWalker text-node mark wrapping (fast & safe)
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        try {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "noscript", "template", "svg"].includes(tag)) return NodeFilter.FILTER_REJECT;
          if (parent.id === "sitefind-hud" || parent.closest("#sitefind-hud, #sitefind-floating-widget")) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.tagName.toLowerCase() === "mark" && parent.classList?.contains("sitefind-mark")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        } catch {
          return NodeFilter.FILTER_REJECT;
        }
      }
    }
  );

  const textNodesToWrap = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const hits = getMatchingSubstrings(node.textContent);
    if (hits.length > 0) {
      // Check visibility ONLY on nodes that match (0ms reflow overhead)
      if (!isElementVisible(node.parentElement)) continue;
      textNodesToWrap.push({ node, hits });
    }
  }

  // Wrap all text matches with <mark class="sitefind-mark">
  textNodesToWrap.forEach(({ node }) => {
    const text = node.textContent;
    const parent = node.parentNode;
    if (!parent) return;

    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    const pattern = new RegExp(`(${allSearchPatterns.map(escapeRegExp).join("|")})`, "gi");
    let match;
    let hasMatch = false;

    while ((match = pattern.exec(text)) !== null) {
      hasMatch = true;
      const before = text.substring(lastIdx, match.index);
      if (before) frag.appendChild(document.createTextNode(before));

      const matchingTerm = findMatchingTerm(match[0]);
      const mark = document.createElement("mark");
      mark.className = "sitefind-mark";
      mark.textContent = match[0];
      mark.dataset.sitefindTerm = matchingTerm;
      mark.title = `SiteFind: "${matchingTerm}"`;
      frag.appendChild(mark);

      const entry = { el: mark, text: match[0], term: matchingTerm, parent };
      matchesFound.push(entry);

      // Clicking a mark in-page focuses it directly in the navigator
      mark.addEventListener("click", () => {
        focusMatchItem(entry);
      });

      lastIdx = pattern.lastIndex;
    }

    if (hasMatch) {
      const after = text.substring(lastIdx);
      if (after) frag.appendChild(document.createTextNode(after));
      parent.replaceChild(frag, node);
    }
  });

  // Strategy B: Search links, form attributes, inputs (avoiding duplicates)
  document.querySelectorAll("a, input, textarea, [placeholder], [alt], [title], [aria-label]").forEach((el) => {
    try {
      if (el.closest("#sitefind-hud, #sitefind-floating-widget")) return;
      if (!isElementVisible(el)) return;
      const tag = el.tagName.toLowerCase();

      // Check href
      if (tag === "a") {
        const href = el.getAttribute("href") || "";
        if (allSearchPatterns.some((s) => href.toLowerCase().includes(s.toLowerCase()))) {
          // Skip if this link already contains a wrapped <mark class="sitefind-mark">
          if (el.querySelector("mark.sitefind-mark")) return;
          if (matchesFound.some((m) => m.el === el || m.parent === el || el.contains(m.el))) return;

          const matchingTerm = findMatchingTerm(href);
          el.classList.add("sitefind-highlight-target");
          matchesFound.push({ el, text: href, term: matchingTerm, parent: el });
        }
      }

      // Check input / textarea
      if (tag === "input" || tag === "textarea") {
        const val = el.value || "";
        const ph = el.getAttribute("placeholder") || "";
        if (allSearchPatterns.some((s) => val.toLowerCase().includes(s.toLowerCase()) || ph.toLowerCase().includes(s.toLowerCase()))) {
          if (matchesFound.some((m) => m.el === el)) return;
          const textFound = val || ph;
          const matchingTerm = findMatchingTerm(textFound);
          el.classList.add("sitefind-highlight-target");
          matchesFound.push({ el, text: textFound, term: matchingTerm, parent: el });
        }
      }
    } catch {}
  });

  function openDashboardFromHud() {
    try {
      chrome.runtime.sendMessage({
        type: "OPEN_DASHBOARD",
        url: window.location.href,
        origin: window.location.origin,
      });
    } catch (err) {
      console.warn("Could not send OPEN_DASHBOARD message:", err);
    }
  }

  // If no matches found on this page
  if (matchesFound.length === 0) {
    renderEmptyHUD();
    return;
  }

  // ---------------------------------------------------------------------
  // Navigation State & In-HUD Term Filter (Requested: Option to select which term to highlight)
  // ---------------------------------------------------------------------
  let activeFilterTerm = "__ALL__";
  if (initialActiveTerm && matchesFound.some((m) => m.term.toLowerCase() === initialActiveTerm.toLowerCase())) {
    const foundTerm = matchesFound.find((m) => m.term.toLowerCase() === initialActiveTerm.toLowerCase());
    activeFilterTerm = foundTerm.term;
  }

  let activeList = getFilteredList(activeFilterTerm);
  let currentIndex = 0;

  // Determine initial index
  if (initialOccurrenceIndex > 1 && initialOccurrenceIndex <= activeList.length) {
    currentIndex = initialOccurrenceIndex - 1;
  }

  function getFilteredList(termVal) {
    if (termVal === "__ALL__") return matchesFound;
    return matchesFound.filter((m) => m.term === termVal);
  }

  // Draggable HUD functionality
  function enableHudDragging(hudEl) {
    if (!hudEl) return;
    const dragHandle = hudEl.querySelector(".sitefind-hud-drag-handle") || hudEl;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    function onMouseDown(e) {
      if (e.button !== 0) return;
      if (e.target.closest("button, select, input, option, a, [role='button']")) return;

      isDragging = true;
      const rect = hudEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;

      hudEl.style.setProperty("right", "auto", "important");
      hudEl.style.setProperty("bottom", "auto", "important");
      hudEl.style.setProperty("left", `${initialLeft}px`, "important");
      hudEl.style.setProperty("top", `${initialTop}px`, "important");
      hudEl.classList.add("sitefind-hud-dragging");

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    }

    function onMouseMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const rect = hudEl.getBoundingClientRect();
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

      let newLeft = Math.max(margin, Math.min(initialLeft + dx, maxLeft));
      let newTop = Math.max(margin, Math.min(initialTop + dy, maxTop));

      hudEl.style.setProperty("left", `${newLeft}px`, "important");
      hudEl.style.setProperty("top", `${newTop}px`, "important");
    }

    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      hudEl.classList.remove("sitefind-hud-dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    dragHandle.addEventListener("mousedown", onMouseDown);
  }

  // Build HUD Element
  const hud = document.createElement("div");
  hud.id = "sitefind-hud";

  // Calculate term counts
  const termCounts = {};
  matchesFound.forEach((m) => {
    termCounts[m.term] = (termCounts[m.term] || 0) + 1;
  });

  const uniqueTerms = (allTerms.length > 0 ? allTerms : Object.keys(termCounts))
    .filter((t) => Boolean(t) && ((termCounts[t] || 0) > 0 || allTerms.includes(t)));

  let optionsHtml = `<option value="__ALL__">All Terms (${matchesFound.length})</option>`;
  uniqueTerms.forEach((t) => {
    const count = termCounts[t] || 0;
    const isSelected = activeFilterTerm.toLowerCase() === t.toLowerCase() ? "selected" : "";
    optionsHtml += `<option value="${escapeHtml(t)}" ${isSelected}>${escapeHtml(t)} (${count})</option>`;
  });

  hud.innerHTML = `
    <div class="sitefind-hud-drag-handle" title="Drag to move HUD anywhere">⠿</div>

    <div class="sitefind-hud-brand" title="Open SiteFind">
      <span>SiteFind</span>
    </div>

    <div class="sitefind-hud-filter-box">
      <select id="sc-hud-term-select" class="sitefind-hud-select" title="Select term to navigate matches on this page">
        ${optionsHtml}
      </select>
    </div>

    <span id="sc-hud-counter" class="sitefind-counter">Match 1 of ${activeList.length}</span>

    <div class="sitefind-hud-controls">
      <button id="sc-prev" class="sitefind-btn-nav" title="Previous match (← key)">‹ Prev</button>
      <button id="sc-next" class="sitefind-btn-nav" title="Next match (→ key)">Next ›</button>
      <button id="sc-all" class="sitefind-btn-action" title="Highlight all visible occurrences">All</button>
      <button id="sc-hud-open" class="sitefind-btn-action" title="Open the SiteFind dashboard">Dashboard</button>
      <button id="sc-close" class="sitefind-btn-close" title="Close navigator">×</button>
    </div>
  `;
  document.body.appendChild(hud);
  enableHudDragging(hud);

  const termSelect = hud.querySelector("#sc-hud-term-select");
  const counterSpan = hud.querySelector("#sc-hud-counter");
  const prevBtn = hud.querySelector("#sc-prev");
  const nextBtn = hud.querySelector("#sc-next");
  const allBtn = hud.querySelector("#sc-all");
  const openBtn = hud.querySelector("#sc-hud-open");
  const closeBtn = hud.querySelector("#sc-close");
  const brandBtn = hud.querySelector(".sitefind-hud-brand");
  if (closeBtn) closeBtn.addEventListener("click", cleanPriorHighlights);
  if (openBtn) openBtn.addEventListener("click", openDashboardFromHud);
  if (brandBtn) brandBtn.addEventListener("click", openDashboardFromHud);

  // Switch term filter inside HUD without opening popup
  termSelect.addEventListener("change", (e) => {
    activeFilterTerm = e.target.value;
    activeList = getFilteredList(activeFilterTerm);
    currentIndex = 0;
    if (activeList.length > 0) {
      highlightCurrent();
    } else {
      counterSpan.textContent = `0 matches for "${activeFilterTerm}"`;
    }
  });

  // Prev / Next actions
  prevBtn.addEventListener("click", () => {
    if (activeList.length === 0) return;
    currentIndex = (currentIndex - 1 + activeList.length) % activeList.length;
    highlightCurrent();
  });

  nextBtn.addEventListener("click", () => {
    if (activeList.length === 0) return;
    currentIndex = (currentIndex + 1) % activeList.length;
    highlightCurrent();
  });

  allBtn.addEventListener("click", () => {
    activeList.forEach(({ el }) => {
      if (el?.classList) {
        revealElement(el);
        if (el.tagName.toLowerCase() === "mark") {
          el.classList.add("sitefind-mark-active");
        } else {
          el.classList.add("sitefind-highlight-active");
        }
      }
    });
  });

  closeBtn.addEventListener("click", cleanPriorHighlights);

  // Keyboard navigation (ArrowLeft = Prev, ArrowRight = Next, Escape = Close)
  function handleKeyNavigation(e) {
    if (["input", "textarea", "select"].includes(document.activeElement?.tagName?.toLowerCase())) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prevBtn.click();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nextBtn.click();
    } else if (e.key === "Escape") {
      cleanPriorHighlights();
    }
  }
  window.__sitefindKeyHandler = handleKeyNavigation;
  document.addEventListener("keydown", handleKeyNavigation);

  function highlightCurrent() {
    matchesFound.forEach(({ el }) => {
      if (el?.classList) {
        el.classList.remove("sitefind-mark-active", "sitefind-highlight-active");
      }
    });

    if (activeList.length === 0) {
      counterSpan.textContent = "0 matches";
      return;
    }

    const currentItem = activeList[currentIndex];
    if (currentItem && currentItem.el) {
      // Auto-expand any collapsed wrapper, <details>, or "Read More"
      revealElement(currentItem.el);

      if (currentItem.el.tagName.toLowerCase() === "mark") {
        currentItem.el.classList.add("sitefind-mark-active");
      } else {
        currentItem.el.classList.add("sitefind-highlight-active");
      }

      setTimeout(() => {
        try {
          currentItem.el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        } catch {
          currentItem.el.scrollIntoView(true);
        }
      }, 35);
    }

    counterSpan.textContent = `Match ${currentIndex + 1} of ${activeList.length}`;
  }

  function focusMatchItem(entry) {
    const idx = activeList.indexOf(entry);
    if (idx !== -1) {
      currentIndex = idx;
      highlightCurrent();
    } else {
      // Switch filter to this item's term or All
      activeFilterTerm = "__ALL__";
      termSelect.value = "__ALL__";
      activeList = matchesFound;
      currentIndex = activeList.indexOf(entry);
      highlightCurrent();
    }
  }

  function renderEmptyHUD() {
    const emptyHud = document.createElement("div");
    emptyHud.id = "sitefind-hud";
    emptyHud.innerHTML = `
      <div class="sitefind-hud-drag-handle" title="Drag to move HUD anywhere">⠿</div>
      <div class="sitefind-hud-brand" title="Open SiteFind">SiteFind</div>
      <span class="sitefind-counter">No visible matches on this page</span>
      <button id="sc-empty-open" class="sitefind-btn-action" title="Open the SiteFind dashboard">Dashboard</button>
      <button class="sitefind-btn-close" title="Close">×</button>
    `;
    emptyHud.querySelector(".sitefind-btn-close").onclick = cleanPriorHighlights;
    const emptyOpen = emptyHud.querySelector("#sc-empty-open");
    if (emptyOpen) {
      emptyOpen.onclick = () => {
        try {
          chrome.runtime.sendMessage({
            type: "OPEN_DASHBOARD",
            url: window.location.href,
            origin: window.location.origin,
          });
        } catch {}
      };
    }
    const emptyBrand = emptyHud.querySelector(".sitefind-hud-brand");
    if (emptyBrand) {
      emptyBrand.onclick = () => {
        try {
          chrome.runtime.sendMessage({
            type: "OPEN_DASHBOARD",
            url: window.location.href,
            origin: window.location.origin,
          });
        } catch {}
      };
    }
    document.body.appendChild(emptyHud);
    enableHudDragging(emptyHud);
  }

  highlightCurrent();
}
