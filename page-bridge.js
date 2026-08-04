/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  const staleStackingStyle = document.getElementById("smarttex-overlay-stacking-style");
  if (staleStackingStyle?.textContent?.includes(".ace_editor .ace_scroller")) {
    staleStackingStyle.remove();
  }
  if (globalThis.__smartTeXEditorBridgeLoaded) return;
  globalThis.__smartTeXEditorBridgeLoaded = true;

  const STATE_EVENT = "smarttex:editor-state";
  const CITATION_REQUEST_EVENT = "smarttex:citation-editor-request";
  const CITATION_RESPONSE_EVENT = "smarttex:citation-editor-response";
  const CITE_COMMAND = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/i;
  const REFERENCE_COMMAND = /\\(?:eqref|ref|pageref|autoref|cref|Cref|vref|Vref|nameref)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/;
  let editorKind = "";
  let editor = null;
  let boundSession = null;
  let scheduledState = false;
  let lastFingerprint = "";
  let codeMirrorCleanup = null;
  let citationAutocompleteActive = false;
  let referenceAutocompleteActive = false;
  let numberBadgeLayer = null;
  let structureHighlightLayer = null;
  let structureHighlightSettings = {
    environmentEnabled: true,
    environmentColor: "#8ec5ff",
    captionEnabled: true,
    captionColor: "#70afea",
    labelEnabled: true,
    labelColor: "#8fd19e",
    referenceEnabled: true,
    referenceColor: "#8fd19e",
    nonumberEnabled: true,
    nonumberColor: "#ffe69a",
    inlineMathEnabled: true,
    inlineMathColor: "#8ec5ff"
  };
  let lastEditorState = null;
  let cachedStructureSource = null;
  let cachedStructures = { badges: [], highlights: [] };
  let structureRefreshTimer = 0;
  let overlayFramePending = false;

  function normalizedHighlightColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#8ec5ff";
  }

  function colorWithAlpha(hexColor, alpha) {
    const normalized = normalizedHighlightColor(hexColor).slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  function ensureNumberBadgeLayer() {
    if (numberBadgeLayer?.isConnected) return numberBadgeLayer;
    numberBadgeLayer = document.createElement("div");
    numberBadgeLayer.id = "smarttex-source-number-badges";
    numberBadgeLayer.style.cssText = [
      "position:fixed", "pointer-events:none", "overflow:hidden", "z-index:40",
      "font:12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif", "color:#7b8493"
    ].join(";");
    document.documentElement.appendChild(numberBadgeLayer);
    return numberBadgeLayer;
  }

  function ensureOverlayStackingStyle() {
    let style = document.getElementById("smarttex-overlay-stacking-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "smarttex-overlay-stacking-style";
      document.documentElement.appendChild(style);
    }
    style.textContent = `
      /* The annotation canvas is a page-level layer. Lift only native editor
         paint layers above it; never alter the editor scroller itself. */
      .ace_editor .ace_content,
      .ace_editor .ace_text-layer,
      .ace_editor .ace_marker-layer,
      .ace_editor .ace_cursor-layer,
      .cm-editor .cm-content,
      .cm-editor .cm-selectionLayer,
      .cm-editor .cm-cursorLayer {
        z-index: 2 !important;
      }
      .ace_editor .ace_gutter,
      .cm-editor .cm-gutters {
        z-index: 3 !important;
      }
      .cm-editor .cm-panels,
      .cm-editor .cm-panel,
      .ace_search,
      [class*="search-panel"],
      [class*="searchPanel"] {
        z-index: 2147483644 !important;
      }
    `;
  }

  function ensureStructureHighlightLayer() {
    if (structureHighlightLayer?.isConnected) return structureHighlightLayer;
    structureHighlightLayer = document.createElement("div");
    structureHighlightLayer.id = "smarttex-source-structure-highlights";
    structureHighlightLayer.style.cssText = [
      "position:fixed", "pointer-events:none", "overflow:hidden", "z-index:0"
    ].join(";");
    document.documentElement.appendChild(structureHighlightLayer);
    ensureOverlayStackingStyle();
    return structureHighlightLayer;
  }

  function romanNumber(value) {
    const table = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
    let number = Math.max(0, Number(value) || 0);
    let result = "";
    for (const [amount, symbol] of table) {
      while (number >= amount) {
        result += symbol;
        number -= amount;
      }
    }
    return result;
  }

  function alphaNumber(value) {
    let number = Math.max(1, Number(value) || 1);
    let result = "";
    while (number > 0) {
      number -= 1;
      result = String.fromCharCode(65 + (number % 26)) + result;
      number = Math.floor(number / 26);
    }
    return result;
  }

  function lineStartIndex(source, index) {
    return source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  }

  function lineEndIndex(source, index) {
    const newline = source.indexOf("\n", Math.max(0, index));
    return newline < 0 ? source.length : newline;
  }

  function isEscaped(source, index) {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
    return (slashes % 2) === 1;
  }

  function balancedGroupEnd(source, openIndex, openChar = "{", closeChar = "}") {
    if (source[openIndex] !== openChar) return -1;
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
      if (isEscaped(source, index)) continue;
      if (source[index] === openChar) depth += 1;
      else if (source[index] === closeChar && --depth === 0) return index + 1;
    }
    return -1;
  }

  function appendCommandRanges(source, highlights) {
    const simple = [
      { pattern: /\\(?:nonumber|notag)\b/g, kind: "nonumber" },
      { pattern: /\\label\s*\{/g, kind: "label", group: true },
      { pattern: /\\(?:eqref|ref|pageref|autoref|cref|Cref|vref|Vref|nameref)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{/g, kind: "reference", group: true },
      { pattern: /\\caption\*?\s*(?:\[[^\]]*\]\s*)?\{/g, kind: "caption", group: true }
    ];
    for (const entry of simple) {
      let match;
      while ((match = entry.pattern.exec(source))) {
        let end = match.index + match[0].length;
        if (entry.group) {
          const open = source.lastIndexOf("{", end - 1);
          const groupEnd = balancedGroupEnd(source, open);
          if (groupEnd > 0) end = groupEnd;
        }
        highlights.push({ start: match.index, end, firstLineEnd: end, kind: entry.kind, inline: true });
      }
    }

    // Inline mathematics: unescaped $...$ and \\(...\\). Display $$...$$ is intentionally omitted.
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "$" && !isEscaped(source, index) && source[index + 1] !== "$" && source[index - 1] !== "$" ) {
        let end = index + 1;
        while (end < source.length) {
          if (source[end] === "$" && !isEscaped(source, end) && source[end + 1] !== "$" ) break;
          end += 1;
        }
        if (end < source.length) {
          highlights.push({ start: index, end: end + 1, firstLineEnd: end + 1, kind: "inlineMath", inline: true });
          index = end;
        }
      } else if (source.startsWith("\\(", index) && !isEscaped(source, index)) {
        const end = source.indexOf("\\)", index + 2);
        if (end >= 0) {
          highlights.push({ start: index, end: end + 2, firstLineEnd: end + 2, kind: "inlineMath", inline: true });
          index = end + 1;
        }
      }
    }
  }

  function sourceNumberBadges(sourceValue) {
    const source = String(sourceValue || "");
    const badges = [];
    const highlights = [];
    const sectionTokens = [];
    const counters = { figure: 0, table: 0 };
    const sectionCounters = [0, 0, 0, 0];
    const revtex = /\\documentclass(?:\s*\[[^\]]*\])?\s*\{[^{}]*revtex/i.test(source);
    const tokenPattern = /\\begin\s*\{(equation\*?|align\*?|alignat\*?|flalign\*?|gather\*?|multline\*?|eqnarray\*?|figure\*?|table\*?)\}|\\(section|subsection|subsubsection|paragraph)(\*)?\s*\{/g;
    const latexContext = globalThis.SmartTeXLatexContext;
    const equationContexts = latexContext?.equationContexts?.(source)?.contexts || [];
    const equationByStart = new Map(equationContexts.map((context) => [context.openStart, context]));
    let match;

    while ((match = tokenPattern.exec(source))) {
      if (match[2]) {
        const level = ["section", "subsection", "subsubsection", "paragraph"].indexOf(match[2]);
        if (match[3]) continue;
        sectionCounters[level] += 1;
        for (let index = level + 1; index < sectionCounters.length; index += 1) sectionCounters[index] = 0;
        let number;
        if (revtex) {
          const parts = [];
          if (sectionCounters[0]) parts.push(romanNumber(sectionCounters[0]));
          if (level >= 1 && sectionCounters[1]) parts.push(alphaNumber(sectionCounters[1]));
          if (level >= 2 && sectionCounters[2]) parts.push(String(sectionCounters[2]));
          if (level >= 3 && sectionCounters[3]) parts.push(String(sectionCounters[3]));
          number = parts.join(".");
        } else {
          number = sectionCounters.slice(0, level + 1).filter(Boolean).join(".");
        }
        const start = lineStartIndex(source, match.index);
        badges.push({ index: start, label: `Sec. ${number}` });
        sectionTokens.push({ start, level });
        continue;
      }

      const environment = match[1];
      const base = environment.replace(/\*$/, "");
      const starred = environment.endsWith("*");
      const endPattern = new RegExp(`\\\\end\\s*\\{${environment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g");
      endPattern.lastIndex = tokenPattern.lastIndex;
      const endMatch = endPattern.exec(source);
      const bodyEnd = endMatch ? endMatch.index : source.length;
      const body = source.slice(tokenPattern.lastIndex, bodyEnd);

      const start = lineStartIndex(source, match.index);
      const environmentHighlight = {
        start,
        end: lineEndIndex(source, endMatch ? endMatch.index + endMatch[0].length : bodyEnd),
        firstLineEnd: lineEndIndex(source, start),
        kind: "environment"
      };

      if (base === "figure" || base === "table") {
        const numbered = /\\caption(?!\*)\s*(?:\[[^\]]*\]\s*)?\{/.test(body);
        if (numbered) {
          counters[base] += 1;
          badges.push({ index: start, label: `${base === "figure" ? "Fig." : "Tab."} ${counters[base]}` });
        }
        highlights.push(environmentHighlight);
        continue;
      }

      highlights.push(environmentHighlight);
      const context = equationByStart.get(match.index);
      if (!context || !latexContext?.equationPreviewNumbering) continue;
      const completeContext = { ...context, source: source.slice(context.contentStart, context.contentEnd) };
      const numbering = latexContext.equationPreviewNumbering(source, completeContext);
      const values = (numbering?.numbers || []).map((number) => number?.value).filter(Boolean);
      if (!values.length) continue;
      const numberText = values.length > 1 ? `${values[0]}–${values[values.length - 1]}` : values[0];
      badges.push({ index: start, label: `Eqn. (${numberText})` });
    }

    for (const section of sectionTokens) {
      // A section highlight is deliberately limited to the command line itself.
      // Highlighting until the next peer section would tint nearly the entire document.
      highlights.push({
        start: section.start,
        end: lineEndIndex(source, section.start),
        firstLineEnd: lineEndIndex(source, section.start),
        kind: "section"
      });
    }

    appendCommandRanges(source, highlights);
    return { badges, highlights };
  }

  function editorViewportBounds() {
    if (editorKind === "codemirror") {
      const root = editor?.dom || codeMirrorContent(editor)?.closest?.(".cm-editor");
      const scroller = editor?.scrollDOM || root?.querySelector?.(".cm-scroller");
      const rect = scroller?.getBoundingClientRect?.() || root?.getBoundingClientRect?.();
      return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
    }
    const rect = editor?.renderer?.container?.getBoundingClientRect?.();
    return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
  }

  function editorViewportRight() {
    return editorViewportBounds()?.right || null;
  }

  function editorScreenPosition(index) {
    if (editorKind === "codemirror") return codeMirrorScreenPosition(index);
    const session = editor?.getSession?.();
    const position = session?.doc?.indexToPosition?.(index, 0);
    return aceScreenPosition(position);
  }

  function updateOverlayBounds(layer, bounds) {
    layer.style.left = `${Math.round(bounds.left)}px`;
    layer.style.top = `${Math.round(bounds.top)}px`;
    layer.style.width = `${Math.max(0, Math.round(bounds.right - bounds.left))}px`;
    layer.style.height = `${Math.max(0, Math.round(bounds.bottom - bounds.top))}px`;
  }

  function editorRootElement() {
    if (editorKind === "codemirror") {
      return editor?.dom || editor?.contentDOM?.closest?.(".cm-editor") || null;
    }
    return editor?.container || document.querySelector(".ace_editor");
  }

  function opaqueEditorBackground() {
    const root = editorRootElement();
    const candidates = [
      root?.querySelector?.(".ace_scroller"),
      root?.querySelector?.(".ace_content"),
      root?.querySelector?.(".cm-scroller"),
      root,
      root?.parentElement,
      document.body
    ].filter(Boolean);
    for (const candidate of candidates) {
      const color = getComputedStyle(candidate).backgroundColor;
      const match = String(color || "").match(/^rgba?\(([^)]+)\)$/i);
      if (!match) continue;
      const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
      const alpha = parts.length > 3 ? parts[3] : 1;
      if (Number.isFinite(alpha) && alpha >= 0.98) return color;
    }
    return "rgb(255, 255, 255)";
  }

  function nativeEditorOverlayRects(bounds) {
    const root = editorRootElement();
    if (!root) return [];
    const selectors = [
      ".ace_search",
      ".cm-panel.cm-search",
      ".cm-search",
      "[class*='search-panel']",
      "[class*='searchPanel']"
    ];
    const overlays = new Set();
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) overlays.add(element);
    }
    const result = [];
    for (const element of overlays) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const rect = element.getBoundingClientRect();
      const left = Math.max(bounds.left, rect.left - 2);
      const top = Math.max(bounds.top, rect.top - 2);
      const right = Math.min(bounds.right, rect.right + 2);
      const bottom = Math.min(bounds.bottom, rect.bottom + 2);
      if (right <= left || bottom <= top) continue;
      result.push({ left, top, right, bottom });
    }
    return result;
  }

  function subtractRect(rect, cutout) {
    if (!rectsOverlap(rect, cutout)) return [rect];
    const intersection = {
      left: Math.max(rect.left, cutout.left),
      top: Math.max(rect.top, cutout.top),
      right: Math.min(rect.right, cutout.right),
      bottom: Math.min(rect.bottom, cutout.bottom)
    };
    const pieces = [];
    if (intersection.top > rect.top) {
      pieces.push({ left: rect.left, top: rect.top, right: rect.right, bottom: intersection.top });
    }
    if (intersection.bottom < rect.bottom) {
      pieces.push({ left: rect.left, top: intersection.bottom, right: rect.right, bottom: rect.bottom });
    }
    if (intersection.left > rect.left) {
      pieces.push({ left: rect.left, top: intersection.top, right: intersection.left, bottom: intersection.bottom });
    }
    if (intersection.right < rect.right) {
      pieces.push({ left: intersection.right, top: intersection.top, right: rect.right, bottom: intersection.bottom });
    }
    return pieces.filter((piece) => piece.right > piece.left && piece.bottom > piece.top);
  }

  function visibleHighlightPieces(rect, overlayRects) {
    let pieces = [rect];
    for (const cutout of overlayRects) {
      pieces = pieces.flatMap((piece) => subtractRect(piece, cutout));
      if (!pieces.length) break;
    }
    return pieces;
  }

  function appendHighlightRect(layer, bounds, rect, background, borderRadius, overlayRects) {
    for (const piece of visibleHighlightPieces(rect, overlayRects)) {
      const element = document.createElement("div");
      element.style.cssText = [
        "position:absolute",
        `left:${Math.round(piece.left - bounds.left)}px`,
        `top:${Math.round(piece.top - bounds.top)}px`,
        `width:${Math.max(1, Math.round(piece.right - piece.left))}px`,
        `height:${Math.max(1, Math.round(piece.bottom - piece.top))}px`,
        `background:${background}`,
        `border-radius:${borderRadius || "0"}`
      ].join(";");
      layer.appendChild(element);
    }
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function renderSourceNumberBadges(state = lastEditorState) {
    const layer = ensureNumberBadgeLayer();
    const highlightLayer = ensureStructureHighlightLayer();
    layer.replaceChildren();
    highlightLayer.replaceChildren();
    if (!state || !editor) return;
    const bounds = editorViewportBounds();
    if (!bounds || !Number.isFinite(bounds.right)) return;
    updateOverlayBounds(layer, bounds);
    updateOverlayBounds(highlightLayer, bounds);
    const nativeOverlayRects = nativeEditorOverlayRects(bounds);

    for (const highlight of cachedStructures.highlights) {
      const enabledKey = `${highlight.kind}Enabled`;
      const environmentCategory = highlight.kind === "environment" || highlight.kind === "section";
      if (environmentCategory && structureHighlightSettings.environmentEnabled === false) continue;
      if (!environmentCategory && enabledKey in structureHighlightSettings && structureHighlightSettings[enabledKey] === false) continue;
      const start = editorScreenPosition(highlight.start);
      const end = editorScreenPosition(highlight.end);
      const firstLineEnd = editorScreenPosition(highlight.firstLineEnd ?? highlight.start);
      if (!start || !end || !firstLineEnd) continue;
      const rawTop = start.pageY - window.scrollY;
      const rawBottom = end.pageY - window.scrollY + (end.lineHeight || start.lineHeight || 16);
      const top = Math.max(bounds.top, rawTop);
      const bottom = Math.min(bounds.bottom, rawBottom);
      if (bottom <= top) continue;
      const relativeTop = top - bounds.top;
      const baseColor = structureHighlightSettings[`${highlight.kind}Color`] || structureHighlightSettings.environmentColor;

      if (highlight.inline) {
        const lineHeight = start.lineHeight || 16;
        const sameLine = Math.abs(start.pageY - end.pageY) < lineHeight * 0.5;
        const left = Math.max(bounds.left, start.pageX - window.scrollX);
        const right = Math.min(bounds.right, sameLine ? end.pageX - window.scrollX : bounds.right);
        appendHighlightRect(
          highlightLayer,
          bounds,
          {
            left,
            top,
            right,
            bottom: Math.min(bottom, top + lineHeight)
          },
          colorWithAlpha(baseColor, 0.34),
          "2px",
          nativeOverlayRects
        );
        if (!sameLine && bottom > top + lineHeight) {
          appendHighlightRect(
            highlightLayer,
            bounds,
            {
              left: bounds.left,
              top: top + lineHeight,
              right: bounds.right,
              bottom
            },
            colorWithAlpha(baseColor, 0.24),
            "2px",
            nativeOverlayRects
          );
        }
        continue;
      }

      if (highlight.kind === "environment") {
        appendHighlightRect(
          highlightLayer,
          bounds,
          { left: bounds.left, top, right: bounds.right, bottom },
          colorWithAlpha(structureHighlightSettings.environmentColor, 0.18),
          "2px",
          nativeOverlayRects
        );
      }
      const firstLineBottom = Math.min(bounds.bottom, firstLineEnd.pageY - window.scrollY + (firstLineEnd.lineHeight || start.lineHeight || 16));
      if (firstLineBottom > top) {
        appendHighlightRect(
          highlightLayer,
          bounds,
          { left: bounds.left, top, right: bounds.right, bottom: firstLineBottom },
          colorWithAlpha(structureHighlightSettings.environmentColor, 0.34),
          "2px",
          nativeOverlayRects
        );
      }
    }

    // Highlight rectangles are geometrically clipped around native search
    // panels. The host panel keeps its own appearance and no covering mask or
    // forced background is needed.

    for (const badge of cachedStructures.badges) {
      const screen = editorScreenPosition(badge.index);
      if (!screen || !Number.isFinite(screen.pageY)) continue;
      const top = screen.pageY - window.scrollY;
      const lineHeight = screen.lineHeight || 16;
      if (top + lineHeight < bounds.top || top > bounds.bottom) continue;
      const badgeRect = {
        left: bounds.right - 150,
        right: bounds.right,
        top,
        bottom: top + lineHeight
      };
      if (nativeOverlayRects.some((rect) => rectsOverlap(rect, badgeRect))) continue;
      const element = document.createElement("span");
      element.textContent = badge.label;
      element.style.cssText = ["position:absolute", "right:8px", `top:${Math.round(top - bounds.top + 2)}px`, "padding:1px 4px", "border-radius:3px", "background:rgba(255,255,255,.72)", "color:#7b8493", "white-space:nowrap", "font-variant-numeric:tabular-nums"].join(";");
      layer.appendChild(element);
    }
  }

  function scheduleOverlayRender() {
    if (overlayFramePending) return;
    overlayFramePending = true;
    window.requestAnimationFrame(() => { overlayFramePending = false; renderSourceNumberBadges(); });
  }

  function refreshStructureCache(state, immediate = false) {
    lastEditorState = state || lastEditorState;
    if (!lastEditorState) return;
    const source = lastEditorState.value;
    if (source === cachedStructureSource) { scheduleOverlayRender(); return; }
    window.clearTimeout(structureRefreshTimer);
    const update = () => {
      structureRefreshTimer = 0;
      if (!lastEditorState) return;
      cachedStructureSource = lastEditorState.value;
      try {
        cachedStructures = sourceNumberBadges(cachedStructureSource);
      } catch (error) {
        console.warn("SmartTeX structure highlighting failed without disabling previews:", error);
        cachedStructures = { badges: [], highlights: [] };
      }
      scheduleOverlayRender();
    };
    if (immediate || cachedStructureSource === null) update();
    else structureRefreshTimer = window.setTimeout(update, 140);
  }

  window.addEventListener("smarttex:structure-highlight-settings", (event) => {
    const detail = event?.detail || {};
    structureHighlightSettings = {
      ...structureHighlightSettings,
      ...detail,
      environmentEnabled: detail.environmentEnabled !== undefined
        ? detail.environmentEnabled !== false
        : (detail.enabled !== undefined
          ? detail.enabled !== false
          : structureHighlightSettings.environmentEnabled),
      environmentColor: normalizedHighlightColor(detail.environmentColor || detail.color || structureHighlightSettings.environmentColor),
      captionColor: normalizedHighlightColor(detail.captionColor || structureHighlightSettings.captionColor),
      labelColor: normalizedHighlightColor(detail.labelColor || structureHighlightSettings.labelColor),
      referenceColor: normalizedHighlightColor(detail.referenceColor || structureHighlightSettings.referenceColor),
      nonumberColor: normalizedHighlightColor(detail.nonumberColor || structureHighlightSettings.nonumberColor),
      inlineMathColor: normalizedHighlightColor(detail.inlineMathColor || structureHighlightSettings.inlineMathColor)
    };
    scheduleOverlayRender();
  });

  function looksLikeCodeMirrorView(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      value.state?.doc &&
      typeof value.state.doc.toString === "function" &&
      typeof value.dispatch === "function"
    );
  }

  function discoverCodeMirrorView(value, depth = 0, seen = new Set()) {
    if (!value || depth > 3 || (typeof value !== "object" && typeof value !== "function")) {
      return null;
    }
    if (looksLikeCodeMirrorView(value)) return value;
    if (seen.has(value)) return null;
    seen.add(value);

    const preferredKeys = [
      "view",
      "editorView",
      "cmView",
      "editor",
      "_view",
      "rootView",
      "docView"
    ];
    for (const key of preferredKeys) {
      try {
        const found = discoverCodeMirrorView(value[key], depth + 1, seen);
        if (found) return found;
      } catch (_error) {
        // Framework-owned properties may use guarded accessors.
      }
    }

    if (depth >= 2) return null;
    let keys = [];
    try {
      keys = Object.getOwnPropertyNames(value).slice(0, 80);
    } catch (_error) {
      return null;
    }
    for (const key of keys) {
      if (preferredKeys.includes(key)) continue;
      try {
        const found = discoverCodeMirrorView(value[key], depth + 1, seen);
        if (found) return found;
      } catch (_error) {
        // Continue with the next discoverable property.
      }
    }
    return null;
  }

  function findCodeMirrorEditor() {
    const roots = [
      document.querySelector("#ide-redesign-panel-source-editor .cm-editor"),
      document.querySelector(".ide-redesign-editor-container .cm-editor"),
      document.querySelector(".cm-editor")
    ].filter(Boolean);

    for (const root of roots) {
      const content = root.querySelector(".cm-content");
      const candidates = [
        root.cmView?.view,
        root.cmView,
        root.editorView,
        root.view,
        content?.cmView?.view,
        content?.cmView,
        content?.editorView,
        content?.view
      ];
      for (const candidate of candidates) {
        if (looksLikeCodeMirrorView(candidate)) return candidate;
      }
      const discovered = discoverCodeMirrorView(content || root);
      if (discovered) return discovered;
    }
    return null;
  }

  function findAceEditor() {
    const candidates = [
      document.querySelector("#editor .ace_editor:not(.ace_autocomplete)"),
      document.querySelector("#editor.ace_editor"),
      document.querySelector(".ace-editor-body.ace_editor:not(.ace_autocomplete)")
    ].filter(Boolean);

    for (const element of candidates) {
      if (element.env?.editor) return element.env.editor;
      if (window.ace?.edit) {
        try {
          return window.ace.edit(element);
        } catch (_error) {
          // The next element may be the actual editor.
        }
      }
    }
    return null;
  }

  function findEditor() {
    const codeMirror = findCodeMirrorEditor();
    if (codeMirror) return { kind: "codemirror", editor: codeMirror };
    const ace = findAceEditor();
    return ace ? { kind: "ace", editor: ace } : null;
  }

  function selectedFileName() {
    const selected = document.querySelector(
      '.file-tree-list [role="treeitem"][aria-selected="true"], ' +
      '.file-tree-list li.selected[role="treeitem"]'
    );
    const fileName = (
      selected?.getAttribute("aria-label") ||
      selected?.querySelector(".item-name-button span")?.textContent ||
      selected?.querySelector(".item-name span")?.textContent ||
      selected?.querySelector(".entity-name span")?.textContent ||
      ""
    ).trim();
    if (fileName) return fileName;

    const breadcrumb = document.querySelector(".ol-cm-breadcrumbs > div");
    return breadcrumb?.textContent?.trim() || "";
  }

  function normalizedProjectPath(value) {
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/\/+/g, "/")
      .toLowerCase();
  }

  function pathStem(value) {
    return normalizedProjectPath(value).replace(/\.[a-z0-9]{1,8}$/i, "");
  }

  function projectPathMatches(leftValue, rightValue) {
    const left = normalizedProjectPath(leftValue);
    const right = normalizedProjectPath(rightValue);
    if (!left || !right) return false;
    const leftName = left.split("/").pop();
    const rightName = right.split("/").pop();
    return (
      left === right ||
      leftName === rightName ||
      pathStem(left) === pathStem(right) ||
      pathStem(leftName) === pathStem(rightName)
    );
  }

  function treeItemPath(item) {
    return String(
      item?.getAttribute("data-path") ||
      item?.getAttribute("data-file-path") ||
      item?.getAttribute("aria-label") ||
      item?.querySelector(
        ".item-name-button span, .item-name span, .entity-name span, [data-testid*='file-name']"
      )?.textContent ||
      ""
    ).trim();
  }

  function likelyFileId(value) {
    const text = String(value || "").trim();
    if (/^[a-f0-9]{24}$/i.test(text) || /^[a-f0-9-]{32,40}$/i.test(text)) {
      return text;
    }
    const embedded = text.match(/[a-f0-9]{24}/i)?.[0];
    return embedded || "";
  }

  function textFromProjectEntity(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return "";
    }
    const candidates = [];
    try {
      candidates.push(
        value.lines,
        value.content,
        value.text,
        value.source,
        value.doc?.lines,
        value.doc?.content,
        value.doc?.text,
        value.document?.lines,
        value.document?.content,
        value.document?.text
      );
    } catch (_error) {
      return "";
    }
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.every((line) => typeof line === "string")) {
        return candidate.join("\n");
      }
      if (typeof candidate === "string" && candidate.length) return candidate;
      if (candidate && typeof candidate.toString === "function") {
        const typeName = String(candidate.constructor?.name || "");
        if (!/(?:Text|Doc|Rope|Content)/i.test(typeName)) continue;
        try {
          const text = candidate.toString();
          if (typeof text === "string" && text && text !== "[object Object]") return text;
        } catch (_error) {
          // Continue with the remaining representations.
        }
      }
    }
    return "";
  }

  function entityFromReactValue(root, targetPath) {
    const seen = new Set();
    const budget = { remaining: 5000 };
    const visit = (value, depth) => {
      if (
        !value ||
        depth > 8 ||
        budget.remaining-- <= 0 ||
        (typeof value !== "object" && typeof value !== "function") ||
        seen.has(value)
      ) {
        return null;
      }
      seen.add(value);
      let name = "";
      let id = "";
      let url = "";
      try {
        name = value.path || value.filePath || value.name || value.fileName || "";
        id = (
          value._id ||
          value.fileId ||
          value.entityId ||
          value.id ||
          value.file?._id ||
          value.entity?._id ||
          ""
        );
        url = value.downloadUrl || value.downloadURL || value.url || "";
      } catch (_error) {
        // Continue through accessible child properties.
      }
      if (projectPathMatches(name, targetPath)) {
        const fileId = likelyFileId(id);
        const text = textFromProjectEntity(value);
        let entityType = "";
        try {
          entityType = String(
            value.type || value.kind || value.entityType || value._type || ""
          );
        } catch (_error) {
          // Type metadata is optional.
        }
        if (fileId || url || text) {
          return { fileId, url: String(url || ""), text, entityType };
        }
      }

      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(value).slice(0, 120);
      } catch (_error) {
        return null;
      }
      const preferred = [
        "file",
        "entity",
        "item",
        "node",
        "data",
        "props",
        "memoizedProps",
        "pendingProps",
        "memoizedState",
        "children",
        "rootFolder",
        "child",
        "sibling"
      ];
      keys.sort((left, right) => (
        (
          preferred.indexOf(left) < 0
            ? preferred.length
            : preferred.indexOf(left)
        ) - (
          preferred.indexOf(right) < 0
            ? preferred.length
            : preferred.indexOf(right)
        )
      ));
      for (const key of keys) {
        if (["window", "ownerDocument", "parentNode"].includes(key)) continue;
        try {
          const found = visit(value[key], depth + 1);
          if (found) return found;
        } catch (_error) {
          // React-owned properties can contain guarded accessors.
        }
      }
      return null;
    };
    return visit(root, 0);
  }

  function visibleProjectFile(targetPath) {
    const items = [...document.querySelectorAll('.file-tree-list [role="treeitem"]')];
    const normalizedTarget = normalizedProjectPath(targetPath);
    return items.find((candidate) => (
      normalizedProjectPath(treeItemPath(candidate)) === normalizedTarget
    )) || items.find((candidate) => (
      projectPathMatches(treeItemPath(candidate), targetPath)
    )) || null;
  }

  function reactProjectFile(targetPath, item = null) {
    const roots = [
      item,
      item?.closest(".file-tree-list"),
      document.querySelector(".file-tree-list"),
      document.querySelector("#ide-root"),
      document.querySelector("[data-testid='ide-root']")
    ].filter(Boolean);
    for (const root of roots) {
      const reactKeys = Object.getOwnPropertyNames(root).filter((key) => (
        /^__(?:react|preact|vue)/i.test(key) || /fiber|props/i.test(key)
      ));
      for (const key of reactKeys) {
        const entity = entityFromReactValue(root[key], targetPath);
        if (entity) return entity;
      }
    }
    const globalNames = Object.getOwnPropertyNames(window).filter((key) => (
      /^(?:project|ide|editor|fileTree|fileStore|rootFolder)$/i.test(key) ||
      /^OLProject/i.test(key)
    ));
    for (const key of globalNames) {
      try {
        const entity = entityFromReactValue(window[key], targetPath);
        if (entity) return entity;
      } catch (_error) {
        // Some page globals expose guarded accessors.
      }
    }
    return null;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function revealProjectFile(targetPath) {
    let item = visibleProjectFile(targetPath);
    if (item) return item;
    for (let pass = 0; pass < 4; pass += 1) {
      const collapsedItems = [...document.querySelectorAll(
        '.file-tree-list [role="treeitem"][aria-expanded="false"]'
      )];
      const expandButtons = collapsedItems.map((collapsed) => (
        collapsed.querySelector(
          'button[aria-label*="Expand" i], button[title*="Expand" i], ' +
          '[data-testid*="expand"]'
        )
      )).filter(Boolean);
      if (!expandButtons.length) break;
      for (const button of expandButtons) button.click();
      await delay(120);
      item = visibleProjectFile(targetPath);
      if (item) return item;
    }
    return null;
  }

  async function resolveProjectFile(pathValue) {
    const targetPath = String(pathValue || "").trim();
    if (!targetPath) return null;
    let item = visibleProjectFile(targetPath);
    let reactEntity = reactProjectFile(targetPath, item);
    if (!item && !reactEntity) {
      item = await revealProjectFile(targetPath);
      reactEntity = reactProjectFile(targetPath, item);
    }
    const explicit = (
      item?.getAttribute("data-download-url") ||
      item?.getAttribute("data-url") ||
      item?.querySelector("a[href]")?.href ||
      ""
    ).trim();
    if (explicit) {
      return {
        url: new URL(explicit, window.location.href).href,
        path: treeItemPath(item),
        text: reactEntity?.text || "",
        entityType: reactEntity?.entityType || ""
      };
    }
    const attributeId = likelyFileId(
      item?.getAttribute("data-file-id") ||
      item?.getAttribute("data-entity-id") ||
      item?.getAttribute("data-id") ||
      item?.getAttribute("data-rbd-draggable-id") ||
      item?.id ||
      ""
    );
    const fileId = attributeId || reactEntity?.fileId || "";
    const explicitReactUrl = String(reactEntity?.url || "").trim();
    if (explicitReactUrl) {
      return {
        url: new URL(explicitReactUrl, window.location.href).href,
        fileId,
        path: treeItemPath(item) || targetPath,
        text: reactEntity?.text || "",
        entityType: reactEntity?.entityType || ""
      };
    }
    const projectId = window.location.pathname.match(/\/project\/([^/?#]+)/i)?.[1] || "";
    if (!projectId || !fileId) {
      return reactEntity?.text ? {
        url: "",
        fileId,
        path: treeItemPath(item) || targetPath,
        text: reactEntity.text,
        entityType: reactEntity.entityType || ""
      } : null;
    }
    return {
      url: `${window.location.origin}/project/${encodeURIComponent(projectId)}/file/${encodeURIComponent(fileId)}`,
      fileId,
      path: treeItemPath(item) || targetPath,
      text: reactEntity?.text || "",
      entityType: reactEntity?.entityType || ""
    };
  }

  function projectIdFromLocation() {
    return window.location.pathname.match(/\/project\/([^/?#]+)/i)?.[1] || "";
  }

  function documentTextFromPayload(payload) {
    const seen = new Set();
    const budget = { remaining: 800 };
    const visit = (value, depth = 0) => {
      if (
        value == null ||
        depth > 8 ||
        budget.remaining-- <= 0 ||
        (typeof value === "object" && seen.has(value))
      ) {
        return "";
      }
      if (typeof value === "string") return value;
      if (Array.isArray(value)) {
        if (value.every((line) => typeof line === "string")) return value.join("\n");
        for (const item of value) {
          const text = visit(item, depth + 1);
          if (text) return text;
        }
        return "";
      }
      if (typeof value !== "object") return "";
      seen.add(value);
      const preferred = [
        "lines", "content", "text", "source", "snapshot", "doc", "document",
        "data", "value"
      ];
      for (const key of preferred) {
        let child;
        try {
          child = value[key];
        } catch (_error) {
          continue;
        }
        const text = visit(child, depth + 1);
        if (text) return text;
      }
      return "";
    };
    return visit(payload);
  }

  function responseIsHtml(contentType, text) {
    return (
      /text\/html/i.test(String(contentType || "")) ||
      /^\s*<!doctype\s+html/i.test(String(text || "")) ||
      /^\s*<html[\s>]/i.test(String(text || ""))
    );
  }

  async function fetchProjectDocumentText(projectId, documentId) {
    if (!projectId || !documentId) return "";
    const urls = [
      `/project/${encodeURIComponent(projectId)}/doc/${encodeURIComponent(documentId)}`,
      `/project/${encodeURIComponent(projectId)}/doc/${encodeURIComponent(documentId)}?format=json`
    ];
    for (const url of urls) {
      let response;
      try {
        response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          headers: {
            Accept: "application/json, text/plain;q=0.9, */*;q=0.1",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
          }
        });
      } catch (_error) {
        continue;
      }
      if (!response.ok) continue;
      const contentType = String(response.headers?.get?.("content-type") || "");
      const raw = await response.text();
      if (!raw || responseIsHtml(contentType, raw)) continue;
      if (/json/i.test(contentType) || /^[\s\ufeff]*[\[{]/.test(raw)) {
        try {
          const text = documentTextFromPayload(JSON.parse(raw));
          if (text) return text;
        } catch (_error) {
          // Some installations return the source directly despite a JSON-like prefix.
        }
      }
      if (raw) return raw;
    }
    return "";
  }

  function findZipEndOfCentralDirectory(bytes) {
    const minimum = Math.max(0, bytes.length - 0xffff - 22);
    for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
      if (
        bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b &&
        bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06
      ) {
        return offset;
      }
    }
    return -1;
  }

  function decodeZipName(bytes, utf8) {
    try {
      return new TextDecoder(utf8 ? "utf-8" : "windows-1252").decode(bytes);
    } catch (_error) {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }

  async function inflateZipEntry(compressed, method) {
    if (method === 0) return compressed;
    if (method !== 8) {
      throw new Error(`Unsupported ZIP compression method ${method}.`);
    }
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot decompress the project ZIP in the background.");
    }
    const stream = new Blob([compressed]).stream().pipeThrough(
      new DecompressionStream("deflate-raw")
    );
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function extractProjectZipText(buffer, targetPath) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findZipEndOfCentralDirectory(bytes);
    if (eocd < 0) throw new Error("The downloaded project archive is not a valid ZIP file.");
    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const normalizedTarget = normalizedProjectPath(targetPath);
    const targetName = normalizedTarget.split("/").pop();
    const candidates = [];

    for (let entry = 0; entry < entryCount; entry += 1) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error("The project ZIP central directory is malformed.");
      }
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      if (
        compressedSize === 0xffffffff || uncompressedSize === 0xffffffff ||
        localOffset === 0xffffffff
      ) {
        throw new Error("ZIP64 project archives are not supported for background parsing.");
      }
      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;
      const name = decodeZipName(bytes.subarray(nameStart, nameEnd), Boolean(flags & 0x0800));
      const normalizedName = normalizedProjectPath(name);
      if (normalizedName && !normalizedName.endsWith("/")) {
        const exact = normalizedName === normalizedTarget;
        const basename = normalizedName.split("/").pop() === targetName;
        if (exact || basename) {
          candidates.push({
            exact,
            name,
            normalizedName,
            method,
            compressedSize,
            uncompressedSize,
            localOffset
          });
        }
      }
      offset = nameEnd + extraLength + commentLength;
    }

    const exact = candidates.find((candidate) => candidate.exact);
    const basenameCandidates = candidates.filter((candidate) => !candidate.exact);
    const selected = exact || (basenameCandidates.length === 1 ? basenameCandidates[0] : null);
    if (!selected) {
      if (basenameCandidates.length > 1) {
        throw new Error(`Several project files match ${targetPath}; use its full project path.`);
      }
      throw new Error(`Project file not found in the background archive: ${targetPath}.`);
    }
    const localOffset = selected.localOffset;
    if (
      localOffset + 30 > bytes.length ||
      view.getUint32(localOffset, true) !== 0x04034b50
    ) {
      throw new Error(`The ZIP entry for ${selected.name} is malformed.`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + selected.compressedSize;
    if (dataEnd > bytes.length) throw new Error(`The ZIP entry for ${selected.name} is truncated.`);
    const inflated = await inflateZipEntry(bytes.subarray(dataStart, dataEnd), selected.method);
    if (selected.uncompressedSize && inflated.length !== selected.uncompressedSize) {
      throw new Error(`The ZIP entry for ${selected.name} has an unexpected size.`);
    }
    return {
      value: new TextDecoder("utf-8").decode(inflated),
      fileName: selected.name
    };
  }

  let projectArchiveCache = null;

  async function fetchProjectArchive(projectId) {
    const cacheKey = `${window.location.origin}:${projectId}`;
    const now = Date.now();
    if (
      projectArchiveCache?.key === cacheKey &&
      now - projectArchiveCache.createdAt < 5000
    ) {
      return projectArchiveCache.promise;
    }
    const promise = (async () => {
      const url = `/project/${encodeURIComponent(projectId)}/download/zip`;
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/zip, application/octet-stream;q=0.9, */*;q=0.1",
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        }
      });
      if (!response.ok) {
        throw new Error(`Could not download the project archive (HTTP ${response.status}).`);
      }
      const buffer = await response.arrayBuffer();
      const signature = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
      if (
        signature.length < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b
      ) {
        throw new Error("The project archive endpoint did not return a ZIP file.");
      }
      return buffer;
    })();
    projectArchiveCache = { key: cacheKey, createdAt: now, promise };
    try {
      return await promise;
    } catch (error) {
      if (projectArchiveCache?.promise === promise) projectArchiveCache = null;
      throw error;
    }
  }

  let projectTextReadQueue = Promise.resolve();

  async function readProjectTextFileNow(pathValue) {
    const targetPath = String(pathValue || "").trim();
    if (!targetPath) throw new Error("No project-file path was supplied.");

    const current = getEditorState();
    if (current && projectPathMatches(current.fileName, targetPath)) {
      return { value: current.value, fileName: current.fileName || targetPath };
    }

    // Read from the page's project model when it already contains a snapshot.
    // This is entirely passive and never selects or opens the target document.
    const item = visibleProjectFile(targetPath);
    const entity = reactProjectFile(targetPath, item);
    if (typeof entity?.text === "string" && entity.text) {
      return { value: entity.text, fileName: treeItemPath(item) || targetPath };
    }

    const projectId = projectIdFromLocation();
    if (!projectId) throw new Error(`Could not determine the project for ${targetPath}.`);

    // Editable CollabTeX files are collaborative documents, not binary files.
    // Try the document endpoint first; unlike selecting the tree item, this
    // leaves the active editor document and cursor completely untouched.
    const documentId = likelyFileId(entity?.fileId || "");
    if (documentId) {
      const text = await fetchProjectDocumentText(projectId, documentId);
      if (text) return { value: text, fileName: treeItemPath(item) || targetPath };
    }

    // Some deployments do not expose a readable document endpoint. Download
    // the project archive in memory and extract only the requested text file.
    // No project-tree item is clicked and the editor is never switched.
    const archive = await fetchProjectArchive(projectId);
    return extractProjectZipText(archive, targetPath);
  }

  function readProjectTextFile(pathValue) {
    const operation = projectTextReadQueue.then(
      () => readProjectTextFileNow(pathValue),
      () => readProjectTextFileNow(pathValue)
    );
    projectTextReadQueue = operation.catch(() => {});
    return operation;
  }

  function acePositionToIndex(session, position) {
    return session?.doc?.positionToIndex?.(position, 0) || 0;
  }

  function aceScreenPosition(position) {
    if (!editor || !position) return null;
    const coordinates = editor.renderer?.textToScreenCoordinates?.(
      position.row,
      position.column
    );
    if (!coordinates) return null;
    return {
      pageX: Number(coordinates.pageX) || 0,
      pageY: Number(coordinates.pageY) || 0,
      lineHeight: Number(editor.renderer?.lineHeight) || 16
    };
  }

  function codeMirrorScreenPosition(index) {
    if (!editor || editorKind !== "codemirror") return null;
    const bounded = Math.max(0, Math.min(Number(index) || 0, editor.state.doc.length));
    const coordinates = editor.coordsAtPos?.(bounded, 1) || editor.coordsAtPos?.(bounded);
    if (!coordinates) return null;
    return {
      pageX: coordinates.left + window.scrollX,
      pageY: coordinates.top + window.scrollY,
      lineHeight: Math.max(14, coordinates.bottom - coordinates.top)
    };
  }

  function editorIndexAtCoordinates(clientXValue, clientYValue) {
    if (!editor) return null;
    const clientX = Number(clientXValue) || 0;
    const clientY = Number(clientYValue) || 0;
    if (editorKind === "codemirror") {
      const index = editor.posAtCoords?.({ x: clientX, y: clientY }, true);
      if (!Number.isFinite(index)) return null;
      return Math.max(0, Math.min(index, editor.state.doc.length));
    }

    const coordinates = editor.renderer?.screenToTextCoordinates?.(
      clientX + window.scrollX,
      clientY + window.scrollY
    );
    const session = editor.getSession?.();
    if (!coordinates || !session) return null;
    return Math.max(
      0,
      Math.min(
        acePositionToIndex(session, coordinates),
        session.getValue().length
      )
    );
  }

  function codeMirrorContent(view) {
    return view?.contentDOM || view?.dom?.querySelector?.(".cm-content") || null;
  }

  function getEditorState() {
    if (!editor) return null;

    if (editorKind === "codemirror") {
      const value = editor.state.doc.toString();
      const selection = editor.state.selection?.main;
      const cursorIndex = Number(selection?.head ?? 0);
      const line = editor.state.doc.lineAt(
        Math.max(0, Math.min(cursorIndex, editor.state.doc.length))
      );
      const content = codeMirrorContent(editor);
      return {
        value,
        cursorIndex,
        cursor: {
          row: line.number - 1,
          column: cursorIndex - line.from
        },
        selectionFrom: Number(selection?.from ?? cursorIndex),
        selectionTo: Number(selection?.to ?? cursorIndex),
        selectionAnchor: Number(selection?.anchor ?? selection?.from ?? cursorIndex),
        selectionHead: Number(selection?.head ?? cursorIndex),
        screen: codeMirrorScreenPosition(cursorIndex),
        fileName: selectedFileName(),
        focused: Boolean(editor.hasFocus || (content && content.contains(document.activeElement))),
        editorKind
      };
    }

    const session = editor.getSession();
    const cursor = editor.getCursorPosition();
    const selection = editor.getSelectionRange?.();
    const cursorIndex = acePositionToIndex(session, cursor);
    return {
      value: session.getValue(),
      cursorIndex,
      cursor,
      selectionFrom: selection ? acePositionToIndex(session, selection.start) : cursorIndex,
      selectionTo: selection ? acePositionToIndex(session, selection.end) : cursorIndex,
      selectionAnchor: selection
        ? acePositionToIndex(
          session,
          editor.selection?.isBackwards?.() ? selection.end : selection.start
        )
        : cursorIndex,
      selectionHead: cursorIndex,
      screen: aceScreenPosition(cursor),
      fileName: selectedFileName(),
      focused: Boolean(editor.isFocused?.()),
      editorKind
    };
  }

  function codeMirrorReadOnly(view) {
    const content = codeMirrorContent(view);
    return content?.getAttribute?.("contenteditable") !== "true";
  }

  function replaceRange(startValue, endValue, textValue, options = {}) {
    if (!editor) return false;
    const text = String(textValue ?? "");
    if (editorKind === "codemirror") {
      if (codeMirrorReadOnly(editor)) return false;
      const docLength = editor.state.doc.length;
      const start = Math.max(0, Math.min(Number(startValue) || 0, docLength));
      const end = Math.max(start, Math.min(Number(endValue) || 0, docLength));
      const selectionStart = Math.max(
        start,
        Math.min(
          Number(options.selectionStart ?? start + text.length),
          start + text.length
        )
      );
      const selectionEnd = Math.max(
        start,
        Math.min(
          Number(options.selectionEnd ?? selectionStart),
          start + text.length
        )
      );
      editor.dispatch({
        changes: { from: start, to: end, insert: text },
        selection: { anchor: selectionStart, head: selectionEnd },
        scrollIntoView: true
      });
      if (options.focus !== false) editor.focus();
      scheduleState();
      return true;
    }

    if (editor.getReadOnly?.()) return false;
    const session = editor.getSession();
    const start = Math.max(0, Math.min(Number(startValue) || 0, session.getValue().length));
    const end = Math.max(start, Math.min(Number(endValue) || 0, session.getValue().length));
    const startPosition = session.doc.indexToPosition(start, 0);
    const endPosition = session.doc.indexToPosition(end, 0);
    const Range = window.ace?.require?.("ace/range")?.Range;
    if (!Range) return false;
    session.replace(
      new Range(startPosition.row, startPosition.column, endPosition.row, endPosition.column),
      text
    );
    const selectionStart = Math.max(
      start,
      Math.min(
        Number(options.selectionStart ?? start + text.length),
        start + text.length
      )
    );
    const selectionEnd = Math.max(
      start,
      Math.min(
        Number(options.selectionEnd ?? selectionStart),
        start + text.length
      )
    );
    const nextStart = session.doc.indexToPosition(selectionStart, 0);
    const nextEnd = session.doc.indexToPosition(selectionEnd, 0);
    editor.selection.setSelectionRange(
      new Range(nextStart.row, nextStart.column, nextEnd.row, nextEnd.column)
    );
    if (options.focus !== false) editor.focus();
    scheduleState();
    return true;
  }

  function setCursorIndex(indexValue, focusEditor = true) {
    if (!editor) return false;
    if (editorKind === "codemirror") {
      const index = Math.max(
        0,
        Math.min(Number(indexValue) || 0, editor.state.doc.length)
      );
      editor.dispatch({
        selection: { anchor: index },
        scrollIntoView: true
      });
      if (focusEditor) editor.focus();
      scheduleState();
      return true;
    }

    const session = editor.getSession();
    const index = Math.max(
      0,
      Math.min(Number(indexValue) || 0, session.getValue().length)
    );
    const position = session.doc.indexToPosition(index, 0);
    editor.selection.moveCursorToPosition(position);
    editor.clearSelection();
    if (focusEditor) editor.focus();
    editor.renderer?.scrollCursorIntoView?.(position, 0.5);
    scheduleState();
    return true;
  }

  function moveCursorVertical(directionValue) {
    if (!editor) return false;
    const direction = Number(directionValue) < 0 ? -1 : 1;
    if (editorKind === "codemirror") {
      const selection = editor.state.selection?.main;
      const head = Number(selection?.head ?? 0);
      const currentLine = editor.state.doc.lineAt(
        Math.max(0, Math.min(head, editor.state.doc.length))
      );
      const targetNumber = Math.max(
        1,
        Math.min(editor.state.doc.lines, currentLine.number + direction)
      );
      if (targetNumber === currentLine.number) return true;
      const targetLine = editor.state.doc.line(targetNumber);
      const column = head - currentLine.from;
      const target = Math.min(targetLine.to, targetLine.from + column);
      editor.dispatch({
        selection: { anchor: target },
        scrollIntoView: true
      });
      editor.focus?.();
      scheduleState();
      return true;
    }

    editor.clearSelection?.();
    if (direction < 0) editor.navigateUp?.(1);
    else editor.navigateDown?.(1);
    editor.focus?.();
    editor.renderer?.scrollCursorIntoView?.(editor.getCursorPosition?.(), 0.5);
    scheduleState();
    return true;
  }

  function setSelectionRange(anchorValue, headValue, focusEditor = true) {
    if (!editor) return false;
    if (editorKind === "codemirror") {
      const length = editor.state.doc.length;
      const anchor = Math.max(0, Math.min(Number(anchorValue) || 0, length));
      const head = Math.max(0, Math.min(Number(headValue) || 0, length));
      editor.dispatch({
        selection: { anchor, head },
        scrollIntoView: true
      });
      if (focusEditor) editor.focus();
      scheduleState();
      return true;
    }

    const session = editor.getSession();
    const length = session.getValue().length;
    const anchor = Math.max(0, Math.min(Number(anchorValue) || 0, length));
    const head = Math.max(0, Math.min(Number(headValue) || 0, length));
    const Range = window.ace?.require?.("ace/range")?.Range;
    if (!Range) return false;
    const startIndex = Math.min(anchor, head);
    const endIndex = Math.max(anchor, head);
    const start = session.doc.indexToPosition(startIndex, 0);
    const end = session.doc.indexToPosition(endIndex, 0);
    editor.selection.setSelectionRange(
      new Range(start.row, start.column, end.row, end.column),
      anchor > head
    );
    if (focusEditor) editor.focus();
    editor.renderer?.scrollCursorIntoView?.(
      session.doc.indexToPosition(head, 0),
      0.5
    );
    scheduleState();
    return true;
  }

  function completionTokenAtCursor(pattern) {
    const state = getEditorState();
    if (!state) return null;
    const beforeCursor = state.value.slice(0, state.cursorIndex);
    const match = beforeCursor.match(pattern);
    if (!match) return null;
    const argument = match[1];
    const lastComma = argument.lastIndexOf(",");
    const beforeFragment = argument.slice(lastComma + 1);
    const leadingWhitespace = beforeFragment.match(/^\s*/)?.[0] || "";
    const start = state.cursorIndex - beforeFragment.length + leadingWhitespace.length;
    const afterFragment = state.value.slice(state.cursorIndex).match(/^[^,{}\s]*/)?.[0] || "";
    return {
      start,
      end: state.cursorIndex + afterFragment.length,
      fragment: beforeFragment.slice(leadingWhitespace.length) + afterFragment
    };
  }

  function replaceCompletionToken(pattern, text) {
    const token = completionTokenAtCursor(pattern);
    if (!token || !replaceRange(token.start, token.end, text)) return null;
    return token;
  }

  function nativeAutocompleteSuppressed() {
    return citationAutocompleteActive || referenceAutocompleteActive;
  }

  function hideNativeAutocomplete() {
    if (!nativeAutocompleteSuppressed()) return;
    if (editorKind === "ace") {
      try {
        editor?.completer?.detach?.();
        editor?.completer?.popup?.hide?.();
      } catch (_error) {
        // ACE autocomplete APIs vary between editor releases.
      }
    }
    document.body?.classList.add(
      "smarttex-citation-autocomplete-active",
      "smarttex-custom-autocomplete-active"
    );
  }

  function synchronizeAutocompleteSuppression() {
    const active = nativeAutocompleteSuppressed();
    document.body?.classList.toggle("smarttex-citation-autocomplete-active", active);
    document.body?.classList.toggle("smarttex-custom-autocomplete-active", active);
    if (active) hideNativeAutocomplete();
  }

  function setCitationAutocompleteActive(value) {
    citationAutocompleteActive = Boolean(value);
    synchronizeAutocompleteSuppression();
  }

  function setReferenceAutocompleteActive(value) {
    referenceAutocompleteActive = Boolean(value);
    synchronizeAutocompleteSuppression();
  }

  function citationResponse(requestId, ok, payload = {}) {
    window.dispatchEvent(new CustomEvent(CITATION_RESPONSE_EVENT, {
      detail: JSON.stringify({ requestId, ok, ...payload })
    }));
  }

  function stateFingerprint(state) {
    if (!state) return "";
    return [
      state.fileName,
      state.cursorIndex,
      state.selectionFrom,
      state.selectionTo,
      state.focused ? "1" : "0",
      state.value.length,
      state.value.slice(Math.max(0, state.cursorIndex - 220), state.cursorIndex + 120)
    ].join("\n");
  }

  function emitState() {
    scheduledState = false;
    const state = getEditorState();
    if (!state) return;
    lastFingerprint = stateFingerprint(state);
    lastEditorState = state;
    window.dispatchEvent(new CustomEvent(STATE_EVENT, {
      detail: JSON.stringify(state)
    }));
    refreshStructureCache(state);
  }

  function scheduleState() {
    if (scheduledState) return;
    scheduledState = true;
    window.requestAnimationFrame(emitState);
  }

  function cleanupCodeMirrorBinding() {
    if (typeof codeMirrorCleanup === "function") codeMirrorCleanup();
    codeMirrorCleanup = null;
  }

  function bindCodeMirror(view) {
    cleanupCodeMirrorBinding();
    const content = codeMirrorContent(view);
    const root = view.dom || content?.closest?.(".cm-editor");
    const scroller = view.scrollDOM || root?.querySelector?.(".cm-scroller");
    const events = [
      "input",
      "keyup",
      "mouseup",
      "click",
      "focus",
      "blur",
      "paste",
      "cut",
      "compositionend"
    ];
    for (const eventName of events) {
      content?.addEventListener(eventName, scheduleState, true);
    }
    scroller?.addEventListener("scroll", scheduleOverlayRender, { passive: true });

    const selectionListener = () => {
      const selection = document.getSelection();
      if (selection?.anchorNode && content?.contains(selection.anchorNode)) scheduleState();
    };
    document.addEventListener("selectionchange", selectionListener, true);

    const observer = new MutationObserver(scheduleState);
    if (root) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-selected"]
      });
    }

    codeMirrorCleanup = () => {
      for (const eventName of events) {
        content?.removeEventListener(eventName, scheduleState, true);
      }
      scroller?.removeEventListener("scroll", scheduleOverlayRender);
      document.removeEventListener("selectionchange", selectionListener, true);
      observer.disconnect();
    };
  }

  function bindAceSession(session) {
    if (!session || session === boundSession) return;
    if (boundSession) {
      try {
        boundSession.off("change", scheduleState);
      } catch (_error) {
        // The old editor session may already be disposed.
      }
    }
    boundSession = session;
    boundSession.on("change", scheduleState);
  }

  function bindEditor(found) {
    if (!found?.editor) return;
    if (found.editor === editor && found.kind === editorKind) return;

    cleanupCodeMirrorBinding();
    editor = found.editor;
    editorKind = found.kind;
    boundSession = null;

    if (editorKind === "codemirror") {
      bindCodeMirror(editor);
      scheduleState();
      return;
    }

    bindAceSession(editor.getSession());
    editor.selection?.on?.("changeCursor", scheduleState);
    editor.selection?.on?.("changeSelection", scheduleState);
    editor.on?.("changeSession", () => {
      bindAceSession(editor.getSession());
      scheduleState();
    });
    editor.on?.("focus", scheduleState);
    editor.on?.("blur", scheduleState);
    editor.renderer?.on?.("afterRender", scheduleOverlayRender);
    scheduleState();
  }

  window.addEventListener(CITATION_REQUEST_EVENT, async (event) => {
    let request = {};
    try {
      request = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      return;
    }
    const requestId = request.requestId;
    try {
      if (!editor) bindEditor(findEditor());
      if (request.type === "getState") {
        const state = getEditorState();
        citationResponse(requestId, Boolean(state), { state });
        return;
      }
      if (request.type === "getCoordinates") {
        const screen = editorKind === "codemirror"
          ? codeMirrorScreenPosition(Number(request.index))
          : (() => {
            const session = editor?.getSession?.();
            const position = session?.doc?.indexToPosition?.(
              Math.max(0, Math.min(Number(request.index) || 0, session.getValue().length)),
              0
            );
            return aceScreenPosition(position);
          })();
        citationResponse(requestId, Boolean(screen), { screen });
        return;
      }
      if (request.type === "getIndexAtCoordinates") {
        const index = editorIndexAtCoordinates(request.clientX, request.clientY);
        citationResponse(requestId, Number.isFinite(index), { index });
        return;
      }
      if (request.type === "replaceCitationToken") {
        const token = replaceCompletionToken(CITE_COMMAND, String(request.text ?? ""));
        citationResponse(requestId, Boolean(token), token ? { token } : {});
        return;
      }
      if (request.type === "replaceReferenceToken") {
        const token = replaceCompletionToken(REFERENCE_COMMAND, String(request.text ?? ""));
        citationResponse(requestId, Boolean(token), token ? { token } : {});
        return;
      }
      if (request.type === "setCitationAutocompleteActive") {
        setCitationAutocompleteActive(request.active);
        citationResponse(requestId, Boolean(editor), { active: citationAutocompleteActive });
        return;
      }
      if (request.type === "setReferenceAutocompleteActive") {
        setReferenceAutocompleteActive(request.active);
        citationResponse(requestId, Boolean(editor), { active: referenceAutocompleteActive });
        return;
      }
      if (request.type === "focus") {
        editor?.focus?.();
        citationResponse(requestId, Boolean(editor));
        return;
      }
      if (request.type === "setCursor") {
        const moved = setCursorIndex(request.index, request.focus !== false);
        citationResponse(requestId, moved, moved ? {
          index: Math.max(0, Number(request.index) || 0)
        } : {});
        return;
      }
      if (request.type === "resolveProjectFile") {
        const file = await resolveProjectFile(request.path);
        citationResponse(requestId, Boolean(file), file ? { file } : {
          error: `Project file not found: ${String(request.path || "")}`
        });
        return;
      }
      if (request.type === "readProjectTextFile") {
        const file = await readProjectTextFile(request.path);
        citationResponse(requestId, Boolean(file), file ? { file } : {
          error: `Project text file not found: ${String(request.path || "")}`
        });
        return;
      }
      if (request.type === "moveCursorVertical") {
        const moved = moveCursorVertical(request.direction);
        citationResponse(requestId, moved);
        return;
      }
      if (request.type === "setSelection") {
        const moved = setSelectionRange(
          request.anchor,
          request.head,
          request.focus !== false
        );
        citationResponse(requestId, moved, moved ? {
          anchor: Math.max(0, Number(request.anchor) || 0),
          head: Math.max(0, Number(request.head) || 0)
        } : {});
        return;
      }
      if (request.type === "replaceRange") {
        const replaced = replaceRange(
          request.start,
          request.end,
          request.text,
          {
            selectionStart: request.selectionStart,
            selectionEnd: request.selectionEnd,
            focus: request.focus !== false
          }
        );
        citationResponse(requestId, replaced);
        return;
      }
      citationResponse(requestId, false, {
        error: `Unknown SmartTeX citation request: ${request.type}`
      });
    } catch (error) {
      citationResponse(requestId, false, {
        error: error?.message || String(error)
      });
    }
  });

  const observer = new MutationObserver(() => {
    const found = findEditor();
    if (found) {
      bindEditor(found);
      // Opening or closing Ace/CodeMirror search panels does not necessarily
      // emit an editor render event, but it changes which annotation areas
      // must be masked.
      scheduleOverlayRender();
    }
    if (nativeAutocompleteSuppressed()) hideNativeAutocomplete();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const poll = window.setInterval(() => {
    const found = findEditor();
    if (found) bindEditor(found);
    const state = getEditorState();
    if (state && stateFingerprint(state) !== lastFingerprint) scheduleState();
  }, 250);

  window.addEventListener("pagehide", () => {
    window.clearInterval(poll);
    cleanupCodeMirrorBinding();
    observer.disconnect();
    numberBadgeLayer?.remove();
    numberBadgeLayer = null;
    setCitationAutocompleteActive(false);
    setReferenceAutocompleteActive(false);
  }, { once: true });

  bindEditor(findEditor());
})();
