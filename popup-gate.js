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
