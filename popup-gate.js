/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.SmartTeXPopupGate) return;

  // This file is registered origin-wide. The CollabTeX project overview is a
  // highly dynamic React page; observing its entire DOM solely to hide editor
  // popups is unnecessary and can make that page stall while project cards are
  // populated. Only install the popup observer when an actual editor exists.
  const hasEditorSurface = Boolean(document.querySelector(
    "#ide-redesign-panel-source-editor .cm-editor, " +
    "#ide-redesign-panel-source-editor .CodeMirror, " +
    "#ide-redesign-panel-source-editor .ace_editor, " +
    "#ide-redesign-panel-source-editor [contenteditable='true'], " +
    "#ide-redesign-panel-editor .cm-editor, " +
    "#ide-redesign-panel-editor .CodeMirror, " +
    "#ide-redesign-panel-editor .ace_editor, " +
    "#ide-redesign-panel-editor [contenteditable='true'], " +
    ".ide-redesign-editor-container .cm-editor, " +
    ".ide-redesign-editor-container .ace_editor, " +
    "[data-testid*='source-editor' i] .cm-editor, " +
    "[data-testid*='source-editor' i] .ace_editor, " +
    ".editor-pane .cm-editor, .editor-pane .ace_editor, " +
    "#editor.ace_editor, #editor .ace_editor"
  ));
  if (!hasEditorSurface) {
    globalThis.SmartTeXPopupGate = Object.freeze({
      isReady: () => true,
      onReady(listener) {
        if (typeof listener === "function") listener();
        return () => {};
      },
      hideInitialPopups() {}
    });
    return;
  }

  let ready = false;
  const listeners = new Set();
  const popupSelector = [
    "#smarttex-equation-preview",
    "#smarttex-reference-autocomplete-popup",
    "#smarttex-citation-popup",
    ".smarttex-document-reference-popup",
    ".smarttex-popup-loading-spinner"
  ].join(",");

  function hideInitialPopup(element) {
    if (!(element instanceof Element)) return;
    const candidates = element.matches?.(popupSelector)
      ? [element]
      : [...element.querySelectorAll?.(popupSelector) || []];
    for (const popup of candidates) {
      popup.hidden = true;
      popup.classList.remove(
        "smarttex-preview-visible",
        "smarttex-reference-autocomplete-visible",
        "smarttex-citation-visible"
      );
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (ready) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) hideInitialPopup(node);
    }
  });

  function unlock(event) {
    if (ready || event?.isTrusted === false) return;
    ready = true;
    observer.disconnect();
    for (const type of interactionEvents) {
      window.removeEventListener(type, unlock, true);
    }
    window.dispatchEvent(new CustomEvent("smarttex:popup-interaction-ready"));
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn("SmartTeX popup startup listener failed:", error);
      }
    }
    listeners.clear();
  }

  const interactionEvents = [
    "pointerdown",
    "pointermove",
    "keydown",
    "touchstart",
    "wheel"
  ];
  for (const type of interactionEvents) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }

  observer.observe(document.documentElement, { childList: true, subtree: true });
  hideInitialPopup(document.documentElement);

  globalThis.SmartTeXPopupGate = Object.freeze({
    isReady: () => ready,
    onReady(listener) {
      if (typeof listener !== "function") return () => {};
      if (ready) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hideInitialPopups: () => hideInitialPopup(document.documentElement)
  });
})();

/* Popup window chrome lives in this already-registered bootstrap so existing
   dynamic content-script registrations receive it after a normal page reload. */
