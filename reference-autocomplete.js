/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (window.top !== window) return;
  const existingReferenceAutocomplete = document.getElementById("smarttex-reference-autocomplete-popup");
  if (globalThis.__smartTeXReferenceAutocompleteLoaded && existingReferenceAutocomplete) return;
  if (globalThis.__smartTeXReferenceAutocompleteLoaded && !existingReferenceAutocomplete) {
    globalThis.__smartTeXReferenceAutocompleteLoaded = false;
  }
  if (globalThis.__smartTeXReferenceAutocompleteLoading) return;
  globalThis.__smartTeXReferenceAutocompleteLoading = true;

  const initializeWhenDependenciesAreReady = async () => {
    const startedAt = Date.now();
    let repairRequested = false;
    while (!(globalThis.SmartTeXLatexContext?.referenceTarget && globalThis.SmartTeXLatexContext?.maskIgnoredLatex)) {
      if (!repairRequested) {
        repairRequested = true;
        try {
          const api = globalThis.browser ?? globalThis.chrome;
          await api?.runtime?.sendMessage?.({ type: "smarttex-reinject-preview-dependencies" });
        } catch (_error) {
          // The normal registered content-script order may still complete without fallback injection.
        }
      }
      if (Date.now() - startedAt > 10000) {
        throw new Error("SmartTeX reference autocomplete could not load its LaTeX context parser.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (globalThis.__smartTeXReferenceAutocompleteLoaded) return;
    globalThis.__smartTeXReferenceAutocompleteLoaded = true;
    globalThis.__smartTeXReferenceAutocompleteLoading = false;

  const STATE_EVENT = "smarttex:editor-state";
  const REQUEST_EVENT = "smarttex:citation-editor-request";
  const RESPONSE_EVENT = "smarttex:citation-editor-response";
  const PREVIEW_EVENT = "smarttex:reference-autocomplete-preview";
  const PREVIEW_HIDE_EVENT = "smarttex:reference-autocomplete-preview-hide";
  const ACTIVE_EVENT = "smarttex:reference-autocomplete-active";
  const SETTINGS_KEY = "smarttex:autocomplete:v1";
  const OPEN_DELAY_MS = 70;
  const MAX_RESULTS = 14;
  const REFERENCE_COMMAND = /\\(eqref|ref|pageref|autoref|cref|Cref|vref|Vref|nameref)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/;
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const contextTools = globalThis.SmartTeXLatexContext;
  const popupInteractionReady = () => globalThis.SmartTeXPopupGate?.isReady?.() !== false;


  let currentState = null;
  let currentContext = null;
  let records = [];
  let renderedRecords = [];
  let selectedIndex = 0;
  let lastPopupPosition = null;
  let popupTimer = null;
  let dismissedContextId = "";
  let requestCounter = 0;
  let sourceCache = null;
  let targetCache = new Map();
  let configuredOrderMode = "document";
  let orderMode = "document";
  let previewGeneration = 0;
  const pendingRequests = new Map();

  const popup = document.createElement("aside");
  popup.id = "smarttex-reference-autocomplete-popup";
  popup.hidden = true;
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "SmartTeX reference suggestions");
  popup.innerHTML = `
    <header class="smarttex-reference-autocomplete-header">
      <span class="smarttex-reference-autocomplete-query">Reference</span>
      <button type="button" class="smarttex-reference-autocomplete-order" aria-pressed="false">Sort alphabetically</button>
      <button type="button" class="smarttex-reference-autocomplete-close" title="Close (Esc)" aria-label="Close reference suggestions">&times;</button>
    </header>
    <div class="smarttex-reference-autocomplete-list" role="listbox" aria-label="Reference suggestions"></div>`;
  document.documentElement.appendChild(popup);

  const queryLabel = popup.querySelector(".smarttex-reference-autocomplete-query");
  const orderLabel = popup.querySelector(".smarttex-reference-autocomplete-order");
  const list = popup.querySelector(".smarttex-reference-autocomplete-list");
  const closeButton = popup.querySelector(".smarttex-reference-autocomplete-close");

  function normalizeOrder(value) {
    return value === "alphabetical" ? "alphabetical" : "document";
  }

  async function loadSettings() {
    try {
      const stored = await extensionApi?.storage?.local?.get?.(SETTINGS_KEY);
      configuredOrderMode = normalizeOrder(stored?.[SETTINGS_KEY]?.referenceOrder);
      orderMode = configuredOrderMode;
    } catch (_error) {
      configuredOrderMode = "document";
      orderMode = configuredOrderMode;
    }
  }

  function contextId(context = currentContext) {
    if (!context) return "";
    return [
      currentState?.fileName || "",
      context.command,
      context.anchorIndex,
      context.fragmentStart
    ].join(":");
  }

  function clearPopupTimer() {
    window.clearTimeout(popupTimer);
    popupTimer = null;
  }

  function bridgeRequest(type, payload = {}, timeoutMs = 1800) {
    const requestId = `reference-${Date.now()}-${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`SmartTeX editor request timed out: ${type}`));
      }, timeoutMs);
      pendingRequests.set(requestId, { resolve, reject, timeout });
      window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: JSON.stringify({ requestId, type, ...payload })
      }));
    });
  }

  window.addEventListener(RESPONSE_EVENT, (event) => {
    let response;
    try {
      response = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      return;
    }
    const pending = pendingRequests.get(response.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingRequests.delete(response.requestId);
    if (response.ok) pending.resolve(response);
    else pending.reject(new Error(response.error || "SmartTeX editor request failed."));
  });

  function setBridgeActive(active) {
    window.dispatchEvent(new CustomEvent(ACTIVE_EVENT, {
      detail: JSON.stringify({
        owner: "reference-autocomplete",
        active: Boolean(active)
      })
    }));
    bridgeRequest("setReferenceAutocompleteActive", {
      active: Boolean(active)
    }, 1000).catch(() => {});
  }

  function dispatchPreviewHide({ force = false } = {}) {
    previewGeneration += 1;
    window.dispatchEvent(new CustomEvent(PREVIEW_HIDE_EVENT, {
      detail: JSON.stringify({
        owner: "reference-autocomplete",
        force: Boolean(force)
      })
    }));
  }

  function hidePopup({ dismiss = false } = {}) {
    clearPopupTimer();
    if (dismiss && currentContext) dismissedContextId = contextId();
    popup.hidden = true;
    lastPopupPosition = null;
    popup.classList.remove("smarttex-reference-autocomplete-visible");
    setBridgeActive(false);
    dispatchPreviewHide({ force: true });
  }

  function showPopup() {
    if (!popupInteractionReady() || !currentContext) return;
    popup.hidden = false;
    popup.classList.add("smarttex-reference-autocomplete-visible");
    setBridgeActive(true);
    positionPopup();
  }

  function findReferenceContext(state) {
    if (
      !state?.value ||
      !Number.isInteger(state.cursorIndex) ||
      state.focused === false ||
      !/\.(?:tex|ltx)$/i.test(String(state.fileName || "main.tex"))
    ) {
      return null;
    }
    const beforeCursor = state.value.slice(0, state.cursorIndex);
    const match = beforeCursor.match(REFERENCE_COMMAND);
    if (!match) return null;
    const completeMatch = match[0];
    const command = match[1];
    const argument = match[2];
    const lastComma = argument.lastIndexOf(",");
    const beforeFragment = argument.slice(lastComma + 1);
    const leadingWhitespace = beforeFragment.match(/^\s*/)?.[0] || "";
    const fragmentStart = state.cursorIndex - beforeFragment.length + leadingWhitespace.length;
    const afterFragment = state.value
      .slice(state.cursorIndex)
      .match(/^[^,{}\s]*/)?.[0] || "";
    const commandStart = beforeCursor.length - completeMatch.length;
    return {
      command,
      fragment: beforeFragment.slice(leadingWhitespace.length) + afterFragment,
      currentLabel: (
        beforeFragment.slice(leadingWhitespace.length) + afterFragment
      ).trim(),
      fragmentStart,
      fragmentEnd: state.cursorIndex + afterFragment.length,
      commandStart,
      anchorIndex: commandStart + completeMatch.lastIndexOf("{")
    };
  }

  function rebuildRecords(sourceValue) {
    const source = String(sourceValue || "");
    if (source === sourceCache) return;
    sourceCache = source;
    targetCache = new Map();
    records = [];
    const masked = contextTools.maskIgnoredLatex(source);
    const equationRanges = (contextTools.equationContexts?.(source)?.contexts || [])
      .map((context) => ({
        start: Number(context.openStart) || 0,
        end: Number(context.closeEnd) || 0
      }))
      .sort((left, right) => left.start - right.start);
    let equationRangeIndex = 0;
    const seen = new Set();
    const pattern = /\\label\s*\{([^{}]+)\}/g;
    let match;
    while ((match = pattern.exec(masked))) {
      const label = String(match[1] || "").trim();
      if (!label || seen.has(label)) continue;
      while (
        equationRangeIndex < equationRanges.length &&
        equationRanges[equationRangeIndex].end < match.index
      ) {
        equationRangeIndex += 1;
      }
      const equationRange = equationRanges[equationRangeIndex];
      seen.add(label);
      records.push({
        label,
        sourceIndex: match.index,
        documentOrder: records.length,
        equation: Boolean(
          equationRange &&
          match.index >= equationRange.start &&
          match.index <= equationRange.end
        )
      });
    }
  }

  function targetFor(record) {
    if (!record) return null;
    if (targetCache.has(record.label)) return targetCache.get(record.label);
    let target = null;
    try {
      target = contextTools.referenceTarget(sourceCache || "", record.label);
    } catch (_error) {
      target = null;
    }
    targetCache.set(record.label, target);
    return target;
  }

  function targetTypeText(target) {
    return ({
      equation: "Equation",
      figure: "Figure",
      table: "Table",
      section: "Section",
      label: "Label"
    })[target?.type] || "Reference";
  }

  function targetDescription(target) {
    const type = targetTypeText(target);
    const number = String(target?.number || "").trim();
    const title = String(target?.title || target?.caption || "").trim();
    const primary = number ? `${type} ${number}` : type;
    return title ? `${primary} — ${title}` : primary;
  }

  function matchRank(record, fragment) {
    const query = String(fragment || "").trim().toLocaleLowerCase();
    if (!query) return 0;
    const label = record.label.toLocaleLowerCase();
    if (label === query) return 0;
    if (label.startsWith(query)) return 1;
    const tokenIndex = label.search(new RegExp(
      `(?:^|[:._/\\-])${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
    ));
    if (tokenIndex >= 0) return 2 + tokenIndex / 1000;
    const contained = label.indexOf(query);
    if (contained >= 0) return 3 + contained / 1000;
    return Number.POSITIVE_INFINITY;
  }

  function matchingRecords(context) {
    const command = context?.command || "ref";
    const fragment = context?.fragment || "";
    return records.filter((record) => (
      command !== "eqref" || record.equation
    )).filter((record) => Number.isFinite(matchRank(record, fragment)))
      .sort((left, right) => {
        if (orderMode === "alphabetical") {
          return left.label.localeCompare(right.label, undefined, {
            sensitivity: "base",
            numeric: true
          });
        }
        return left.documentOrder - right.documentOrder;
      })
      .slice(0, MAX_RESULTS)
      .map((record) => ({
        record,
        target: targetFor(record)
      }));
  }

  function selectedItemElement() {
    return list.querySelectorAll(".smarttex-reference-autocomplete-item")[selectedIndex] || null;
  }

  function previewSelected() {
    const selected = renderedRecords[selectedIndex];
    const item = selectedItemElement();
    if (popup.hidden) return;
    if (!selected?.target || !item) {
      dispatchPreviewHide({ force: true });
      return;
    }
    const generation = ++previewGeneration;
    window.requestAnimationFrame(() => {
      if (generation !== previewGeneration || popup.hidden || item !== selectedItemElement()) return;
      const rect = item.getBoundingClientRect();
      const ownerRect = popup.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, {
        detail: JSON.stringify({
          owner: "reference-autocomplete",
          label: selected.record.label,
          command: currentContext?.command || "ref",
          sourceIndex: Number(currentContext?.commandStart) || 0,
          anchorRect: {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom
          },
          ownerRect: {
            left: ownerRect.left,
            right: ownerRect.right,
            top: ownerRect.top,
            bottom: ownerRect.bottom
          }
        })
      }));
    });
  }

  function updateSelectedItem({ preview = true } = {}) {
    const items = [...list.querySelectorAll(".smarttex-reference-autocomplete-item")];
    items.forEach((item, index) => {
      const selected = index === selectedIndex;
      item.classList.toggle("smarttex-reference-autocomplete-selected", selected);
      item.setAttribute("aria-selected", selected ? "true" : "false");
    });
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    if (preview) previewSelected();
  }

  function renderPopup() {
    queryLabel.textContent = currentContext?.fragment
      ? `${currentContext.command} matching “${currentContext.fragment}”`
      : `Select a ${currentContext?.command || "ref"} target`;
    const alphabetical = orderMode === "alphabetical";
    orderLabel.textContent = "Sort alphabetically";
    orderLabel.classList.toggle(
      "smarttex-reference-autocomplete-order-active",
      alphabetical
    );
    orderLabel.setAttribute("aria-pressed", alphabetical ? "true" : "false");
    orderLabel.title = alphabetical
      ? "Alphabetical sorting is enabled for this completion list"
      : "Sort this completion list alphabetically";
    list.replaceChildren();
    renderedRecords = matchingRecords(currentContext);
    const exactIndex = renderedRecords.findIndex(
      (entry) => entry.record.label === currentContext?.currentLabel
    );
    if (exactIndex >= 0) selectedIndex = exactIndex;
    if (selectedIndex >= renderedRecords.length) selectedIndex = 0;

    if (!renderedRecords.length) {
      const empty = document.createElement("p");
      empty.className = "smarttex-reference-autocomplete-empty";
      empty.textContent = currentContext?.command === "eqref"
        ? "No matching equation label was found."
        : "No matching reference label was found.";
      list.appendChild(empty);
      dispatchPreviewHide({ force: true });
      return;
    }

    renderedRecords.forEach((entry, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "smarttex-reference-autocomplete-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
      item.classList.toggle(
        "smarttex-reference-autocomplete-exact",
        Boolean(currentContext?.currentLabel) && entry.record.label === currentContext.currentLabel
      );
      item.classList.toggle("smarttex-reference-autocomplete-selected", index === selectedIndex);

      const label = document.createElement("code");
      label.className = "smarttex-reference-autocomplete-label";
      label.textContent = entry.record.label;
      label.title = entry.record.label;
      const description = document.createElement("span");
      description.className = "smarttex-reference-autocomplete-description";
      description.textContent = targetDescription(entry.target);
      description.title = description.textContent;
      item.append(label, description);
      item.addEventListener("mouseenter", () => {
        if (selectedIndex === index) {
          previewSelected();
          return;
        }
        selectedIndex = index;
        updateSelectedItem();
      });
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => insertRecord(entry.record));
      list.appendChild(item);
    });
    previewSelected();
  }

  async function insertRecord(record) {
    if (!record || !currentContext) return;
    const dismissedId = contextId();
    hidePopup();
    try {
      await bridgeRequest("replaceReferenceToken", { text: record.label });
      dismissedContextId = dismissedId;
    } catch (error) {
      dismissedContextId = "";
      renderPopup();
      showPopup();
      console.warn("SmartTeX could not insert the reference label:", error);
    }
  }

  function positionPopup() {
    if (popup.hidden) return;
    const screen = currentState?.screen;
    if (!screen) return;
    const margin = 9;
    const gap = 9;
    const width = Math.min(500, window.innerWidth - margin * 2);
    popup.style.width = `${Math.max(300, width)}px`;
    popup.style.maxHeight = `${Math.max(190, window.innerHeight - margin * 2)}px`;
    const rect = popup.getBoundingClientRect();
    const cursorLeft = Number(screen.pageX) - window.scrollX;
    const cursorTop = Number(screen.pageY) - window.scrollY;
    const lineHeight = Math.max(14, Number(screen.lineHeight) || 18);
    const cursorRect = {
      left: cursorLeft - 3,
      right: cursorLeft + 3,
      top: cursorTop - 2,
      bottom: cursorTop + lineHeight + 2
    };
    const currentRect = lastPopupPosition
      ? {
          left: lastPopupPosition.left,
          right: lastPopupPosition.left + rect.width,
          top: lastPopupPosition.top,
          bottom: lastPopupPosition.top + rect.height
        }
      : null;
    const blocksCursor = currentRect && !(
      currentRect.right < cursorRect.left ||
      currentRect.left > cursorRect.right ||
      currentRect.bottom < cursorRect.top ||
      currentRect.top > cursorRect.bottom
    );

    // Keep an already-open list stationary while the cursor moves. Reposition
    // it only when it would cover the caret or after the popup was newly opened.
    if (!lastPopupPosition || blocksCursor) {
      const fitsBelow = cursorTop + lineHeight + gap + rect.height <= window.innerHeight - margin;
      const top = fitsBelow
        ? cursorTop + lineHeight + gap
        : cursorTop - gap - rect.height;
      const left = Math.max(
        margin,
        Math.min(cursorLeft, window.innerWidth - rect.width - margin)
      );
      const boundedTop = Math.max(
        margin,
        Math.min(top, window.innerHeight - rect.height - margin)
      );
      lastPopupPosition = { left, top: boundedTop };
    }
    popup.style.left = `${Math.round(lastPopupPosition.left)}px`;
    popup.style.top = `${Math.round(lastPopupPosition.top)}px`;
    previewSelected();
  }

  function openForCurrentContext() {
    popupTimer = null;
    if (!popupInteractionReady() || !currentContext || contextId() === dismissedContextId) return;
    // The toolbar choice is intentionally session-local. Every newly opened
    // completion list starts from the persistent option-page preference.
    orderMode = configuredOrderMode;
    selectedIndex = 0;
    renderPopup();
    showPopup();
    bridgeRequest("getCoordinates", {
      index: currentContext.anchorIndex
    }, 1200).then((response) => {
      if (response.screen && currentState) {
        currentState = { ...currentState, screen: response.screen };
        positionPopup();
      }
    }).catch(() => {});
  }

  function updateFromState() {
    if (!popupInteractionReady()) {
      currentContext = null;
      hidePopup();
      return;
    }
    const nextContext = findReferenceContext(currentState);
    if (!nextContext) {
      currentContext = null;
      dismissedContextId = "";
      hidePopup();
      return;
    }
    rebuildRecords(currentState.value);
    const previousId = contextId();
    currentContext = nextContext;
    const nextId = contextId();
    if (nextId !== dismissedContextId) dismissedContextId = "";
    if (nextId === dismissedContextId) {
      clearPopupTimer();
      popup.hidden = true;
      popup.classList.remove("smarttex-reference-autocomplete-visible");
      setBridgeActive(false);
      dispatchPreviewHide({ force: true });
      return;
    }
    setBridgeActive(true);
    clearPopupTimer();
    if (!popup.hidden) {
      if (previousId !== nextId) selectedIndex = 0;
      renderPopup();
      positionPopup();
      return;
    }
    popupTimer = window.setTimeout(openForCurrentContext, OPEN_DELAY_MS);
  }

  window.addEventListener(STATE_EVENT, (event) => {
    try {
      currentState = JSON.parse(String(event.detail || "null"));
    } catch (_error) {
      hidePopup();
      return;
    }
    updateFromState();
  });

  orderLabel.addEventListener("mousedown", (event) => event.preventDefault());
  orderLabel.addEventListener("click", () => {
    if (popup.hidden) return;
    const selectedLabel = renderedRecords[selectedIndex]?.record?.label || "";
    orderMode = orderMode === "alphabetical" ? "document" : "alphabetical";
    renderPopup();
    if (selectedLabel) {
      const nextIndex = renderedRecords.findIndex(
        (entry) => entry.record.label === selectedLabel
      );
      if (nextIndex >= 0) {
        selectedIndex = nextIndex;
        updateSelectedItem();
      }
    }
    positionPopup();
  });

  closeButton.addEventListener("mousedown", (event) => event.preventDefault());
  closeButton.addEventListener("click", () => {
    hidePopup({ dismiss: true });
    bridgeRequest("focus").catch(() => {});
  });

  document.addEventListener("keydown", (event) => {
    if (popup.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      hidePopup({ dismiss: true });
      bridgeRequest("focus").catch(() => {});
      return;
    }
    if (!renderedRecords.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (renderedRecords.length === 1) {
        bridgeRequest("moveCursorVertical", { direction: 1 }).catch(() => {});
        return;
      }
      selectedIndex = (selectedIndex + 1) % renderedRecords.length;
      updateSelectedItem();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (renderedRecords.length === 1) {
        bridgeRequest("moveCursorVertical", { direction: -1 }).catch(() => {});
        return;
      }
      selectedIndex = (selectedIndex - 1 + renderedRecords.length) % renderedRecords.length;
      updateSelectedItem();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopImmediatePropagation();
      insertRecord(renderedRecords[selectedIndex]?.record);
    }
  }, true);

  document.addEventListener("mousedown", (event) => {
    if (popup.hidden || popup.contains(event.target)) return;
    if (event.target?.closest?.(".smarttex-document-reference-popup")) return;
    hidePopup({ dismiss: true });
  }, true);

  window.addEventListener("resize", positionPopup, { passive: true });
  window.addEventListener("scroll", (event) => {
    if (event.target instanceof Node && popup.contains(event.target)) return;
    positionPopup();
  }, true);

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[SETTINGS_KEY]) return;
    configuredOrderMode = normalizeOrder(
      changes[SETTINGS_KEY].newValue?.referenceOrder
    );
    // A setting change defines the initial state of the next list. It does not
    // overwrite a one-time choice while the current list is already open.
    if (popup.hidden) orderMode = configuredOrderMode;
  });

  loadSettings().then(updateFromState).catch(updateFromState);

  window.addEventListener("pagehide", () => {
    clearPopupTimer();
    setBridgeActive(false);
    dispatchPreviewHide();
    pendingRequests.forEach((pending) => {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("SmartTeX page closed."));
    });
    pendingRequests.clear();
  }, { once: true });
  };

  initializeWhenDependenciesAreReady().catch((error) => {
    globalThis.__smartTeXReferenceAutocompleteLoading = false;
    console.error(error?.message || "SmartTeX reference autocomplete could not load its LaTeX context parser.", error);
  });
})();
