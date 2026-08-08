/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (window.top !== window || globalThis.__smartTeXEditorBootstrapLoaded) return;
  globalThis.__smartTeXEditorBootstrapLoaded = true;

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const POLL_INTERVAL_MS = 750;
  let initializationRequested = false;
  let pollTimer = 0;
  let retryTimer = 0;

  function visibleRect(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 160 && rect.height > 120);
  }

  function editorSurface() {
    const exactPanel = document.querySelector(
      "#ide-redesign-panel-source-editor, #ide-redesign-panel-editor"
    );
    if (exactPanel) {
      const surface = exactPanel.querySelector(
        ".cm-editor, .CodeMirror, .ace_editor, [contenteditable='true']"
      );
      if (surface && visibleRect(surface)) return surface;
    }

    // Fallback for CollabTeX deployments with renamed panel IDs. Require an
    // actual editor implementation and a source/editor-labelled ancestor so a
    // project-card or unrelated contenteditable field cannot activate SmartTeX.
    const candidates = document.querySelectorAll(".cm-editor, .CodeMirror, .ace_editor");
    for (const surface of candidates) {
      const owner = surface.closest(
        "[data-testid*='source-editor' i], [id*='source-editor' i], " +
        "[class*='source-editor' i], .editor-pane, .ide-redesign-editor-container"
      );
      if (owner && visibleRect(surface)) return surface;
    }
    return null;
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  function requestInitialization() {
    if (initializationRequested || !editorSurface()) return;
    initializationRequested = true;
    stopPolling();
    clearTimeout(retryTimer);
    retryTimer = 0;

    Promise.resolve(
      extensionApi?.runtime?.sendMessage?.({ type: "smarttex-initialize-editor" })
    ).then((response) => {
      if (response?.ok === false) throw new Error(response.error || "SmartTeX editor initialization failed.");
    }).catch((error) => {
      console.warn("SmartTeX editor initialization failed; retrying:", error);
      initializationRequested = false;
      retryTimer = window.setTimeout(startPolling, 750);
    });
  }

  function startPolling() {
    if (initializationRequested || pollTimer) return;
    if (editorSurface()) {
      requestInitialization();
      return;
    }

    // Deliberately avoid a document-wide MutationObserver here. The CollabTeX
    // project overview can generate thousands of React mutations while loading,
    // and previous SmartTeX observers were enough to stall that page. A single
    // cheap editor-presence check every 750 ms is effectively idle by comparison.
    pollTimer = window.setInterval(() => {
      if (editorSurface()) requestInitialization();
    }, POLL_INTERVAL_MS);
  }

  startPolling();

  window.addEventListener("pagehide", () => {
    stopPolling();
    clearTimeout(retryTimer);
  }, { once: true });
})();
