/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.__smartTeXRenderedEditorBridgeLoaded) return;
  globalThis.__smartTeXRenderedEditorBridgeLoaded = true;

  const SETTINGS_EVENT = "smarttex:rendered-editor-settings";
  const ITEMS_EVENT = "smarttex:rendered-editor-items";
  const MEASURE_EVENT = "smarttex:rendered-editor-measure";
  const INLINE_LAYER_ID = "smarttex-rendered-editor-inline-layer";
  const COMMENT_GUTTER_CLASS = "smarttex-hidden-comment-gutter";

  // Wait for the isolated-world settings loader before transforming the editor.
  // This prevents a brief default-mode flash when the user has disabled either feature.
  let settings = { enabled: false, hideComments: false };
  let editor = null;
  let session = null;
  let boundSession = null;
  let widgetManager = null;
  let entries = [];
  let parsedItems = [];
  let parsedSource = "";
  let refreshTimer = 0;
  let refreshGeneration = 0;
  let positionFrame = 0;
  let editorObserver = null;
  let editorBindingsInstalled = false;
  const measuredInlineWidths = new Map();
  const expandedKeys = new Set();

  function findAceEditor() {
    const candidates = [
      document.querySelector("#editor .ace_editor:not(.ace_autocomplete)"),
      document.querySelector("#editor.ace_editor"),
      document.querySelector(".ace-editor-body.ace_editor:not(.ace_autocomplete)"),
      document.querySelector(".ace_editor:not(.ace_autocomplete)")
    ].filter(Boolean);
    for (const element of candidates) {
      if (element.env?.editor) return element.env.editor;
      if (globalThis.ace?.edit) {
        try {
          const candidate = globalThis.ace.edit(element);
          if (candidate?.getSession) return candidate;
        } catch (_error) {
          // Continue with the next editor element.
        }
      }
    }
    return null;
  }

  function rangeConstructor() {
    return globalThis.ace?.require?.("ace/range")?.Range || null;
  }

  function indexToPosition(index) {
    if (!session) return null;
    return session.doc.indexToPosition(
      Math.max(0, Math.min(Number(index) || 0, session.getValue().length)),
      0
    );
  }

  function positionToIndex(position) {
    return session?.doc?.positionToIndex?.(position, 0) || 0;
  }

  function editorSelectionIndexes() {
    if (!editor || !session) return { cursor: 0, from: 0, to: 0 };
    const cursor = positionToIndex(editor.getCursorPosition());
    const range = editor.getSelectionRange?.();
    if (!range) return { cursor, from: cursor, to: cursor };
    const from = positionToIndex(range.start);
    const to = positionToIndex(range.end);
    return { cursor, from: Math.min(from, to), to: Math.max(from, to) };
  }

  function sourceRangeContains(item, selection) {
    if (!item || !selection) return false;
    if (selection.from !== selection.to) {
      return selection.from < item.end && selection.to > item.start;
    }
    return selection.cursor >= item.start && selection.cursor < item.end;
  }

  function sourceHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function itemKey(kind, start, end, source) {
    return `${kind}:${start}:${end}:${sourceHash(String(source || "").slice(0, 180))}`;
  }

  function itemOverlaps(item, ranges) {
    return ranges.some((range) => item.start < range.end && item.end > range.start);
  }

  function serializableEquationContext(context, source) {
    return {
      kind: context.kind,
      environment: context.environment || "",
      delimiter: context.delimiter || "",
      display: Boolean(context.display),
      openStart: context.openStart,
      contentStart: context.contentStart,
      contentEnd: context.contentEnd,
      closeEnd: context.closeEnd,
      complete: context.complete !== false,
      source: source.slice(context.contentStart, context.contentEnd),
      cursorOffset: 0
    };
  }

  function serializableTableContext(context) {
    if (!context) return null;
    return {
      kind: "table",
      environment: context.environment,
      display: true,
      openStart: context.openStart,
      contentStart: context.contentStart,
      contentEnd: context.contentEnd,
      closeEnd: context.closeEnd,
      complete: context.complete !== false,
      columnSpec: context.columnSpec || "",
      source: context.source || "",
      cursorOffset: 0,
      cursorInsideTable: false,
      floatOpenStart: context.floatOpenStart,
      floatContentStart: context.floatContentStart,
      floatContentEnd: context.floatContentEnd,
      floatCloseEnd: context.floatCloseEnd
    };
  }

  function referencePrefix(type, plural = false) {
    const labels = {
      equation: plural ? "Eqs." : "Eq.",
      figure: plural ? "Figs." : "Fig.",
      table: plural ? "Tabs." : "Tab.",
      section: plural ? "Secs." : "Sec."
    };
    return labels[type] || "";
  }

  function referenceDisplay(source, command, labels, latexContext) {
    const targets = labels.map((label) => latexContext.referenceTarget?.(source, label));
    if (/^nameref$/i.test(command)) {
      return targets.map((target, index) => (
        target?.title || target?.caption || labels[index]
      )).join(", ");
    }
    const values = targets.map((target) => String(target?.number ?? "").trim() || "?");
    if (/^eqref$/i.test(command)) return values.map((value) => `(${value})`).join(", ");
    if (/^(?:autoref|cref|Cref|vref|Vref)$/i.test(command)) {
      const firstType = targets[0]?.type || "";
      const sameType = targets.every((target) => target?.type === firstType);
      const prefix = sameType ? referencePrefix(firstType, values.length > 1) : "";
      const text = `${prefix}${prefix ? " " : ""}${values.join(", ")}`;
      return /^[CV]/.test(command) ? text.replace(/^./, (value) => value.toUpperCase()) : text;
    }
    if (/^pageref$/i.test(command)) return values.join(", ");
    return values.join(", ");
  }

  function firstCommentIndex(line) {
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === "\\" && line.slice(index, index + 5) === "\\verb") {
        let delimiterIndex = index + 5;
        if (line[delimiterIndex] === "*") delimiterIndex += 1;
        const delimiter = line[delimiterIndex];
        if (delimiter && !/\s|[A-Za-z]/.test(delimiter)) {
          const end = line.indexOf(delimiter, delimiterIndex + 1);
          index = end < 0 ? line.length : end;
          continue;
        }
      }
      if (line[index] !== "%") continue;
      let slashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
        slashes += 1;
      }
      if (slashes % 2 === 0) return index;
    }
    return -1;
  }

  function commentItems(source, occupied) {
    const items = [];
    const lines = source.split("\n");
    const offsets = [];
    let offset = 0;
    for (const line of lines) {
      offsets.push(offset);
      offset += line.length + 1;
    }

    let row = 0;
    while (row < lines.length) {
      const commentColumn = firstCommentIndex(lines[row]);
      const fullLine = commentColumn >= 0 && lines[row].slice(0, commentColumn).trim() === "";
      if (fullLine) {
        const firstRow = row;
        let lastRow = row;
        while (lastRow + 1 < lines.length) {
          const nextColumn = firstCommentIndex(lines[lastRow + 1]);
          if (nextColumn < 0 || lines[lastRow + 1].slice(0, nextColumn).trim() !== "") break;
          lastRow += 1;
        }
        const start = offsets[firstRow];
        const end = offsets[lastRow] + lines[lastRow].length;
        const item = {
          kind: "full-comment",
          start,
          end,
          startRow: firstRow,
          endRow: lastRow,
          source: source.slice(start, end)
        };
        if (!itemOverlaps(item, occupied)) items.push(item);
        row = lastRow + 1;
        continue;
      }
      if (commentColumn >= 0) {
        const start = offsets[row] + commentColumn;
        const end = offsets[row] + lines[row].length;
        const item = {
          kind: "inline-comment",
          start,
          end,
          source: source.slice(start, end)
        };
        if (!itemOverlaps(item, occupied)) items.push(item);
      }
      row += 1;
    }
    return items;
  }

  function parseRenderedItems(sourceValue) {
    const source = String(sourceValue || "");
    const latexContext = globalThis.SmartTeXLatexContext;
    if (!latexContext) return [];
    const items = [];
    const occupied = [];

    if (settings.enabled) {
      for (const context of latexContext.figureContexts?.(source) || []) {
        if (context.complete === false) continue;
        const item = {
          kind: "figure",
          start: context.openStart,
          end: context.closeEnd,
          block: true,
          context: {
            ...context,
            source: source.slice(context.contentStart, context.contentEnd)
          },
          number: latexContext.figurePreviewNumber?.(source, context),
          caption: latexContext.floatCaption?.(source, context, "figure") || null,
          source: source.slice(context.openStart, context.closeEnd)
        };
        items.push(item);
        occupied.push(item);
      }

      for (const floatContext of latexContext.tableFloatContexts?.(source) || []) {
        if (floatContext.complete === false) continue;
        const tableContext = latexContext.findTableFloatContext?.(
          source,
          Math.min(floatContext.closeEnd, floatContext.openStart + 1)
        );
        if (!tableContext) continue;
        const item = {
          kind: "table",
          start: floatContext.openStart,
          end: floatContext.closeEnd,
          block: true,
          context: serializableTableContext(tableContext),
          number: latexContext.tablePreviewNumber?.(source, tableContext),
          caption: latexContext.floatCaption?.(source, tableContext, "table") || null,
          source: source.slice(floatContext.openStart, floatContext.closeEnd)
        };
        if (!itemOverlaps(item, occupied)) {
          items.push(item);
          occupied.push(item);
        }
      }

      const equationContexts = latexContext.equationContexts?.(source)?.contexts || [];
      for (const context of equationContexts) {
        if (context.complete === false) continue;
        const item = {
          kind: context.display ? "display-equation" : "inline-math",
          start: context.openStart,
          end: context.closeEnd,
          block: Boolean(context.display),
          context: serializableEquationContext(context, source),
          source: source.slice(context.openStart, context.closeEnd)
        };
        if (!itemOverlaps(item, occupied)) {
          items.push(item);
          occupied.push(item);
        }
      }

      const masked = latexContext.maskIgnoredLatex?.(source) || source;
      const referencePattern = /\\(eqref|ref|pageref|autoref|cref|Cref|vref|Vref|nameref)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)\}/g;
      let match;
      while ((match = referencePattern.exec(masked))) {
        const labels = String(match[2] || "").split(",").map((value) => value.trim()).filter(Boolean);
        if (!labels.length) continue;
        const start = match.index;
        const end = referencePattern.lastIndex;
        const item = {
          kind: "reference",
          start,
          end,
          block: false,
          command: match[1],
          labels,
          renderedText: referenceDisplay(source, match[1], labels, latexContext),
          source: source.slice(start, end)
        };
        if (!itemOverlaps(item, occupied)) {
          items.push(item);
          occupied.push(item);
        }
      }
    }

    if (settings.hideComments) {
      items.push(...commentItems(source, occupied));
    }

    for (const item of items) {
      item.id = `smarttex-rendered-${itemKey(item.kind, item.start, item.end, item.source)}`;
      item.key = item.id;
    }
    return items.sort((left, right) => left.start - right.start || right.end - left.end);
  }

  function ensureInlineLayer() {
    let layer = document.getElementById(INLINE_LAYER_ID);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = INLINE_LAYER_ID;
      layer.setAttribute("aria-hidden", "false");
      layer.style.cssText = [
        "position:fixed", "inset:0", "pointer-events:none", "overflow:hidden",
        "z-index:6"
      ].join(";");
      document.documentElement.appendChild(layer);
    }
    return layer;
  }

  function ensureWidgetManager() {
    if (!editor || !session) return null;
    if (session.widgetManager) {
      widgetManager = session.widgetManager;
      return widgetManager;
    }
    const LineWidgets = globalThis.ace?.require?.("ace/line_widgets")?.LineWidgets;
    if (!LineWidgets) return null;
    widgetManager = new LineWidgets(session);
    widgetManager.attach(editor);
    session.widgetManager = widgetManager;
    return widgetManager;
  }

  function editorBackground() {
    const candidates = [
      editor?.renderer?.container,
      editor?.renderer?.scroller,
      editor?.container
    ].filter(Boolean);
    for (const candidate of candidates) {
      const color = globalThis.getComputedStyle?.(candidate)?.backgroundColor;
      if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
    }
    return "Canvas";
  }

  function clearRenderedEntries() {
    if (session) {
      for (const entry of entries) {
        if (entry.widget && widgetManager?.removeLineWidget) {
          try { widgetManager.removeLineWidget(entry.widget); } catch (_error) {}
        }
        if (entry.fold) {
          try { session.removeFold(entry.fold); } catch (_error) {}
        }
        if (Number.isInteger(entry.gutterRow)) {
          try { session.removeGutterDecoration(entry.gutterRow, COMMENT_GUTTER_CLASS); } catch (_error) {}
        }
        entry.element?.remove?.();
      }
    } else {
      for (const entry of entries) entry.element?.remove?.();
    }
    entries = [];
    const layer = document.getElementById(INLINE_LAYER_ID);
    if (layer) layer.replaceChildren();
  }

  function placeholderCharacters(item) {
    const measured = measuredInlineWidths.get(item.id);
    const characterWidth = Math.max(5, Number(editor?.renderer?.characterWidth) || 8);
    if (Number.isFinite(measured) && measured > 0) {
      return Math.max(2, Math.min(120, Math.ceil(measured / characterWidth) + 1));
    }
    if (item.kind === "reference") return Math.max(2, Math.min(40, String(item.renderedText || "?").length + 1));
    if (item.kind === "inline-comment") return 4;
    return Math.max(4, Math.min(30, Math.ceil(String(item.context?.source || item.source || "").length * 0.6)));
  }

  function createFold(item, placeholder) {
    const Range = rangeConstructor();
    if (!Range || !session || item.end <= item.start) return null;
    const start = indexToPosition(item.start);
    const end = indexToPosition(item.end);
    if (!start || !end || (start.row === end.row && start.column === end.column)) return null;
    try {
      const fold = session.addFold(placeholder, new Range(start.row, start.column, end.row, end.column));
      if (fold) fold.$smarttexRenderedKey = item.key;
      return fold || null;
    } catch (_error) {
      return null;
    }
  }

  function expandRenderedItem(item) {
    if (!item || !session || !editor) return;
    expandedKeys.add(item.key);
    applyRenderedEntries();
    const index = Math.min(item.end, item.start + (item.kind.includes("comment") ? 1 : 0));
    const position = indexToPosition(index);
    if (position) {
      editor.moveCursorToPosition(position);
      editor.clearSelection?.();
      editor.focus?.();
      editor.renderer?.scrollCursorIntoView?.(position, 0.5);
    }
  }

  function installItemClick(element, item) {
    element.dataset.smarttexRenderedItem = item.key;
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, true);
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      expandRenderedItem(item);
    }, true);
  }

  function createBlockEntry(item, fold) {
    const manager = ensureWidgetManager();
    if (!manager || !fold) return { item, fold };
    const start = indexToPosition(item.start);
    const element = document.createElement("div");
    element.id = `${item.id}-container`;
    element.className = `smarttex-rendered-editor-block smarttex-rendered-editor-${item.kind}`;
    element.style.backgroundColor = editorBackground();
    installItemClick(element, item);
    const widget = {
      row: start.row,
      fixedWidth: true,
      coverGutter: false,
      el: element
    };
    try {
      manager.addLineWidget(widget);
      return { item, fold, widget, element };
    } catch (_error) {
      element.remove();
      return { item, fold };
    }
  }

  function createInlineEntry(item, fold) {
    if (!fold) return { item, fold };
    const layer = ensureInlineLayer();
    const element = document.createElement("span");
    element.id = `${item.id}-container`;
    element.className = `smarttex-rendered-editor-inline smarttex-rendered-editor-${item.kind}`;
    element.style.backgroundColor = editorBackground();
    installItemClick(element, item);
    layer.appendChild(element);
    return { item, fold, element };
  }

  function createFullCommentEntry(item, fold) {
    const start = indexToPosition(item.start);
    if (start) {
      try { session.addGutterDecoration(start.row, COMMENT_GUTTER_CLASS); } catch (_error) {}
    }
    return { item, fold, gutterRow: start?.row };
  }

  function dispatchItems(items) {
    window.dispatchEvent(new CustomEvent(ITEMS_EVENT, {
      detail: JSON.stringify({
        source: parsedSource,
        items: items.map((item) => ({
          ...item,
          containerId: `${item.id}-container`
        }))
      })
    }));
  }

  function applyRenderedEntries() {
    if (!editor || !session) return;
    clearRenderedEntries();
    if ((!settings.enabled && !settings.hideComments) || !parsedSource) {
      editor.renderer?.updateFull?.();
      return;
    }

    const selection = editorSelectionIndexes();
    const applied = [];
    for (const item of parsedItems) {
      // Rendered constructs remain collapsed during cursor navigation and are
      // expanded only through their rendered control or native fold click.
      if (expandedKeys.has(item.key)) continue;
      let fold = null;
      if (item.kind === "full-comment") {
        fold = createFold(item, " ");
        entries.push(createFullCommentEntry(item, fold));
      } else if (item.block) {
        fold = createFold(item, " ");
        const entry = createBlockEntry(item, fold);
        entries.push(entry);
        if (entry.element) applied.push(item);
      } else {
        const placeholder = "\u00a0".repeat(placeholderCharacters(item));
        fold = createFold(item, placeholder);
        const entry = createInlineEntry(item, fold);
        entries.push(entry);
        if (entry.element) applied.push(item);
      }
    }
    dispatchItems(applied);
    scheduleInlinePositioning();
    editor.renderer?.updateFull?.();
  }

  function scheduleInlinePositioning() {
    if (positionFrame) return;
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = 0;
      positionInlineEntries();
    });
  }

  function positionInlineEntries() {
    if (!editor || !session) return;
    const bounds = editor.renderer?.container?.getBoundingClientRect?.();
    if (!bounds) return;
    for (const entry of entries) {
      if (!entry.element || entry.item.block) continue;
      const position = indexToPosition(entry.item.start);
      const screen = position && editor.renderer?.textToScreenCoordinates?.(
        position.row,
        position.column
      );
      if (!screen) {
        entry.element.hidden = true;
        continue;
      }
      const left = Number(screen.pageX) - window.scrollX;
      const top = Number(screen.pageY) - window.scrollY;
      const lineHeight = Math.max(14, Number(editor.renderer?.lineHeight) || 16);
      const visible = (
        top + lineHeight >= bounds.top && top <= bounds.bottom &&
        left >= bounds.left - 2 && left <= bounds.right
      );
      entry.element.hidden = !visible;
      if (!visible) continue;
      entry.element.style.left = `${Math.round(left)}px`;
      entry.element.style.top = `${Math.round(top)}px`;
      entry.element.style.minHeight = `${Math.round(lineHeight)}px`;
      entry.element.style.lineHeight = `${Math.round(lineHeight)}px`;
      entry.element.style.maxWidth = `${Math.max(40, Math.round(bounds.right - left - 4))}px`;
    }
  }

  function parseAndApply() {
    refreshTimer = 0;
    if (!editor || !session) return;
    const source = session.getValue();
    parsedSource = source;
    parsedItems = parseRenderedItems(source);
    const validKeys = new Set(parsedItems.map((item) => item.key));
    for (const key of [...expandedKeys]) {
      if (!validKeys.has(key)) expandedKeys.delete(key);
    }
    applyRenderedEntries();
  }

  function scheduleRefresh(delay = 80) {
    window.clearTimeout(refreshTimer);
    const generation = ++refreshGeneration;
    refreshTimer = window.setTimeout(() => {
      if (generation !== refreshGeneration) return;
      parseAndApply();
    }, Math.max(0, Number(delay) || 0));
  }

  function synchronizeActiveItem() {
    if (!editor || !session || !parsedItems.length || !expandedKeys.size) return;
    const selection = editorSelectionIndexes();
    let needsApply = false;
    for (const key of [...expandedKeys]) {
      const item = parsedItems.find((candidate) => candidate.key === key);
      if (!item || !sourceRangeContains(item, selection)) {
        expandedKeys.delete(key);
        needsApply = true;
      }
    }
    if (needsApply) applyRenderedEntries();
  }

  function onSessionChange() {
    scheduleRefresh(120);
  }

  function bindSession(nextSession) {
    if (!nextSession || nextSession === boundSession) return;
    if (boundSession) {
      try { boundSession.off("change", onSessionChange); } catch (_error) {}
    }
    clearRenderedEntries();
    boundSession = nextSession;
    session = nextSession;
    widgetManager = null;
    session.on("change", onSessionChange);
    parsedSource = "";
    parsedItems = [];
    expandedKeys.clear();
    scheduleRefresh(0);
  }

  function installEditorBindings() {
    if (!editor || editorBindingsInstalled) return;
    editorBindingsInstalled = true;
    bindSession(editor.getSession());
    editor.on?.("changeSession", () => bindSession(editor.getSession()));
    editor.selection?.on?.("changeCursor", synchronizeActiveItem);
    editor.selection?.on?.("changeSelection", synchronizeActiveItem);
    editor.renderer?.on?.("afterRender", scheduleInlinePositioning);
    editor.renderer?.scroller?.addEventListener?.("scroll", scheduleInlinePositioning, { passive: true });
    window.addEventListener("resize", scheduleInlinePositioning, { passive: true });

    editor.on?.("guttermousedown", (event) => {
      const position = event.getDocumentPosition?.();
      if (!position) return;
      const entry = entries.find((candidate) => (
        candidate.item.kind === "full-comment" && candidate.gutterRow === position.row
      ));
      if (!entry) return;
      event.stop?.();
      event.domEvent?.preventDefault?.();
      expandRenderedItem(entry.item);
    });

    editor.on?.("mousedown", (event) => {
      const position = event.getDocumentPosition?.();
      if (!position || !session) return;
      const fold = session.getFoldAt?.(position.row, position.column, 1);
      const key = fold?.$smarttexRenderedKey;
      if (!key) return;
      const item = parsedItems.find((candidate) => candidate.key === key);
      if (!item) return;
      event.stop?.();
      event.domEvent?.preventDefault?.();
      expandRenderedItem(item);
    });
  }

  function bindEditorWhenAvailable() {
    const found = findAceEditor();
    if (found && found !== editor) {
      clearRenderedEntries();
      editor = found;
      session = null;
      boundSession = null;
      widgetManager = null;
      editorBindingsInstalled = false;
      installEditorBindings();
      return true;
    }
    if (found) installEditorBindings();
    return Boolean(found);
  }

  window.addEventListener(SETTINGS_EVENT, (event) => {
    let detail = {};
    try {
      detail = typeof event?.detail === "string"
        ? JSON.parse(event.detail)
        : (event?.detail || {});
    } catch (_error) {
      detail = {};
    }
    settings = {
      enabled: detail.enabled !== false,
      hideComments: detail.hideComments !== false
    };
    expandedKeys.clear();
    if (!bindEditorWhenAvailable()) return;
    scheduleRefresh(0);
  });

  window.addEventListener(MEASURE_EVENT, (event) => {
    let detail = null;
    try {
      detail = typeof event.detail === "string"
        ? JSON.parse(event.detail)
        : event.detail;
    } catch (_error) {
      return;
    }
    const id = String(detail?.id || "");
    const width = Number(detail?.width);
    if (id && Number.isFinite(width) && width > 0) {
      const previous = measuredInlineWidths.get(id) || 0;
      measuredInlineWidths.set(id, width);
      const characterWidth = Math.max(5, Number(editor?.renderer?.characterWidth) || 8);
      if (Math.abs(previous - width) >= characterWidth) scheduleRefresh(30);
    }
    if (Number.isFinite(Number(detail?.height))) {
      widgetManager?.updateOnChange?.();
      editor?.renderer?.updateFull?.();
    }
  });

  bindEditorWhenAvailable();
  editorObserver = new MutationObserver(() => {
    if (bindEditorWhenAvailable()) scheduleInlinePositioning();
  });
  editorObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
