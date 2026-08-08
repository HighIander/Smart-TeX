/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.SmartTeXPageContext?.isDocumentPage?.() === false) return;

  if (window.top !== window) return;
  const existing = document.getElementById("smarttex-figure-autocomplete-popup");
  if (globalThis.__smartTeXFigureAutocompleteLoaded && existing) return;
  if (globalThis.__smartTeXFigureAutocompleteLoaded && !existing) {
    globalThis.__smartTeXFigureAutocompleteLoaded = false;
  }
  if (globalThis.__smartTeXFigureAutocompleteLoading) return;
  globalThis.__smartTeXFigureAutocompleteLoading = true;

  const initializeWhenDependenciesAreReady = async () => {
    const startedAt = Date.now();
    while (!globalThis.SmartTeXLatexContext?.maskIgnoredLatex) {
      if (Date.now() - startedAt > 10000) {
        throw new Error("SmartTeX figure autocomplete could not load its LaTeX parser.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (globalThis.__smartTeXFigureAutocompleteLoaded) return;
    globalThis.__smartTeXFigureAutocompleteLoaded = true;
    globalThis.__smartTeXFigureAutocompleteLoading = false;

    const STATE_EVENT = "smarttex:editor-state";
    const REQUEST_EVENT = "smarttex:citation-editor-request";
    const RESPONSE_EVENT = "smarttex:citation-editor-response";
    const SELECTION_EVENT = "smarttex:graphic-autocomplete-selection-change";
    const MAX_RESULTS = 300;
    const FIGURE_PATTERN = /\.(?:png|jpe?g|gif|svg|pdf|eps|webp)$/i;
    const extensionApi = globalThis.browser ?? globalThis.chrome;
    const contextTools = globalThis.SmartTeXLatexContext;
    const interactionTasks = globalThis.SmartTeXInteractionTasks;
    const popupInteractionReady = () => globalThis.SmartTeXPopupGate?.isReady?.() !== false;

    let currentState = null;
    let currentContext = null;
    let figures = [];
    let figuresLoaded = false;
    let fullLoadStarted = false;
    let fullLoadRequested = false;
    let quickLoadPromise = null;
    let quickLoadedAt = 0;
    let selectedIndex = 0;
    let renderedRecords = [];
    let onlyUnused = false;
    let lastPopupPosition = null;
    let autocompleteContextActive = false;
    let requestCounter = 0;
    let loadingGeneration = 0;
    let scrollSuppressed = false;
    const pendingRequests = new Map();

    const popup = document.createElement("aside");
    popup.id = "smarttex-figure-autocomplete-popup";
    popup.hidden = true;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "SmartTeX figure suggestions");
    popup.innerHTML = `
      <header class="smarttex-figure-autocomplete-header">
        <span class="smarttex-figure-autocomplete-query">Figures</span>
        <button type="button" class="smarttex-figure-autocomplete-unused" aria-pressed="false">Only show figures not yet included</button>
        <button type="button" class="smarttex-figure-autocomplete-close" title="Close (Esc)" aria-label="Close figure suggestions">&times;</button>
      </header>
      <div class="smarttex-figure-autocomplete-list" role="listbox" aria-label="Figure suggestions"></div>`;
    document.documentElement.appendChild(popup);

    const queryLabel = popup.querySelector(".smarttex-figure-autocomplete-query");
    const unusedButton = popup.querySelector(".smarttex-figure-autocomplete-unused");
    const list = popup.querySelector(".smarttex-figure-autocomplete-list");
    const closeButton = popup.querySelector(".smarttex-figure-autocomplete-close");

    function bridgeRequest(type, payload = {}, timeoutMs = 5000) {
      const requestId = `figure-${Date.now()}-${++requestCounter}`;
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
      bridgeRequest("setFigureAutocompleteActive", {
        active: Boolean(active)
      }, 1200).catch(() => {});
    }

    function setAutocompleteContextActive(active) {
      const nextActive = Boolean(active);
      // Suppress CollabTeX's native filename completer immediately in this
      // isolated-world script. The MAIN-world bridge also detaches Ace's
      // completer, but that request is asynchronous and used to leave a small
      // window in which the native list could flash or remain visible.
      document.body?.classList.toggle(
        "smarttex-figure-autocomplete-context-active",
        nextActive
      );
      if (autocompleteContextActive === nextActive) return;
      autocompleteContextActive = nextActive;
      setBridgeActive(nextActive);
    }

    function normalizePath(value) {
      return String(value || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/{2,}/g, "/")
        .toLocaleLowerCase();
    }

    function pathStem(value) {
      return normalizePath(value).replace(/\.(?:png|jpe?g|gif|svg|pdf|eps|webp)$/i, "");
    }

    function includedFigureKeys(sourceValue) {
      const source = String(sourceValue || "");
      const masked = contextTools.maskIgnoredLatex(source);
      const keys = new Set();
      const pattern = /\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/gi;
      let match;
      while ((match = pattern.exec(masked))) {
        const path = normalizePath(match[1]);
        if (!path) continue;
        keys.add(path);
        keys.add(pathStem(path));
        if (!path.includes("/")) {
          keys.add(path.split("/").pop());
          keys.add(pathStem(path.split("/").pop()));
        }
      }
      return keys;
    }

    function isIncluded(path, keys) {
      const normalized = normalizePath(path);
      const stem = pathStem(normalized);
      if (keys.has(normalized) || keys.has(stem)) return true;
      const base = normalized.split("/").pop();
      return keys.has(base) || keys.has(pathStem(base));
    }

    function matchingArgumentClose(source, openIndex) {
      let depth = 0;
      for (let index = Math.max(0, Number(openIndex) || 0); index < source.length; index += 1) {
        const character = source[index];
        if (character === "\\") {
          index += 1;
          continue;
        }
        if (character === "{") depth += 1;
        else if (character === "}" && --depth === 0) return index;
      }
      return -1;
    }

    function findFigureContext(state) {
      if (
        !state?.value || !Number.isInteger(state.cursorIndex) || state.focused === false ||
        !/\.(?:tex|ltx)$/i.test(String(state.fileName || "main.tex"))
      ) return null;
      const cursor = Math.max(0, Math.min(state.cursorIndex, state.value.length));
      const scanStart = Math.max(
        0,
        state.value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1,
        cursor - 4096
      );
      const masked = contextTools.maskIgnoredLatex(state.value);
      const beforeCursor = masked.slice(scanStart, cursor);
      const match = beforeCursor.match(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]*)$/i);
      if (!match) return null;
      const beforeFragment = String(match[1] || "");
      const commandStart = cursor - match[0].length;
      const openIndex = commandStart + match[0].lastIndexOf("{");
      const closeIndex = matchingArgumentClose(state.value, openIndex);
      if (closeIndex >= 0 && /[\r\n]/.test(state.value.slice(cursor, closeIndex))) return null;
      const argumentIsClosed = closeIndex >= cursor;
      const afterFragment = argumentIsClosed
        ? (state.value.slice(cursor).match(/^[^{}\s]*/)?.[0] || "")
        : "";

      // The exact-match highlight must describe the complete includegraphics
      // argument, not only the text on the caret's left side.  In particular,
      // moving the caret through an already complete filename must not make the
      // matching list entry lose its light-blue "current file" highlight.
      const argumentEnd = closeIndex >= 0 ? closeIndex : cursor;
      const fullArgument = state.value.slice(openIndex + 1, argumentEnd).trim();
      return {
        commandStart,
        openIndex,
        fragment: beforeFragment + afterFragment,
        currentPath: fullArgument || (beforeFragment + afterFragment).trim()
      };
    }

    function contextId(context = currentContext) {
      if (!context) return "";
      return [currentState?.fileName || "", context.commandStart, context.openIndex].join(":");
    }

    function isExactCurrentPath(path) {
      return normalizePath(path) === normalizePath(currentContext?.currentPath || "");
    }

    function matchRank(path, fragment) {
      const query = normalizePath(fragment);
      if (!query) return 0;
      const candidate = normalizePath(path);
      if (candidate === query) return 0;
      if (candidate.startsWith(query)) return 1;
      const basename = candidate.split("/").pop();
      if (basename.startsWith(query)) return 1.2;
      const contained = candidate.indexOf(query);
      if (contained >= 0) return 2 + contained / 1000;
      return Number.POSITIVE_INFINITY;
    }

    function matchingRecords() {
      const calculate = () => {
        const keys = includedFigureKeys(currentState?.value || "");
        const matches = [];
        for (let index = 0; index < figures.length; index += 1) {
          interactionTasks?.checkpoint?.(index, 32);
          const path = figures[index];
          const record = { path, included: isIncluded(path, keys) };
          if (onlyUnused && record.included) continue;
          if (!Number.isFinite(matchRank(path, currentContext?.fragment || ""))) continue;
          matches.push(record);
        }
        let comparisons = 0;
        matches.sort((left, right) => {
          interactionTasks?.checkpoint?.(comparisons++, 32);
          return left.path.localeCompare(right.path, undefined, {
            sensitivity: "base", numeric: true
          });
        });
        return matches.slice(0, MAX_RESULTS);
      };
      try {
        return interactionTasks?.runSync
          ? interactionTasks.runSync("figure-list-filter", calculate)
          : calculate();
      } catch (error) {
        if (interactionTasks?.isAbortError?.(error)) return null;
        throw error;
      }
    }

    function selectedItemElement() {
      return list.querySelectorAll(".smarttex-figure-autocomplete-item")[selectedIndex] || null;
    }

    function notifyPreviewSelection() {
      window.dispatchEvent(new CustomEvent(SELECTION_EVENT));
    }

    function updateSelectedItem() {
      const items = [...list.querySelectorAll(".smarttex-figure-autocomplete-item")];
      items.forEach((item, index) => {
        const selected = index === selectedIndex;
        item.classList.toggle("smarttex-figure-autocomplete-selected", selected);
        item.setAttribute("aria-selected", selected ? "true" : "false");
      });
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
      notifyPreviewSelection();
    }

    function renderPopup() {
      if (!currentContext) return;
      queryLabel.textContent = currentContext.fragment
        ? `Figures matching “${currentContext.fragment}”`
        : "Select a figure file";
      unusedButton.classList.toggle("smarttex-figure-autocomplete-unused-active", onlyUnused);
      unusedButton.setAttribute("aria-pressed", onlyUnused ? "true" : "false");
      unusedButton.title = onlyUnused
        ? "Showing only figure files that are not yet included"
        : "Hide figure files that are already included";
      const nextRecords = matchingRecords();
      if (!nextRecords) return;
      const exactIndex = nextRecords.findIndex((record) => isExactCurrentPath(record.path));
      if (exactIndex >= 0) selectedIndex = exactIndex;
      if (selectedIndex >= nextRecords.length) selectedIndex = 0;
      const fragment = document.createDocumentFragment();

      if (!nextRecords.length) {
        const empty = document.createElement("p");
        empty.className = "smarttex-figure-autocomplete-empty";
        if (!figuresLoaded) {
          empty.classList.add("smarttex-list-loading");
          const spinner = document.createElement("span");
          spinner.className = "smarttex-inline-loading-spinner";
          spinner.setAttribute("aria-hidden", "true");
          const text = document.createElement("span");
          text.textContent = "Gathering figure files…";
          empty.append(spinner, text);
          popup.setAttribute("aria-busy", "true");
        } else {
          empty.textContent = onlyUnused
            ? "No matching figure that has not yet been included was found."
            : "No matching figure file was found.";
          popup.removeAttribute("aria-busy");
        }
        fragment.appendChild(empty);
        renderedRecords = nextRecords;
        list.replaceChildren(fragment);
        notifyPreviewSelection();
        return;
      }

      popup.removeAttribute("aria-busy");
      nextRecords.forEach((record, index) => {
        interactionTasks?.checkpoint?.(index, 8);
        const item = document.createElement("button");
        item.type = "button";
        item.className = "smarttex-figure-autocomplete-item";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
        item.classList.toggle("smarttex-figure-autocomplete-selected", index === selectedIndex);
        item.classList.toggle("smarttex-figure-autocomplete-exact", isExactCurrentPath(record.path));
        item.classList.toggle("smarttex-figure-autocomplete-included", record.included);
        item.dataset.smarttexFigurePath = record.path;

        const check = document.createElement("span");
        check.className = "smarttex-figure-autocomplete-check";
        check.textContent = record.included ? "✓" : "";
        check.setAttribute("aria-hidden", "true");
        const path = document.createElement("code");
        path.className = "smarttex-figure-autocomplete-path";
        path.textContent = record.path;
        path.title = record.path;
        const status = document.createElement("span");
        status.className = "smarttex-figure-autocomplete-status";
        status.textContent = record.included ? "Already included" : "";
        item.append(check, path, status);
        item.addEventListener("mouseenter", () => {
          if (selectedIndex !== index) {
            selectedIndex = index;
            updateSelectedItem();
          } else {
            notifyPreviewSelection();
          }
        });
        item.addEventListener("mousedown", (event) => event.preventDefault());
        item.addEventListener("click", () => insertRecord(record));
        fragment.appendChild(item);
      });
      renderedRecords = nextRecords;
      list.replaceChildren(fragment);
      notifyPreviewSelection();
    }

    function positionPopup() {
      if (popup.hidden || !currentState?.screen) return;
      const margin = 9;
      const width = Math.min(560, window.innerWidth - margin * 2);
      popup.style.width = `${Math.max(320, width)}px`;
      const cursorLeft = Number(currentState.screen.pageX) - window.scrollX;
      const cursorTop = Number(currentState.screen.pageY) - window.scrollY;
      const lineHeight = Math.max(14, Number(currentState.screen.lineHeight) || 18);
      const gap = lineHeight * 2;
      const belowSpace = window.innerHeight - margin - (cursorTop + lineHeight + gap);
      const aboveSpace = cursorTop - gap - margin;
      const availableSideSpace = Math.max(belowSpace, aboveSpace);
      popup.style.maxHeight = `${Math.round(Math.max(
        140,
        Math.min(470, window.innerHeight - margin * 2, availableSideSpace)
      ))}px`;
      const rect = popup.getBoundingClientRect();
      const cursorRect = {
        left: cursorLeft - 3,
        right: cursorLeft + 3,
        top: cursorTop - 2,
        bottom: cursorTop + lineHeight + 2
      };
      const currentRect = lastPopupPosition ? {
        left: lastPopupPosition.left,
        right: lastPopupPosition.left + rect.width,
        top: lastPopupPosition.top,
        bottom: lastPopupPosition.top + rect.height
      } : null;
      const blocksCursor = currentRect && !(
        currentRect.right < cursorRect.left || currentRect.left > cursorRect.right ||
        currentRect.bottom < cursorRect.top || currentRect.top > cursorRect.bottom
      );
      if (!lastPopupPosition || blocksCursor) {
        const fitsBelow = cursorTop + lineHeight + gap + rect.height <= window.innerHeight - margin;
        const top = fitsBelow ? cursorTop + lineHeight + gap : cursorTop - gap - rect.height;
        lastPopupPosition = {
          left: Math.max(margin, Math.min(cursorLeft, window.innerWidth - rect.width - margin)),
          top: Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))
        };
      }
      popup.style.left = `${Math.round(lastPopupPosition.left)}px`;
      popup.style.top = `${Math.round(lastPopupPosition.top)}px`;
      notifyPreviewSelection();
    }

    function showPopup() {
      if (!popupInteractionReady() || !currentContext) return;
      popup.hidden = false;
      popup.classList.add("smarttex-figure-autocomplete-visible");
      positionPopup();
    }

    function hidePopup() {
      popup.hidden = true;
      popup.removeAttribute("aria-busy");
      popup.classList.remove("smarttex-figure-autocomplete-visible");
      lastPopupPosition = null;
      // Do not release native-autocomplete suppression here. Temporary popup
      // hiding (scrolling, Escape, or a click elsewhere) must not allow
      // CollabTeX's filename list to take over while the caret is still in the
      // includegraphics argument. updateFromState() owns that lifecycle.
      notifyPreviewSelection();
    }

    async function insertRecord(record) {
      if (!record || !currentContext) return;
      hidePopup();
      try {
        await bridgeRequest("replaceFigureToken", { text: record.path });
      } catch (error) {
        renderPopup();
        showPopup();
        console.warn("SmartTeX could not insert the figure path:", error);
      }
    }

    function mergeFigures(values) {
      const merged = new Map(figures.map((path) => [normalizePath(path), path]));
      for (const value of Array.isArray(values) ? values : []) {
        const path = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
        if (!path || !FIGURE_PATTERN.test(path)) continue;
        merged.set(normalizePath(path), path);
      }
      figures = [...merged.values()].sort((left, right) => left.localeCompare(right, undefined, {
        sensitivity: "base", numeric: true
      }));
    }

    function startFullFigureLoad() {
      if (fullLoadStarted || !fullLoadRequested) return;
      fullLoadStarted = true;
      bridgeRequest("listProjectFigures", { full: true }, 20000).then((response) => {
        mergeFigures(response.figures);
        figuresLoaded = true;
        if (currentContext && !popup.hidden) renderPopup();
      }).catch(() => {
        figuresLoaded = true;
        if (currentContext && !popup.hidden) renderPopup();
      });
    }

    function ensureFigures({ requestFull = false, force = false } = {}) {
      if (requestFull) fullLoadRequested = true;
      const quickIsFresh = Date.now() - quickLoadedAt < 10000;
      if (!force && quickIsFresh && (figuresLoaded || figures.length)) {
        startFullFigureLoad();
        return;
      }
      if (quickLoadPromise) return;
      const generation = ++loadingGeneration;
      quickLoadPromise = bridgeRequest("listProjectFigures", { full: false }, 2500)
        .then((response) => {
          if (generation !== loadingGeneration) return;
          mergeFigures(response.figures);
          quickLoadedAt = Date.now();
          if (currentContext && !popup.hidden) renderPopup();
        })
        .catch(() => {})
        .finally(() => {
          quickLoadPromise = null;
          startFullFigureLoad();
        });
    }

    function updateFromState() {
      if (!popupInteractionReady()) {
        currentContext = null;
        setAutocompleteContextActive(false);
        hidePopup();
        return;
      }
      const nextContext = findFigureContext(currentState);
      setAutocompleteContextActive(Boolean(nextContext));
      if (!nextContext) {
        currentContext = null;
        hidePopup();
        return;
      }
      const previousId = contextId();
      currentContext = nextContext;
      const nextId = contextId();
      if (previousId !== nextId) selectedIndex = 0;
      renderPopup();
      showPopup();
      ensureFigures({ requestFull: true });
      bridgeRequest("getCoordinates", { index: currentContext.openIndex }, 1200).then((response) => {
        if (response.screen && currentState) {
          currentState = { ...currentState, screen: response.screen };
          positionPopup();
        }
      }).catch(() => {});
    }

    window.addEventListener(STATE_EVENT, (event) => {
      try {
        currentState = JSON.parse(String(event.detail || "null"));
      } catch (_error) {
        currentContext = null;
        setAutocompleteContextActive(false);
        hidePopup();
        return;
      }
      if (scrollSuppressed) {
        hidePopup();
        return;
      }
      updateFromState();
    });

    interactionTasks?.subscribe?.(() => {
      loadingGeneration += 1;
    });

    unusedButton.addEventListener("mousedown", (event) => event.preventDefault());
    unusedButton.addEventListener("click", () => {
      if (popup.hidden) return;
      const selectedPath = renderedRecords[selectedIndex]?.path || "";
      onlyUnused = !onlyUnused;
      renderPopup();
      if (selectedPath) {
        const nextIndex = renderedRecords.findIndex((record) => record.path === selectedPath);
        if (nextIndex >= 0) selectedIndex = nextIndex;
      }
      updateSelectedItem();
      positionPopup();
    });

    closeButton.addEventListener("mousedown", (event) => event.preventDefault());
    closeButton.addEventListener("click", () => {
      hidePopup();
      bridgeRequest("focus").catch(() => {});
    });

    document.addEventListener("keydown", (event) => {
      scrollSuppressed = false;
      if (popup.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        hidePopup();
        bridgeRequest("focus").catch(() => {});
        return;
      }
      if (!renderedRecords.length) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (renderedRecords.length === 1) {
          // A one-item includegraphics list has no alternative selection.
          // Keep the list visible while preserving normal editor navigation.
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
        insertRecord(renderedRecords[selectedIndex]);
      }
    }, true);

    document.addEventListener("beforeinput", () => { scrollSuppressed = false; }, true);
    document.addEventListener("input", () => { scrollSuppressed = false; }, true);

    document.addEventListener("mousedown", (event) => {
      scrollSuppressed = false;
      if (popup.hidden || popup.contains(event.target)) return;
      if (event.target?.closest?.(
        ".cm-content, .cm-line, .cm-scroller, .cm-editor, " +
        ".ace_content, .ace_text-layer, .ace_scroller, .ace_editor"
      )) return;
      hidePopup();
    }, true);

    window.addEventListener("resize", positionPopup, { passive: true });
    window.addEventListener("smarttex:editor-scroll-state", (event) => {
      if (event?.detail?.active !== true) return;
      scrollSuppressed = true;
      hidePopup();
    });
    window.addEventListener("scroll", (event) => {
      if (event.target instanceof Node && popup.contains(event.target)) return;
      positionPopup();
    }, true);

    ensureFigures();

    window.addEventListener("pagehide", () => {
      setAutocompleteContextActive(false);
      pendingRequests.forEach((pending) => {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error("SmartTeX page closed."));
      });
      pendingRequests.clear();
    }, { once: true });
  };

  initializeWhenDependenciesAreReady().catch((error) => {
    globalThis.__smartTeXFigureAutocompleteLoading = false;
    console.error(error?.message || "SmartTeX figure autocomplete could not load.", error);
  });
})();