(() => {
  "use strict";

  if (globalThis.SmartTeXPopupUI) return;

  const STORAGE_KEY = "smarttex:popup-sizes:v1";
  const RELATIVE_SCALE_KEY = "smarttex:popup-scale:v1";
  const TYPES = new Set(["list", "image", "equation", "table"]);
  const MINIMUM_SIZE = {
    list: { width: 280, height: 180 },
    image: { width: 180, height: 140 },
    equation: { width: 220, height: 120 },
    table: { width: 280, height: 180 }
  };
  const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const RELATIVE_SCALE_TYPES = new Set(["image", "equation", "table"]);
  const states = new WeakMap();

  function readSizes() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  let sizes = readSizes();

  function clampRelativeScale(value) {
    return Math.max(0.5, Math.min(2, Number(value) || 1));
  }

  function normalizeRelativeSettings(value = {}) {
    return {
      mode: value?.mode === "separate" ? "separate" : "global",
      global: clampRelativeScale(value?.global),
      image: clampRelativeScale(value?.image),
      equation: clampRelativeScale(value?.equation),
      table: clampRelativeScale(value?.table)
    };
  }

  function readRelativeSettings() {
    try {
      return normalizeRelativeSettings(JSON.parse(localStorage.getItem(RELATIVE_SCALE_KEY) || "{}"));
    } catch (_error) {
      return normalizeRelativeSettings();
    }
  }

  let relativeSettings = readRelativeSettings();

  function writeRelativeSettings() {
    try {
      localStorage.setItem(RELATIVE_SCALE_KEY, JSON.stringify(relativeSettings));
    } catch (_error) {
      // The current tab still uses the selected relative sizes if storage is restricted.
    }
  }

  function relativeScaleFor(type) {
    if (!RELATIVE_SCALE_TYPES.has(type)) return 1;
    return relativeSettings.mode === "separate"
      ? relativeSettings[type]
      : relativeSettings.global;
  }

  function writeSizes() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch (_error) {
      // A restricted document may not expose localStorage. Resizing still works
      // for the current popup instance in that case.
    }
  }

  function normalizedType(value) {
    return TYPES.has(value) ? value : "equation";
  }

  function viewportBounds() {
    const margin = 9;
    return {
      margin,
      width: Math.max(1, window.innerWidth - margin * 2),
      height: Math.max(1, window.innerHeight - margin * 2)
    };
  }

  function setContentScale(popup, value) {
    const scale = Math.max(0.2, Math.min(4, Number(value) || 1));
    popup.style.setProperty("--smarttex-popup-content-scale", scale.toFixed(4));
  }

  function measurableRect(popup) {
    if (popup.hidden || !popup.isConnected) return null;
    const rect = popup.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 ? rect : null;
  }

  function savedRatios(savedSize, naturalSize) {
    if (!savedSize || !naturalSize) return null;
    const widthRatio = Number(savedSize.widthRatio) || (
      Number(savedSize.width) > 0
        ? Number(savedSize.width) / Math.max(1, naturalSize.width)
        : 0
    );
    const heightRatio = Number(savedSize.heightRatio) || (
      Number(savedSize.height) > 0
        ? Number(savedSize.height) / Math.max(1, naturalSize.height)
        : 0
    );
    if (!(widthRatio > 0) || !(heightRatio > 0)) return null;
    return { widthRatio, heightRatio };
  }

  function applySize(popup, state, type, savedSize) {
    const naturalSize = state.naturalSizes[type];
    const ratios = savedRatios(savedSize, naturalSize);
    if (!ratios) return false;
    const bounds = viewportBounds();
    const minimum = MINIMUM_SIZE[type];
    const width = Math.min(
      bounds.width,
      Math.max(
        Math.min(minimum.width, bounds.width),
        naturalSize.width * ratios.widthRatio
      )
    );
    const height = Math.min(
      bounds.height,
      Math.max(
        Math.min(minimum.height, bounds.height),
        naturalSize.height * ratios.heightRatio
      )
    );
    popup.style.width = `${Math.round(width)}px`;
    popup.style.height = `${Math.round(height)}px`;
    popup.style.maxWidth = `${Math.round(bounds.width)}px`;
    popup.style.maxHeight = `${Math.round(bounds.height)}px`;
    popup.dataset.smarttexUserSized = "true";
    setContentScale(popup, Math.min(
      width / Math.max(1, naturalSize.width),
      height / Math.max(1, naturalSize.height)
    ));
    return true;
  }

  function scheduleSavedSize(popup, state, type) {
    const token = ++state.restoreToken;
    const restore = () => {
      if (token !== state.restoreToken || state.type !== type) return;
      const rect = measurableRect(popup);
      if (!rect || popup.dataset.smarttexUserSized === "true") return;
      state.naturalSizes[type] = { width: rect.width, height: rect.height };
      if (applySize(popup, state, type, sizes[type])) return;
      const relativeScale = relativeScaleFor(type);
      if (Math.abs(relativeScale - 1) > 0.001) {
        applySize(popup, state, type, {
          widthRatio: relativeScale,
          heightRatio: relativeScale,
          scale: relativeScale
        });
        popup.dataset.smarttexRelativeSized = "true";
      }
    };
    globalThis.requestAnimationFrame?.(() => globalThis.requestAnimationFrame?.(restore));
  }

  function clearSize(popup) {
    popup.style.removeProperty("width");
    popup.style.removeProperty("height");
    popup.style.removeProperty("max-width");
    popup.style.removeProperty("max-height");
    popup.style.removeProperty("--smarttex-popup-content-scale");
    delete popup.dataset.smarttexUserSized;
    delete popup.dataset.smarttexRelativeSized;
  }

  function ensureCloseChrome(popup, state) {
    const heading = (
      (state.options.heading instanceof Element ? state.options.heading : null) ||
      popup.querySelector(state.options.headingSelector || (
        ".smarttex-preview-heading, .smarttex-citation-header, " +
        ".smarttex-reference-autocomplete-header, .smarttex-figure-autocomplete-header, " +
        ".smarttex-reference-popup-heading, .smarttex-popup-window-heading"
      ))
    );
    if (!heading) return;
    heading.classList.add("smarttex-popup-window-heading-enhanced");

    let close = (
      (state.options.closeButton instanceof Element ? state.options.closeButton : null) ||
      heading.querySelector(
        ".smarttex-preview-close, .smarttex-citation-close, " +
        ".smarttex-reference-autocomplete-close, .smarttex-figure-autocomplete-close, " +
        ".smarttex-reference-popup-close, .smarttex-popup-window-close"
      )
    );
    if (!close) {
      close = document.createElement("button");
      close.type = "button";
      close.className = "smarttex-popup-window-close";
      close.textContent = "×";
      close.title = "Close (Esc)";
      close.setAttribute("aria-label", "Close popup");
      close.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      close.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof state.options.onClose === "function") state.options.onClose();
        else popup.hidden = true;
      });
      heading.appendChild(close);
    }
    close.hidden = false;

    let hint = heading.querySelector(".smarttex-popup-escape-hint");
    if (!hint) {
      hint = document.createElement("span");
      hint.className = "smarttex-popup-escape-hint";
      hint.textContent = "[Esc]";
      hint.setAttribute("aria-hidden", "true");
      close.before(hint);
    } else if (hint.nextElementSibling !== close) {
      close.before(hint);
    }
  }

  function ensureResizeHandles(popup, state) {
    for (const direction of DIRECTIONS) {
      let handle = popup.querySelector(
        `:scope > .smarttex-popup-resize-handle[data-direction="${direction}"]`
      );
      if (handle) continue;
      handle = document.createElement("span");
      handle.className = "smarttex-popup-resize-handle";
      handle.dataset.direction = direction;
      handle.setAttribute("aria-hidden", "true");
      handle.addEventListener("pointerdown", (event) => startResize(event, popup, state, direction));
      popup.appendChild(handle);
    }
  }

  function startResize(event, popup, state, direction) {
    if (event.button !== 0 || popup.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const rect = popup.getBoundingClientRect();
    const type = state.type;
    const minimum = MINIMUM_SIZE[type];
    const bounds = viewportBounds();
    delete popup.dataset.smarttexRelativeSized;
    const origin = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      naturalWidth: state.naturalSizes[type]?.width || rect.width,
      naturalHeight: state.naturalSizes[type]?.height || rect.height
    };
    popup.classList.add("smarttex-popup-resizing");
    document.documentElement.dataset.smarttexPopupResizeDirection = direction;
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      // Synthetic events used by UI harnesses do not represent an active
      // pointer, but can still exercise the resize calculation.
    }

    const pointerId = event.pointerId;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - origin.pointerX;
      const deltaY = moveEvent.clientY - origin.pointerY;
      let left = origin.left;
      let top = origin.top;
      let width = origin.width;
      let height = origin.height;

      if (direction.includes("e")) width = origin.width + deltaX;
      if (direction.includes("s")) height = origin.height + deltaY;
      if (direction.includes("w")) {
        width = origin.width - deltaX;
        left = origin.left + deltaX;
      }
      if (direction.includes("n")) {
        height = origin.height - deltaY;
        top = origin.top + deltaY;
      }

      width = Math.min(bounds.width, Math.max(Math.min(minimum.width, bounds.width), width));
      height = Math.min(bounds.height, Math.max(Math.min(minimum.height, bounds.height), height));
      if (direction.includes("w")) left = origin.left + origin.width - width;
      if (direction.includes("n")) top = origin.top + origin.height - height;
      left = Math.max(bounds.margin, Math.min(left, window.innerWidth - bounds.margin - width));
      top = Math.max(bounds.margin, Math.min(top, window.innerHeight - bounds.margin - height));

      popup.style.left = `${Math.round(left)}px`;
      popup.style.top = `${Math.round(top)}px`;
      popup.style.width = `${Math.round(width)}px`;
      popup.style.height = `${Math.round(height)}px`;
      popup.style.maxWidth = `${Math.round(bounds.width)}px`;
      popup.style.maxHeight = `${Math.round(bounds.height)}px`;
      popup.dataset.smarttexUserSized = "true";
      const widthRatio = width / Math.max(1, origin.naturalWidth);
      const heightRatio = height / Math.max(1, origin.naturalHeight);
      const contentScale = Math.min(widthRatio, heightRatio);
      setContentScale(popup, contentScale);
      popup.dispatchEvent(new CustomEvent("smarttex:popup-resized", {
        detail: { type, width, height, scale: contentScale, live: true }
      }));
    };

    const finish = (finishEvent) => {
      if (
        finishEvent?.type !== "blur" &&
        finishEvent?.pointerId !== undefined &&
        finishEvent.pointerId !== pointerId
      ) return;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      window.removeEventListener("blur", finish, true);
      try {
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      } catch (_error) {
        // The pointer may already have been released by the browser.
      }
      popup.classList.remove("smarttex-popup-resizing");
      delete document.documentElement.dataset.smarttexPopupResizeDirection;
      const finalRect = popup.getBoundingClientRect();
      const scale = Number.parseFloat(
        popup.style.getPropertyValue("--smarttex-popup-content-scale")
      ) || 1;
      sizes[type] = {
        widthRatio: finalRect.width / Math.max(1, origin.naturalWidth),
        heightRatio: finalRect.height / Math.max(1, origin.naturalHeight),
        scale
      };
      writeSizes();
      popup.dispatchEvent(new CustomEvent("smarttex:popup-resized", {
        detail: { type, width: finalRect.width, height: finalRect.height, scale, live: false }
      }));
    };

    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", finish, true);
  }

  function enhance(popup, options = {}) {
    if (!(popup instanceof Element)) return null;
    let state = states.get(popup);
    if (!state) {
      state = {
        popup,
        options: {},
        type: "equation",
        naturalSizes: {},
        restoreToken: 0,
        initialized: false,
        visibilityObserver: null
      };
      states.set(popup, state);
      state.visibilityObserver = new MutationObserver(() => {
        if (!popup.hidden) scheduleSavedSize(popup, state, state.type);
      });
      state.visibilityObserver.observe(popup, {
        attributes: true,
        attributeFilter: ["hidden"]
      });
    }
    state.options = { ...state.options, ...options };
    popup.classList.add("smarttex-popup-resizable");
    ensureCloseChrome(popup, state);
    ensureResizeHandles(popup, state);

    const setType = (nextType) => {
      const type = normalizedType(nextType);
      const firstType = !state.initialized;
      const switchedType = !firstType && type !== state.type;
      const changed = switchedType || popup.dataset.smarttexPopupType !== type;
      state.type = type;
      state.initialized = true;
      state.options.type = type;
      popup.dataset.smarttexPopupType = type;
      if (changed) {
        clearSize(popup);
        if (!firstType && switchedType && !popup.hidden) state.restoreAfterContent = true;
        else scheduleSavedSize(popup, state, type);
      } else if (
        sizes[type] &&
        (popup.dataset.smarttexUserSized !== "true" || !popup.style.width || !popup.style.height)
      ) {
        scheduleSavedSize(popup, state, type);
      }
      ensureCloseChrome(popup, state);
      ensureResizeHandles(popup, state);
    };
    setType(options.type || state.type);
    return {
      setType,
      refresh: ({ rebase = false } = {}) => {
        if (rebase && sizes[state.type]) {
          clearSize(popup);
          delete state.naturalSizes[state.type];
        }
        state.restoreAfterContent = false;
        scheduleSavedSize(popup, state, state.type);
        ensureCloseChrome(popup, state);
        ensureResizeHandles(popup, state);
      }
    };
  }

  function fitToViewport(popup) {
    const state = states.get(popup);
    if (!state || popup.dataset.smarttexUserSized !== "true") return;
    applySize(popup, state, state.type, sizes[state.type]);
  }

  function rebaseOpenPopups({ reset = false } = {}) {
    document.querySelectorAll(".smarttex-popup-resizable").forEach((popup) => {
      const state = states.get(popup);
      if (state) {
        state.restoreToken += 1;
        state.naturalSizes = {};
      }
      clearSize(popup);
      popup.dispatchEvent(new CustomEvent("smarttex:popup-resized", {
        detail: {
          type: normalizedType(popup.dataset.smarttexPopupType),
          reset,
          relativeScale: relativeScaleFor(normalizedType(popup.dataset.smarttexPopupType)),
          live: false
        }
      }));
      if (state && !popup.hidden) scheduleSavedSize(popup, state, state.type);
    });
  }

  function setRelativeSizeSettings(nextSettings) {
    relativeSettings = normalizeRelativeSettings(nextSettings);
    writeRelativeSettings();

    // A baseline-size selection deliberately replaces all ad-hoc manual resize ratios.
    sizes = {};
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_error) {
      // Current popup instances can still be rebased if storage is restricted.
    }
    rebaseOpenPopups();
    return { ...relativeSettings };
  }

  function resetSizes() {
    const requestedRelativeSettings = arguments[0]?.relativeSettings;
    sizes = {};
    relativeSettings = normalizeRelativeSettings(requestedRelativeSettings || {
      mode: relativeSettings.mode,
      global: 1,
      image: 1,
      equation: 1,
      table: 1
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(RELATIVE_SCALE_KEY, JSON.stringify(relativeSettings));
    } catch (_error) {
      // Current popup instances can still be reset in restricted documents.
    }
    rebaseOpenPopups({ reset: true });
  }

  window.addEventListener("smarttex:set-popup-relative-size", (event) => {
    setRelativeSizeSettings(event.detail);
  });
  window.addEventListener("smarttex:reset-popup-sizes", (event) => {
    resetSizes(event.detail || {});
  });

  window.addEventListener("resize", () => {
    document.querySelectorAll(".smarttex-popup-resizable").forEach(fitToViewport);
  }, { passive: true });

  globalThis.SmartTeXPopupUI = Object.freeze({
    enhance,
    fitToViewport,
    resetSizes,
    setRelativeSizeSettings,
    getRelativeSizeSettings: () => ({ ...relativeSettings })
  });
})();
