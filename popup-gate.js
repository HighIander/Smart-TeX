/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.SmartTeXPopupGate) return;

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
