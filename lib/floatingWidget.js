// In-page draggable floating widget for SiteFind.
// Injected directly on top of the webpage so the user can drag it anywhere and interact with matches.

export function injectDraggableWidget(scanData) {
  if (!scanData) return;

  // If widget already exists, remove or re-focus
  const existing = document.getElementById("sitefind-floating-widget");
  if (existing) {
    existing.remove();
  }

  // 1. Inject Styles (replacing any left behind by a previous injection)
  const oldStyles = document.getElementById("sitefind-widget-styles");
  if (oldStyles) oldStyles.remove();
  const styleEl = document.createElement("style");
  styleEl.id = "sitefind-widget-styles";
  styleEl.textContent = `
    #sitefind-floating-widget {
      position: fixed !important;
      top: 40px !important;
      right: 30px !important;
      width: 490px !important;
      max-height: 520px !important;
      background: #ffffff !important;
      color: #0f1523 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 13px !important;
      border-radius: 12px !important;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.1) !important;
      z-index: 2147483646 !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      user-select: none !important;
      backdrop-filter: blur(16px) !important;
      animation: scWidgetFadeIn 0.2s ease-out !important;
    }
    @keyframes scWidgetFadeIn {
      from { opacity: 0; transform: translateY(-10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    #sitefind-floating-widget.minimized {
      height: 44px !important;
      width: 220px !important;
      overflow: hidden !important;
    }
    #sitefind-floating-widget.minimized .sc-widget-body {
      display: none !important;
    }
    .sc-widget-header {
      background: #0f1523 !important;
      color: #ffffff !important;
      padding: 10px 14px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      cursor: grab !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
    }
    .sc-widget-header:active {
      cursor: grabbing !important;
    }
    .sc-widget-title {
      font-weight: 700 !important;
      font-size: 13px !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    .sc-widget-drag-hint {
      font-size: 10.5px !important;
      color: #94a3b8 !important;
      margin-left: 6px !important;
      font-weight: normal !important;
    }
    .sc-widget-controls {
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
    }
    .sc-widget-btn {
      background: transparent !important;
      color: #94a3b8 !important;
      border: none !important;
      font-size: 15px !important;
      cursor: pointer !important;
      width: 24px !important;
      height: 24px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 4px !important;
      line-height: 1 !important;
    }
    .sc-widget-btn:hover {
      background: rgba(255, 255, 255, 0.15) !important;
      color: #ffffff !important;
    }
    .sc-widget-body {
      padding: 12px 14px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
      overflow-y: auto !important;
      max-height: 460px !important;
      user-select: text !important;
    }
    .sc-widget-toolbar {
      display: flex !important;
      gap: 8px !important;
      align-items: center !important;
    }
    .sc-widget-search {
      flex: 1 !important;
      padding: 6px 10px !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 6px !important;
      font-size: 12px !important;
      outline: none !important;
    }
    .sc-widget-select {
      padding: 6px 8px !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 6px !important;
      font-size: 11.5px !important;
      background: #ffffff !important;
    }
    .sc-widget-table {
      width: 100% !important;
      border-collapse: collapse !important;
      font-size: 11.5px !important;
      margin-top: 4px !important;
    }
    .sc-widget-table th {
      background: #f1f5f9 !important;
      padding: 6px 8px !important;
      font-weight: 700 !important;
      color: #475569 !important;
      border-bottom: 1px solid #cbd5e1 !important;
      text-align: left !important;
      position: sticky !important;
      top: 0 !important;
    }
    .sc-widget-table td {
      padding: 7px 8px !important;
      border-bottom: 1px solid #e2e8f0 !important;
      vertical-align: middle !important;
      color: #1e293b !important;
    }
    .sc-widget-table tr:hover td {
      background: #f8fafc !important;
    }
    .sc-badge-term {
      font-size: 10.5px !important;
      font-weight: 700 !important;
      background: #fef2f2 !important;
      color: #dc2626 !important;
      padding: 2px 6px !important;
      border-radius: 4px !important;
      border: 1px solid #fecaca !important;
      white-space: nowrap !important;
      max-width: 120px !important;
      display: inline-block !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .sc-context-box {
      max-width: 170px !important;
      line-height: 1.35 !important;
      color: #334155 !important;
      word-break: break-word !important;
    }
    .sc-btn-highlight {
      background: #fef3c7 !important;
      color: #92400e !important;
      border: 1px solid #fde68a !important;
      border-radius: 4px !important;
      padding: 3px 8px !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      transition: background 0.15s !important;
    }
    .sc-btn-highlight:hover {
      background: #fde68a !important;
    }
    .sc-btn-highlight-multi {
      background: #4f46e5 !important;
      color: #ffffff !important;
      border: none !important;
      border-radius: 6px !important;
      padding: 6px 11px !important;
      font-size: 11.5px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      transition: background 0.15s !important;
      box-shadow: 0 1px 3px rgba(79, 70, 229, 0.3) !important;
    }
    .sc-btn-highlight-multi:hover:not(:disabled) {
      background: #4338ca !important;
    }
    .sc-btn-highlight-multi:disabled {
      background: #e2e8f0 !important;
      color: #94a3b8 !important;
      cursor: not-allowed !important;
      box-shadow: none !important;
    }
  `;
  document.head.appendChild(styleEl);

  // 2. Create Widget Element
  const widget = document.createElement("div");
  widget.id = "sitefind-floating-widget";

  widget.innerHTML = `
    <div class="sc-widget-header" id="scWidgetHeader">
      <div class="sc-widget-title">
        <span>SiteFind</span>
        <span class="sc-widget-drag-hint">(drag anywhere)</span>
      </div>
      <div class="sc-widget-controls">
        <button class="sc-widget-btn" id="scMinimizeBtn" title="Minimize">−</button>
        <button class="sc-widget-btn" id="scCloseBtn" title="Close">×</button>
      </div>
    </div>
    <div class="sc-widget-body">
      <div class="sc-widget-toolbar">
        <input type="text" id="scWidgetSearch" class="sc-widget-search" placeholder="Filter matches..." />
        <select id="scWidgetTermFilter" class="sc-widget-select">
          <option value="">All Terms</option>
        </select>
        <button id="scWidgetHighlightSelected" class="sc-btn-highlight-multi" type="button">Highlight (<span id="scSelectedCount">0</span>)</button>
      </div>
      <div style="overflow-x: auto; max-height: 380px;">
        <table class="sc-widget-table">
          <thead>
            <tr>
              <th style="width: 28px; text-align: center;">
                <input type="checkbox" id="scSelectAll" checked title="Select/deselect all" style="cursor:pointer;" />
              </th>
              <th style="width: 26%;">Search Term</th>
              <th style="width: 46%;">Matched Text</th>
              <th style="width: 20%; text-align: center;">Action</th>
            </tr>
          </thead>
          <tbody id="scWidgetTableBody"></tbody>
        </table>
      </div>
    </div>
  `;
  document.body.appendChild(widget);

  // 3. Populate terms dropdown
  const termFilter = widget.querySelector("#scWidgetTermFilter");
  (scanData.terms || []).forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    termFilter.appendChild(opt);
  });

  // 4. Gather matches for the current page
  const currentUrl = location.href.split("#")[0];
  const pageMatches = [];

  Object.entries(scanData.matchesByTerm || {}).forEach(([term, data]) => {
    (data.pages || []).forEach((page) => {
      // If matches this page
      if (page.url.split("#")[0] === currentUrl) {
        const hits = page.hits || [];
        const hasVisible = hits.some((h) =>
          h.matchSource === "visible_text" || (
            !h.elementType?.includes("mailto") &&
            !h.elementType?.includes("tel") &&
            !h.context?.toLowerCase().startsWith("mailto:") &&
            !h.context?.toLowerCase().startsWith("tel:")
          )
        );
        const cleanHits = hasVisible ? hits.filter((h) => {
          return !(h.matchSource === "mailto" || h.matchSource === "tel" ||
            h.context?.toLowerCase().startsWith("mailto:") || h.context?.toLowerCase().startsWith("tel:"));
        }) : hits;

        cleanHits.forEach((hit, idx) => {
          pageMatches.push({
            term,
            matchedText: hit.matchedText,
            context: hit.context,
            tag: hit.tag,
            occurrenceIndex: hit.occurrenceIndex || idx + 1,
            selector: hit.selector || "",
          });
        });
      }
    });
  });

  // Fallback: if scanning entire website and no matches on current page, gather all matches
  const rowsToDisplay = pageMatches.length > 0 ? pageMatches : (() => {
    const all = [];
    Object.entries(scanData.matchesByTerm || {}).forEach(([term, data]) => {
      (data.pages || []).forEach((page) => {
        page.hits.forEach((hit, idx) => {
          all.push({
            term,
            url: page.url,
            matchedText: hit.matchedText,
            context: hit.context,
            occurrenceIndex: hit.occurrenceIndex || idx + 1,
            selector: hit.selector || "",
          });
        });
      });
    });
    return all;
  })();

  const tbody = widget.querySelector("#scWidgetTableBody");
  const searchInput = widget.querySelector("#scWidgetSearch");
  const selectAllCb = widget.querySelector("#scSelectAll");
  const highlightSelectedBtn = widget.querySelector("#scWidgetHighlightSelected");
  const selectedCountSpan = widget.querySelector("#scSelectedCount");

  const selectedWidgetIndices = new Set(rowsToDisplay.map((_, i) => i));

  function updateWidgetSelectionUI() {
    const rowCheckboxes = Array.from(tbody.querySelectorAll(".sc-row-cb"));
    const checkedBoxes = rowCheckboxes.filter((cb) => cb.checked);
    if (selectAllCb) {
      if (rowCheckboxes.length === 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
      } else if (checkedBoxes.length === rowCheckboxes.length) {
        selectAllCb.checked = true;
        selectAllCb.indeterminate = false;
      } else if (checkedBoxes.length > 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = true;
      } else {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
      }
    }
    const count = selectedWidgetIndices.size;
    if (selectedCountSpan) selectedCountSpan.textContent = count;
    if (highlightSelectedBtn) highlightSelectedBtn.disabled = count === 0;
  }

  if (selectAllCb) {
    selectAllCb.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      tbody.querySelectorAll(".sc-row-cb").forEach((cb) => {
        const idx = Number(cb.dataset.idx);
        cb.checked = isChecked;
        if (isChecked) selectedWidgetIndices.add(idx);
        else selectedWidgetIndices.delete(idx);
      });
      updateWidgetSelectionUI();
    });
  }

  if (highlightSelectedBtn) {
    highlightSelectedBtn.addEventListener("click", () => {
      const selectedTargets = [];
      selectedWidgetIndices.forEach((idx) => {
        const r = rowsToDisplay[idx];
        if (r) {
          if (r.matchedText) selectedTargets.push(r.matchedText);
          if (r.term) selectedTargets.push(r.term);
        }
      });
      highlightMultiple(selectedTargets);
    });
  }

  function renderTableRows(filterText = "", filterTerm = "") {
    tbody.innerHTML = "";
    const filtered = rowsToDisplay.filter((r) => {
      if (filterTerm && r.term !== filterTerm) return false;
      if (filterText) {
        const text = `${r.term} ${r.matchedText || ""} ${r.context || ""}`.toLowerCase();
        if (!text.includes(filterText)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:16px;">No matches found</td></tr>`;
      updateWidgetSelectionUI();
      return;
    }

    filtered.forEach((row, idx) => {
      const origIdx = rowsToDisplay.indexOf(row);
      const isChecked = selectedWidgetIndices.has(origIdx);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="text-align: center;">
          <input type="checkbox" class="sc-row-cb" data-idx="${origIdx}" ${isChecked ? "checked" : ""} style="cursor:pointer;" />
        </td>
        <td><span class="sc-badge-term" title="${escapeHtml(row.term)}">${escapeHtml(row.term)}</span></td>
        <td>
          <div class="sc-context-box">${highlightSnippet(row.context || row.matchedText, row.matchedText)}</div>
        </td>
        <td style="text-align: center;">
          <button class="sc-btn-highlight" type="button">Highlight</button>
        </td>
      `;

      tr.querySelector(".sc-row-cb").addEventListener("change", (e) => {
        if (e.target.checked) {
          selectedWidgetIndices.add(origIdx);
        } else {
          selectedWidgetIndices.delete(origIdx);
        }
        updateWidgetSelectionUI();
      });

      tr.querySelector(".sc-btn-highlight").addEventListener("click", () => {
        // Trigger highlight directly on page
        highlightInline(row.matchedText || row.term, row.occurrenceIndex || idx + 1);
      });

      tbody.appendChild(tr);
    });

    updateWidgetSelectionUI();
  }

  searchInput.addEventListener("input", (e) => {
    renderTableRows(e.target.value.trim().toLowerCase(), termFilter.value);
  });

  termFilter.addEventListener("change", (e) => {
    renderTableRows(searchInput.value.trim().toLowerCase(), e.target.value);
  });

  renderTableRows();

  // 5. Drag Logic (Smooth and bound to viewport)
  const header = widget.querySelector("#scWidgetHeader");
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  header.addEventListener("mousedown", (e) => {
    if (e.target.closest(".sc-widget-controls")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = widget.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    // Switch from right/top to absolute left/top for dragging
    widget.style.right = "auto";
    widget.style.left = `${initialLeft}px`;
    widget.style.top = `${initialTop}px`;

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = Math.max(10, Math.min(window.innerWidth - widget.offsetWidth - 10, initialLeft + dx));
    let newTop = Math.max(10, Math.min(window.innerHeight - widget.offsetHeight - 10, initialTop + dy));

    widget.style.left = `${newLeft}px`;
    widget.style.top = `${newTop}px`;
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  // Minimize / Close buttons
  const minimizeBtn = widget.querySelector("#scMinimizeBtn");
  minimizeBtn.addEventListener("click", () => {
    widget.classList.toggle("minimized");
    minimizeBtn.textContent = widget.classList.contains("minimized") ? "+" : "−";
  });

  const closeBtn = widget.querySelector("#scCloseBtn");
  closeBtn.addEventListener("click", () => {
    widget.remove();
    styleEl.remove();
  });

  // Helper function for inline highlight
  function highlightInline(textToHighlight, occurrence) {
    // Un-wrap old marks
    document.querySelectorAll("mark.sitefind-mark").forEach((m) => {
      const p = m.parentNode;
      if (p) {
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        m.remove();
        p.normalize();
      }
    });

    if (!textToHighlight) return;
    const pattern = new RegExp(`(${escapeRegExp(textToHighlight)})`, "gi");

    // Walk text nodes
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || p.closest("#sitefind-floating-widget")) return NodeFilter.FILTER_REJECT;
        if (["script", "style", "noscript"].includes(p.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
        return pattern.test(n.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    const createdMarks = [];
    nodes.forEach((n) => {
      const p = n.parentNode;
      if (!p) return;
      const frag = document.createDocumentFragment();
      let last = 0;
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(n.textContent)) !== null) {
        const before = n.textContent.substring(last, m.index);
        if (before) frag.appendChild(document.createTextNode(before));

        const mark = document.createElement("mark");
        mark.className = "sitefind-mark";
        mark.style.cssText = "background-color:#fde047 !important;color:#0f1523 !important;font-weight:800 !important;padding:2px 6px !important;border-radius:4px;outline:2px solid #ca8a04 !important;";
        mark.textContent = m[0];
        frag.appendChild(mark);
        createdMarks.push(mark);

        last = pattern.lastIndex;
      }
      const after = n.textContent.substring(last);
      if (after) frag.appendChild(document.createTextNode(after));
      p.replaceChild(frag, n);
    });

    if (createdMarks.length > 0) {
      const target = createdMarks[Math.min(occurrence - 1, createdMarks.length - 1)] || createdMarks[0];
      target.style.cssText = "background-color:#f97316 !important;color:#ffffff !important;outline:4px solid #4f46e5 !important;padding:3px 8px !important;border-radius:4px !important;box-shadow:0 0 25px rgba(234,88,12,1) !important;";
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        target.scrollIntoView(true);
      }
    }
  }

  function highlightMultiple(targets) {
    // Un-wrap old marks
    document.querySelectorAll("mark.sitefind-mark").forEach((m) => {
      const p = m.parentNode;
      if (p) {
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        m.remove();
        p.normalize();
      }
    });

    const strings = Array.from(new Set((targets || []).map((s) => String(s || "").trim()).filter(Boolean)));
    if (strings.length === 0) return;

    const pattern = new RegExp(`(${strings.map(escapeRegExp).join("|")})`, "gi");

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || p.closest("#sitefind-floating-widget") || p.closest("#sitefind-hud")) return NodeFilter.FILTER_REJECT;
        if (["script", "style", "noscript", "template"].includes(p.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
        return pattern.test(n.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    const createdMarks = [];
    nodes.forEach((n) => {
      const p = n.parentNode;
      if (!p) return;
      const frag = document.createDocumentFragment();
      let last = 0;
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(n.textContent)) !== null) {
        const before = n.textContent.substring(last, m.index);
        if (before) frag.appendChild(document.createTextNode(before));

        const mark = document.createElement("mark");
        mark.className = "sitefind-mark";
        mark.style.cssText = "background-color:#fde047 !important;color:#0f1523 !important;font-weight:800 !important;padding:2px 6px !important;border-radius:4px;outline:2px solid #ca8a04 !important;";
        mark.textContent = m[0];
        frag.appendChild(mark);
        createdMarks.push(mark);

        last = pattern.lastIndex;
      }
      const after = n.textContent.substring(last);
      if (after) frag.appendChild(document.createTextNode(after));
      p.replaceChild(frag, n);
    });

    if (createdMarks.length > 0) {
      createdMarks[0].style.cssText = "background-color:#f97316 !important;color:#ffffff !important;outline:4px solid #4f46e5 !important;padding:3px 8px !important;border-radius:4px !important;box-shadow:0 0 25px rgba(234,88,12,1) !important;";
      try {
        createdMarks[0].scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        createdMarks[0].scrollIntoView(true);
      }
    }
  }

  function highlightSnippet(context, matched) {
    if (!context) return "";
    const safe = escapeHtml(context);
    if (!matched) return safe;
    // Match against the escaped haystack so terms containing & < > " ' still mark.
    const re = new RegExp(`(${escapeRegExp(escapeHtml(matched))})`, "gi");
    return safe.replace(re, `<mark style="background:#fef3c7;color:#92400e;padding:1px 3px;border-radius:2px;font-weight:700;">$1</mark>`);
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
