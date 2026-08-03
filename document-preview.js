/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.__smartTeXDocumentPreviewLoaded || window.top !== window) return;
  globalThis.__smartTeXDocumentPreviewLoaded = true;

  const STATE_EVENT = "smarttex:editor-state";
  const REQUEST_EVENT = "smarttex:citation-editor-request";
  const RESPONSE_EVENT = "smarttex:citation-editor-response";
  const SETTINGS_KEY = "smarttex:document-preview-settings:v1";
  const FEATURES_KEY = "smarttex:features:v1";
  const QUIET_RENDER_DELAY_MS = 1000;
  const CONTINUOUS_RENDER_INTERVAL_MS = 5000;
  const CURSOR_RENDER_DELAY_MS = 80;
  const WORK_SLICE_MS = 8;
  const FAST_STRUCTURAL_REGION_LIMIT = 30000;
  const DEFAULT_TEXT_SCALE = 100;
  const MIN_TEXT_SCALE = 65;
  const MAX_TEXT_SCALE = 145;
  const DEFAULT_ZOOM = 1;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 2.5;
  const ZOOM_STEP = 0.1;
  const PREVIEW_SELECTION_HIGHLIGHT = "smarttex-editor-selection";
  const TEXT_CARET = "\uE100";
  const TITLE_TOKEN = "\uE101TITLE\uE102";
  const TEXT_FORMAT_TOKENS = Object.freeze({
    bold: { open: "\uE120", close: "\uE121", className: "smarttex-document-bold" },
    italic: { open: "\uE122", close: "\uE123", className: "smarttex-document-italic" },
    underline: { open: "\uE124", close: "\uE125", className: "smarttex-document-underline" }
  });
  const TEXT_FORMAT_OPEN = new Map(
    Object.entries(TEXT_FORMAT_TOKENS).map(([style, token]) => [token.open, { style, ...token }])
  );
  const TEXT_FORMAT_CLOSE = new Map(
    Object.entries(TEXT_FORMAT_TOKENS).map(([style, token]) => [token.close, { style, ...token }])
  );
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const contextTools = globalThis.SmartTeXLatexContext;
  const tableRenderer = globalThis.SmartTeXTableRenderer;
  const katex = globalThis.katex;

  if (!contextTools || !tableRenderer || !katex?.render) {
    console.error("SmartTeX: The full-document preview renderer could not be loaded.");
    return;
  }

  let currentState = null;
  let liveEnabled = false;
  let renderTimer = null;
  let renderGeneration = 0;
  let pendingContentSince = null;
  let lastSeenFingerprint = "";
  let activeRenderGeneration = null;
  let integration = null;
  let controlsGroup = null;
  let toggleButton = null;
  let settingsButton = null;
  let settingsMenu = null;
  let textScaleInput = null;
  let textScaleOutput = null;
  let textScale = DEFAULT_TEXT_SCALE;
  let zoom = DEFAULT_ZOOM;
  let renderFigures = false;
  let figureHoverPreviewsEnabled = true;
  let preview = null;
  let observer = null;
  let fastCursorFrame = null;
  let fastStructureGeneration = 0;
  let pendingFastStructureSource = null;
  let lastRenderedSource = "";
  let zoomControls = null;
  let zoomStage = null;
  let zoomResizeObserver = null;
  let editingToolbar = null;
  let zoomOutput = null;
  let figureToggle = null;
  let requestCounter = 0;
  let suppressPreviewClick = false;
  let referencePopup = null;
  let referencePopupTimer = null;
  let referencePopupGeneration = 0;
  let nestedReferencePopup = null;
  let nestedReferencePopupTimer = null;
  let nestedReferencePopupGeneration = 0;
  let popupLoadingSpinner = null;
  let popupLoadingSpinnerGeneration = 0;
  let citationRecords = new Map();
  let citationRecordsPromise = null;
  let citationRecordsLoaded = false;
  let previewNavigationPreferredX = null;
  let previewKeyboardHandoff = false;
  let previewSelectionSyncTimer = null;
  let applyingPreviewSelection = false;
  let activitySpinner = null;
  let liveRenderBusy = false;
  const pendingRequests = new Map();

  function ensurePopupLoadingSpinner() {
    if (popupLoadingSpinner?.isConnected) return popupLoadingSpinner;
    popupLoadingSpinner = document.createElement("span");
    popupLoadingSpinner.className = "smarttex-popup-loading-spinner";
    popupLoadingSpinner.hidden = true;
    popupLoadingSpinner.setAttribute("role", "status");
    popupLoadingSpinner.setAttribute("aria-label", "Opening preview");
    document.body.appendChild(popupLoadingSpinner);
    return popupLoadingSpinner;
  }

  function elementIsHovered(element) {
    try {
      return Boolean(element?.isConnected && element.matches(":hover"));
    } catch (_error) {
      return false;
    }
  }

  function popupInteractionActive(popup) {
    return Boolean(
      popup && !popup.hidden && (
        elementIsHovered(popup) || popup.contains(document.activeElement)
      )
    );
  }

  function keepReferencePopupOpen() {
    window.clearTimeout(referencePopupTimer);
    window.clearTimeout(nestedReferencePopupTimer);
  }

  function bindReferencePopupInteractionGuards(popup) {
    popup.addEventListener("pointerenter", keepReferencePopupOpen);
    popup.addEventListener("pointerdown", keepReferencePopupOpen, true);
    popup.addEventListener("wheel", keepReferencePopupOpen, { passive: true });
    popup.addEventListener("scroll", keepReferencePopupOpen, { passive: true });
  }

  function popupPointerPosition(event, anchor = null) {
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    if (Number.isFinite(clientX) && Number.isFinite(clientY) && (clientX || clientY)) {
      return { clientX, clientY };
    }
    const rect = anchor?.getBoundingClientRect?.();
    return {
      clientX: Number(rect?.left ?? 0) + Math.min(18, Number(rect?.width ?? 0) / 2),
      clientY: Number(rect?.top ?? 0) + Math.min(18, Number(rect?.height ?? 0) / 2)
    };
  }

  function showPopupLoadingSpinner(event, anchor = null) {
    const spinner = ensurePopupLoadingSpinner();
    const position = popupPointerPosition(event, anchor);
    const generation = ++popupLoadingSpinnerGeneration;
    spinner.style.left = `${Math.round(position.clientX)}px`;
    spinner.style.top = `${Math.round(position.clientY)}px`;
    spinner.hidden = false;
    return generation;
  }

  function hidePopupLoadingSpinner(generation = null) {
    if (
      generation !== null &&
      generation !== undefined &&
      generation !== popupLoadingSpinnerGeneration
    ) return;
    popupLoadingSpinnerGeneration += 1;
    if (popupLoadingSpinner) popupLoadingSpinner.hidden = true;
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      (rect.width > 0 || rect.height > 0) &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  }

  function directChildWithin(element, container) {
    let child = element;
    while (child?.parentElement && child.parentElement !== container) {
      child = child.parentElement;
    }
    return child?.parentElement === container ? child : null;
  }

  function pdfToolbarCandidates() {
    const explicit = [
      "#ide-redesign-panel-pdf [role='toolbar']",
      "#ide-redesign-panel-pdf .toolbar-pdf",
      "#ide-redesign-panel-pdf .pdf-toolbar",
      "#ide-redesign-panel-pdf [class*='toolbar']",
      "[data-testid*='pdf-preview' i] [role='toolbar']",
      "[data-testid*='pdf' i] [class*='toolbar']",
      ".pdf-preview [role='toolbar']",
      ".pdf-preview .toolbar",
      ".pdf-viewer .toolbar"
    ];
    const candidates = explicit.flatMap((selector) => (
      [...document.querySelectorAll(selector)]
    ));
    const semanticButtons = [...document.querySelectorAll("button, a")]
      .filter((candidate) => {
        if (!isVisible(candidate) || candidate.closest(".smarttex-dialog-overlay")) {
          return false;
        }
        const label = [
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.textContent
        ].filter(Boolean).join(" ");
        return /recompile|compile|download pdf|logs and output|neu kompilieren/i.test(label);
      })
      .map((button) => (
        button.closest("[role='toolbar'], .toolbar-pdf, .pdf-toolbar, [class*='toolbar']")
      ))
      .filter(Boolean);
    return [...new Set([...candidates, ...semanticButtons])]
      .filter((candidate) => (
        isVisible(candidate) &&
        !candidate.closest("#ctca-bib-manager, .smarttex-dialog-overlay")
      ));
  }

  function nativePdfElementWithin(container, toolbar) {
    const selectors = [
      "iframe[src*='pdf' i]",
      "iframe[title*='pdf' i]",
      "embed[type='application/pdf']",
      "object[type='application/pdf']",
      ".pdf-viewer",
      ".pdf-preview",
      "[data-testid*='pdf-viewer' i]",
      "[class*='pdf-viewer']",
      "canvas"
    ];
    for (const selector of selectors) {
      const candidate = [...container.querySelectorAll(selector)].find((element) => (
        !toolbar.contains(element) &&
        !element.closest(".smarttex-document-preview")
      ));
      if (candidate) return candidate;
    }
    return null;
  }

  function locatePdfIntegration() {
    for (const toolbar of pdfToolbarCandidates()) {
      let container = toolbar.parentElement;
      for (let depth = 0; container && depth < 7; depth += 1) {
        const nativeElement = nativePdfElementWithin(container, toolbar);
        if (nativeElement) {
          const toolbarHost = directChildWithin(toolbar, container);
          const nativeHost = directChildWithin(nativeElement, container);
          if (toolbarHost && nativeHost && toolbarHost !== nativeHost) {
            return { toolbar, container, nativeHost };
          }
        }
        container = container.parentElement;
      }
    }
    return null;
  }

  function ensureActivitySpinner() {
    if (activitySpinner?.isConnected) return activitySpinner;
    activitySpinner = document.createElement("div");
    activitySpinner.className = "smarttex-document-activity-spinner";
    activitySpinner.hidden = true;
    activitySpinner.setAttribute("role", "status");
    activitySpinner.setAttribute("aria-live", "polite");
    activitySpinner.setAttribute("aria-label", "Rendering or compiling");
    activitySpinner.innerHTML = `
      <span class="smarttex-document-activity-spinner-ring" aria-hidden="true"></span>`;
    document.body.appendChild(activitySpinner);
    return activitySpinner;
  }

  function pdfCompileButtons() {
    const root = integration?.toolbar || document;
    return [...root.querySelectorAll("button, a")].filter((candidate) => {
      const label = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
        candidate.textContent
      ].filter(Boolean).join(" ");
      return /recompile|compile|kompilieren|neu kompilieren/i.test(label);
    });
  }

  function updateNativeRecompileVisibility() {
    const buttons = pdfCompileButtons().filter((button) => (
      !button.closest("#smarttex-document-preview-controls, .smarttex-dialog-overlay")
    ));
    document.querySelectorAll(".smarttex-native-recompile-hidden").forEach((button) => {
      if (!buttons.includes(button) || !liveEnabled) {
        button.classList.remove("smarttex-native-recompile-hidden");
      }
    });
    for (const button of buttons) {
      button.classList.toggle("smarttex-native-recompile-hidden", liveEnabled);
      button.setAttribute("aria-hidden", liveEnabled ? "true" : "false");
      if (!liveEnabled) button.removeAttribute("aria-hidden");
    }
  }

  function pdfCompilationBusy() {
    return pdfCompileButtons().some((button) => {
      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.textContent
      ].filter(Boolean).join(" ");
      const className = String(button.className || "");
      return (
        button.getAttribute("aria-busy") === "true" ||
        button.dataset?.loading === "true" ||
        /compiling|rendering|processing|loading|wird kompiliert/i.test(label) ||
        /(?:^|\s)(?:loading|is-loading|busy|compiling)(?:\s|$)/i.test(className) ||
        Boolean(button.querySelector(
          "[class*='spinner' i], [class*='loading' i], .fa-spin, [aria-label*='loading' i]"
        ))
      );
    });
  }

  function positionActivitySpinner() {
    const spinner = ensureActivitySpinner();
    const target = integration?.container || preview;
    if (!target?.isConnected) return;
    const rect = target.getBoundingClientRect();
    const top = `${Math.round(Math.max(8, rect.top + 10))}px`;
    const right = `${Math.round(Math.max(8, window.innerWidth - rect.right + 10))}px`;
    if (spinner.style.top !== top) spinner.style.top = top;
    if (spinner.style.right !== right) spinner.style.right = right;
  }

  function updateActivitySpinner() {
    const spinner = ensureActivitySpinner();
    const busy = Boolean(liveRenderBusy || pdfCompilationBusy());
    if (spinner.hidden === busy) spinner.hidden = !busy;
    if (busy) positionActivitySpinner();
  }

  function setLiveRenderBusy(value) {
    liveRenderBusy = Boolean(value);
    updateActivitySpinner();
  }

  function createToggleButton() {
    const button = document.createElement("button");
    button.id = "smarttex-document-preview-toggle";
    button.type = "button";
    button.className = "smarttex-document-preview-toggle";
    button.innerHTML = `
      <span class="smarttex-document-preview-toggle-mark" aria-hidden="true">S</span>
      <span>Live</span>`;
    button.setAttribute("aria-label", "Toggle SmartTeX live document preview");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setLiveEnabled(!liveEnabled);
    });
    return button;
  }

  function clampedTextScale(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_TEXT_SCALE;
    return Math.max(MIN_TEXT_SCALE, Math.min(MAX_TEXT_SCALE, Math.round(numeric)));
  }

  function savedPreviewSettings() {
    return {
      textScale,
      zoom,
      renderFigures
    };
  }

  function persistPreviewSettings() {
    if (!extensionApi?.storage?.local?.set) return;
    extensionApi.storage.local.set({
      [SETTINGS_KEY]: savedPreviewSettings()
    }).catch((error) => {
      console.warn("SmartTeX could not save the live-preview settings:", error);
    });
  }

  function applyTextScale(value, persist = false) {
    textScale = clampedTextScale(value);
    const fontSize = (13 * textScale / 100).toFixed(2);
    preview?.style.setProperty("--smarttex-document-font-size", `${fontSize}px`);
    if (textScaleInput) textScaleInput.value = String(textScale);
    if (textScaleOutput) textScaleOutput.textContent = `${textScale}%`;
    requestAnimationFrame(updateZoomLayout);
    if (persist) persistPreviewSettings();
  }

  function clampedZoom(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_ZOOM;
    return Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.round(numeric / ZOOM_STEP) * ZOOM_STEP)
    );
  }

  function updateZoomLayout() {
    const page = zoomStage?.querySelector(".smarttex-document-page");
    if (!page || !zoomStage?.isConnected) return;
    let baseWidth = Number(page.dataset.smarttexZoomBaseWidth);
    if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
      page.style.width = "";
      page.style.maxWidth = "";
      page.style.transform = "none";
      zoomStage.style.width = "100%";
      zoomStage.style.height = "auto";
      baseWidth = page.getBoundingClientRect().width;
      if (!Number.isFinite(baseWidth) || baseWidth <= 0) return;
      page.dataset.smarttexZoomBaseWidth = String(baseWidth);
      page.style.width = `${baseWidth}px`;
      page.style.maxWidth = "none";
    }
    page.style.transform = `scale(${zoom})`;
    page.style.transformOrigin = "top left";
    zoomStage.style.width = `${Math.max(1, baseWidth * zoom)}px`;
    zoomStage.style.height = `${Math.max(1, page.offsetHeight * zoom)}px`;
  }

  function applyZoom(value, persist = false) {
    zoom = clampedZoom(value);
    updateZoomLayout();
    if (zoomOutput) zoomOutput.textContent = `${Math.round(zoom * 100)}%`;
    if (persist) persistPreviewSettings();
  }

  function setRenderFigures(value, persist = false) {
    const nextValue = Boolean(value);
    const changed = renderFigures !== nextValue;
    renderFigures = nextValue;
    if (figureToggle) figureToggle.checked = renderFigures;
    if (persist) persistPreviewSettings();
    if (changed && liveEnabled) scheduleRender({ force: true });
  }

  function bridgeRequest(type, payload = {}, timeoutMs = 3000) {
    const requestId = `document-preview-${Date.now()}-${++requestCounter}`;
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

  function closeSettingsMenu() {
    if (!settingsMenu || !settingsButton) return;
    settingsMenu.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
  }

  function positionSettingsMenu() {
    if (!settingsMenu || !settingsButton || settingsMenu.hidden) return;
    const anchor = settingsButton.getBoundingClientRect();
    const menu = settingsMenu.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(anchor.right - menu.width, window.innerWidth - menu.width - margin)
    );
    const top = Math.min(
      window.innerHeight - menu.height - margin,
      anchor.bottom + 5
    );
    settingsMenu.style.left = `${Math.round(left)}px`;
    settingsMenu.style.top = `${Math.round(Math.max(margin, top))}px`;
  }

  function toggleSettingsMenu() {
    if (!settingsMenu || !settingsButton) return;
    settingsMenu.hidden = !settingsMenu.hidden;
    settingsButton.setAttribute(
      "aria-expanded",
      settingsMenu.hidden ? "false" : "true"
    );
    if (!settingsMenu.hidden) {
      positionSettingsMenu();
      textScaleInput?.focus({ preventScroll: true });
    }
  }

  function createSettingsMenu() {
    const menu = document.createElement("div");
    menu.id = "smarttex-document-preview-settings";
    menu.className = "smarttex-document-preview-settings";
    menu.hidden = true;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Live preview display settings");

    const heading = document.createElement("strong");
    heading.textContent = "Preview display";
    const row = document.createElement("label");
    row.className = "smarttex-document-preview-size-row";
    const label = document.createElement("span");
    label.textContent = "Text size";
    textScaleInput = document.createElement("input");
    textScaleInput.type = "range";
    textScaleInput.min = String(MIN_TEXT_SCALE);
    textScaleInput.max = String(MAX_TEXT_SCALE);
    textScaleInput.step = "1";
    textScaleInput.value = String(textScale);
    textScaleInput.setAttribute("aria-label", "Live preview text size");
    textScaleOutput = document.createElement("output");
    textScaleOutput.value = String(textScale);
    textScaleOutput.textContent = `${textScale}%`;
    textScaleInput.addEventListener("input", () => {
      applyTextScale(textScaleInput.value, true);
    });
    row.append(label, textScaleInput, textScaleOutput);
    const figureRow = document.createElement("label");
    figureRow.className = "smarttex-document-preview-option-row";
    figureToggle = document.createElement("input");
    figureToggle.type = "checkbox";
    figureToggle.checked = renderFigures;
    figureToggle.addEventListener("change", () => {
      setRenderFigures(figureToggle.checked, true);
    });
    const figureLabel = document.createElement("span");
    figureLabel.textContent = "Render figures";
    figureRow.append(figureToggle, figureLabel);
    menu.append(heading, row, figureRow);
    document.body.appendChild(menu);
    return menu;
  }

  function createZoomControls() {
    const controls = document.createElement("div");
    controls.className = "smarttex-document-zoom-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Preview zoom");
    const button = (label, title, delta) => {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = label;
      item.title = title;
      item.setAttribute("aria-label", title);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyZoom(zoom + delta, true);
      });
      return item;
    };
    const zoomOut = button("−", "Zoom out", -ZOOM_STEP);
    zoomOutput = document.createElement("output");
    zoomOutput.textContent = `${Math.round(zoom * 100)}%`;
    const zoomIn = button("+", "Zoom in", ZOOM_STEP);
    controls.append(zoomOut, zoomOutput, zoomIn);
    return controls;
  }

  function sourceSelectionRange({ currentLine = false } = {}) {
    const source = String(currentState?.value || "");
    let start = Math.max(
      0,
      Math.min(
        Number(currentState?.selectionFrom ?? currentState?.cursorIndex) || 0,
        source.length
      )
    );
    let end = Math.max(
      start,
      Math.min(
        Number(currentState?.selectionTo ?? currentState?.cursorIndex) || 0,
        source.length
      )
    );
    if (currentLine && start === end) {
      start = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const lineEnd = source.indexOf("\n", end);
      end = lineEnd < 0 ? source.length : lineEnd;
    }
    return { source, start, end, text: source.slice(start, end) };
  }

  async function replacePreviewSource(
    start,
    end,
    text,
    selectionStart,
    selectionEnd,
    focusEditor = false
  ) {
    if (!currentState) return false;
    const source = String(currentState.value || "");
    const replacement = String(text || "");
    const boundedStart = Math.max(0, Math.min(Number(start) || 0, source.length));
    const boundedEnd = Math.max(
      boundedStart,
      Math.min(Number(end) || 0, source.length)
    );
    const nextSelectionStart = Math.max(
      boundedStart,
      Math.min(
        Number(selectionStart ?? boundedStart + replacement.length),
        boundedStart + replacement.length
      )
    );
    const nextSelectionEnd = Math.max(
      boundedStart,
      Math.min(
        Number(selectionEnd ?? nextSelectionStart),
        boundedStart + replacement.length
      )
    );
    const request = bridgeRequest("replaceRange", {
      start: boundedStart,
      end: boundedEnd,
      text: replacement,
      selectionStart: nextSelectionStart,
      selectionEnd: nextSelectionEnd,
      focus: focusEditor
    });
    const value = (
      source.slice(0, boundedStart) +
      replacement +
      source.slice(boundedEnd)
    );

    // Update the live preview optimistically instead of waiting for the editor
    // bridge round trip. The editor still remains the source of truth and its
    // following state event reconciles any unexpected difference.
    currentState = {
      ...currentState,
      value,
      cursorIndex: nextSelectionEnd,
      selectionFrom: Math.min(nextSelectionStart, nextSelectionEnd),
      selectionTo: Math.max(nextSelectionStart, nextSelectionEnd),
      selectionAnchor: nextSelectionStart,
      selectionHead: nextSelectionEnd,
      focused: Boolean(focusEditor)
    };
    updateEditingToolbarState();
    // Apply the active text-segment patch synchronously. Toolbar commands are
    // initiated from the preview UI, so waiting even for the next animation
    // frame makes short formatting operations feel delayed. The wider flow
    // region render below still follows to reconcile lists, paragraph shape,
    // references, and neighbouring text exactly.
    updateFastCursor({ ...currentState });
    const fastMode = updatePreviewAfterSourceMutation(
      source,
      currentState,
      { preferRegion: true }
    );
    if (fastMode === "force") {
      scheduleRender({ force: true, contentChanged: true });
    } else {
      scheduleRender({ contentChanged: true });
    }

    const response = await request;
    if (!response?.ok) {
      scheduleRender({ force: true, contentChanged: true });
      return false;
    }
    return true;
  }

  function closingBraceIndex(source, openIndex) {
    if (source[openIndex] !== "{") return -1;
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
      if (source[index] === "\\" && !/[A-Za-z@]/.test(source[index + 1] || "")) {
        index += 1;
        continue;
      }
      if (source[index] === "{") depth += 1;
      if (source[index] !== "}") continue;
      depth -= 1;
      if (depth === 0) return index;
    }
    return -1;
  }

  function enclosingTextCommand(source, start, end, prefix) {
    let commandStart = source.lastIndexOf(prefix, start);
    while (commandStart >= 0) {
      const contentStart = commandStart + prefix.length;
      const close = closingBraceIndex(source, contentStart - 1);
      if (close >= end && start >= contentStart) {
        return {
          start: commandStart,
          end: close + 1,
          contentStart,
          contentEnd: close
        };
      }
      commandStart = source.lastIndexOf(prefix, commandStart - 1);
    }
    return null;
  }

  function toggleWrappedSource(prefix, suffix) {
    const range = sourceSelectionRange();
    const enclosing = enclosingTextCommand(
      range.source,
      range.start,
      range.end,
      prefix
    );
    if (enclosing && suffix === "}") {
      const content = range.source.slice(enclosing.contentStart, enclosing.contentEnd);
      const selectionStart = (
        enclosing.start +
        Math.max(0, range.start - enclosing.contentStart)
      );
      const selectionEnd = (
        enclosing.start +
        Math.max(0, range.end - enclosing.contentStart)
      );
      return replacePreviewSource(
        enclosing.start,
        enclosing.end,
        content,
        selectionStart,
        selectionEnd
      );
    }
    if (
      range.text.startsWith(prefix) &&
      range.text.endsWith(suffix) &&
      range.text.length >= prefix.length + suffix.length
    ) {
      const content = range.text.slice(prefix.length, -suffix.length);
      return replacePreviewSource(
        range.start,
        range.end,
        content,
        range.start,
        range.start + content.length
      );
    }
    const replacement = `${prefix}${range.text}${suffix}`;
    const selectionStart = range.start + prefix.length;
    const selectionEnd = selectionStart + range.text.length;
    return replacePreviewSource(
      range.start,
      range.end,
      replacement,
      selectionStart,
      selectionEnd
    );
  }

  function enclosingListEnvironment(range) {
    return environmentContexts(
      range.source,
      new Set(["itemize", "enumerate"])
    ).filter((context) => (
      range.start >= context.contentStart &&
      range.end <= context.contentEnd
    )).sort((left, right) => (
      (left.closeEnd - left.openStart) - (right.closeEnd - right.openStart)
    ))[0] || null;
  }

  function listSelectedSource(environment) {
    const range = sourceSelectionRange({ currentLine: true });
    const enclosing = enclosingListEnvironment(range);
    if (enclosing?.environment === environment) {
      const body = range.source
        .slice(enclosing.contentStart, enclosing.contentEnd)
        .replace(
          /(^|\r?\n)[ \t]*\\item(?:\s*\[[^\]]*\])?[ \t]*/g,
          "$1"
        )
        .replace(/^\r?\n/, "")
        .replace(/\r?\n[ \t]*$/, "");
      return replacePreviewSource(
        enclosing.openStart,
        enclosing.closeEnd,
        body,
        enclosing.openStart,
        enclosing.openStart + body.length
      );
    }
    if (enclosing) {
      const body = range.source.slice(enclosing.contentStart, enclosing.contentEnd);
      const opening = `\\begin{${environment}}`;
      const closing = `\\end{${environment}}`;
      return replacePreviewSource(
        enclosing.openStart,
        enclosing.closeEnd,
        opening + body + closing,
        enclosing.openStart + opening.length,
        enclosing.openStart + opening.length + body.length
      );
    }
    const lines = range.text.split(/\r?\n/);
    const items = lines.map((line) => `\\item ${line.trim()}`).join("\n");
    const opening = `\\begin{${environment}}\n`;
    const closing = `\n\\end{${environment}}`;
    return replacePreviewSource(
      range.start,
      range.end,
      opening + items + closing,
      range.start + opening.length + "\\item ".length,
      range.start + opening.length + items.length
    );
  }

  function updateEditingToolbarState() {
    if (!editingToolbar || !currentState) return;
    const range = sourceSelectionRange();
    for (const button of editingToolbar.querySelectorAll(
      "button[data-smarttex-command]"
    )) {
      const active = Boolean(enclosingTextCommand(
        range.source,
        range.start,
        range.end,
        button.dataset.smarttexCommand
      ));
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const list = enclosingListEnvironment(range);
    for (const button of editingToolbar.querySelectorAll(
      "button[data-smarttex-environment]"
    )) {
      button.setAttribute(
        "aria-pressed",
        list?.environment === button.dataset.smarttexEnvironment ? "true" : "false"
      );
    }
  }

  function unusedLabel(prefix, base) {
    const source = String(currentState?.value || "");
    let candidate = `${prefix}:${base}`;
    let number = 2;
    while (source.includes(`\\label{${candidate}}`)) {
      candidate = `${prefix}:${base}-${number}`;
      number += 1;
    }
    return candidate;
  }

  function insertEquationEnvironment() {
    const range = sourceSelectionRange();
    const label = unusedLabel("eq", "equation");
    const body = range.text;
    const opening = "\\begin{equation}\n";
    const beforeLabel = `${body}${body ? "\n" : ""}`;
    const closing = `\\label{${label}}\n\\end{equation}`;
    const replacement = opening + beforeLabel + closing;
    const bodyStart = range.start + opening.length;
    return replacePreviewSource(
      range.start,
      range.end,
      replacement,
      bodyStart,
      bodyStart + body.length
    );
  }

  function insertFigureEnvironment() {
    const range = sourceSelectionRange();
    const label = unusedLabel("fig", "figure");
    const opening = [
      "\\begin{figure}",
      "\\centering",
      "\\includegraphics[width=0.8\\linewidth]{"
    ].join("\n");
    const closing = [
      "}",
      "\\caption{}",
      `\\label{${label}}`,
      "\\end{figure}"
    ].join("\n");
    const replacement = `${opening}${closing}`;
    const pathPosition = range.start + opening.length;
    return replacePreviewSource(
      range.start,
      range.end,
      replacement,
      pathPosition,
      pathPosition
    );
  }

  function toolbarIcon(markup) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;
  }

  function createEditingToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "smarttex-document-editing-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Format selected LaTeX text");
    toolbar.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) event.preventDefault();
    });
    const button = (title, icon, action) => {
      const item = document.createElement("button");
      item.type = "button";
      item.title = title;
      item.setAttribute("aria-label", title);
      item.innerHTML = icon;
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        Promise.resolve(action()).catch((error) => {
          console.error(`SmartTeX ${title.toLowerCase()} failed:`, error);
        });
      });
      return item;
    };
    const bold = button(
      "Bold",
      '<span class="smarttex-toolbar-letter"><strong>B</strong></span>',
      () => toggleWrappedSource("\\textbf{", "}")
    );
    bold.dataset.smarttexCommand = "\\textbf{";
    bold.setAttribute("aria-pressed", "false");
    const italic = button(
      "Italic",
      '<span class="smarttex-toolbar-letter"><em>I</em></span>',
      () => toggleWrappedSource("\\textit{", "}")
    );
    italic.dataset.smarttexCommand = "\\textit{";
    italic.setAttribute("aria-pressed", "false");
    const underline = button(
      "Underline",
      '<span class="smarttex-toolbar-letter smarttex-toolbar-underlined">U</span>',
      () => toggleWrappedSource("\\underline{", "}")
    );
    underline.dataset.smarttexCommand = "\\underline{";
    underline.setAttribute("aria-pressed", "false");
    const size = document.createElement("select");
    size.title = "Text size";
    size.setAttribute("aria-label", "Text size");
    [
      ["", "Size"],
      ["tiny", "Tiny"],
      ["scriptsize", "Script"],
      ["footnotesize", "Footnote"],
      ["small", "Small"],
      ["normalsize", "Normal"],
      ["large", "Large"],
      ["Large", "Larger"],
      ["LARGE", "Very large"],
      ["huge", "Huge"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      size.appendChild(option);
    });
    size.addEventListener("change", () => {
      const command = size.value;
      size.value = "";
      if (!command) return;
      toggleWrappedSource(`{\\${command} `, "}").catch((error) => {
        console.error("SmartTeX text-size formatting failed:", error);
      });
    });
    const itemize = button(
      "Bulleted list",
      toolbarIcon(
        '<circle cx="4" cy="6" r="1.4"/><circle cx="4" cy="12" r="1.4"/>' +
        '<circle cx="4" cy="18" r="1.4"/><path d="M8 6h12M8 12h12M8 18h12"/>'
      ),
      () => listSelectedSource("itemize")
    );
    itemize.dataset.smarttexEnvironment = "itemize";
    itemize.setAttribute("aria-pressed", "false");
    const enumerate = button(
      "Numbered list",
      toolbarIcon(
        '<text x="2" y="8" font-size="7" font-weight="700">1</text>' +
        '<text x="2" y="15" font-size="7" font-weight="700">2</text>' +
        '<text x="2" y="22" font-size="7" font-weight="700">3</text>' +
        '<path d="M9 6h11M9 12h11M9 18h11"/>'
      ),
      () => listSelectedSource("enumerate")
    );
    enumerate.dataset.smarttexEnvironment = "enumerate";
    enumerate.setAttribute("aria-pressed", "false");
    const addFigure = button(
      "Add figure",
      toolbarIcon(
        '<rect x="3" y="4" width="18" height="16" rx="2"/>' +
        '<circle cx="8" cy="9" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>'
      ),
      insertFigureEnvironment
    );
    const addEquation = button(
      "Add equation",
      toolbarIcon(
        '<path d="M18.5 4H7l5 8-5 8h11.5M14 8h6M14 16h6"/>'
      ),
      insertEquationEnvironment
    );
    const divider = () => {
      const item = document.createElement("span");
      item.className = "smarttex-document-toolbar-divider";
      item.setAttribute("aria-hidden", "true");
      return item;
    };
    toolbar.append(
      bold,
      italic,
      underline,
      size,
      divider(),
      itemize,
      enumerate,
      divider(),
      addFigure,
      addEquation
    );
    updateEditingToolbarState();
    return toolbar;
  }

  function createControlsGroup() {
    const group = document.createElement("div");
    group.id = "smarttex-document-preview-controls";
    group.className = "smarttex-document-preview-controls";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "SmartTeX live preview");
    toggleButton = createToggleButton();
    settingsButton = document.createElement("button");
    settingsButton.id = "smarttex-document-preview-settings-button";
    settingsButton.type = "button";
    settingsButton.className = "smarttex-document-preview-settings-button";
    settingsButton.innerHTML = `
      <span aria-hidden="true">▾</span>`;
    settingsButton.title = "Live preview display settings";
    settingsButton.setAttribute("aria-label", "Live preview display settings");
    settingsButton.setAttribute("aria-haspopup", "dialog");
    settingsButton.setAttribute("aria-expanded", "false");
    settingsButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSettingsMenu();
    });
    group.append(toggleButton, settingsButton);
    return group;
  }

  function editorToolbarCandidates() {
    const selectors = [
      ".toolbar.toolbar-editor",
      "#ide-redesign-panel-editor [role='toolbar']",
      "#ide-redesign-panel-editor .ol-cm-toolbar",
      "#ide-redesign-panel-editor [class*='toolbar']",
      "[data-testid*='editor' i] [role='toolbar']",
      "[data-testid*='editor' i] [class*='toolbar']",
      ".editor-pane [role='toolbar']",
      ".editor-pane [class*='toolbar']"
    ];
    return [...new Set(selectors.flatMap((selector) => (
      [...document.querySelectorAll(selector)]
    )))].filter((candidate) => (
      isVisible(candidate) &&
      !candidate.closest("#ide-redesign-panel-pdf, [data-testid*='pdf' i]") &&
      !candidate.closest(".smarttex-document-preview, .smarttex-dialog-overlay")
    ));
  }

  function parsedRgb(value) {
    const match = String(value || "").match(
      /rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i
    );
    return match ? match.slice(1, 4).map(Number) : null;
  }

  function visibleBackgroundColor(element) {
    let current = element;
    while (current && current !== document.documentElement) {
      const color = getComputedStyle(current).backgroundColor;
      const rgb = parsedRgb(color);
      if (rgb && color !== "rgba(0, 0, 0, 0)") return rgb;
      current = current.parentElement;
    }
    return parsedRgb(getComputedStyle(document.body).backgroundColor);
  }

  function editorUsesDarkMode(editorToolbar = editorToolbarCandidates()[0] || null) {
    const themeMarker = [
      document.documentElement.className,
      document.body?.className,
      document.documentElement.dataset?.theme,
      document.body?.dataset?.theme
    ].filter(Boolean).join(" ");
    if (/(?:^|[\s_-])dark(?:$|[\s_-])/i.test(themeMarker)) return true;
    if (/(?:^|[\s_-])light(?:$|[\s_-])/i.test(themeMarker)) return false;
    const editorSurface = document.querySelector(
      "#ide-redesign-panel-editor .cm-editor, " +
      "#ide-redesign-panel-editor .cm-scroller, " +
      "#ide-redesign-panel-editor .CodeMirror, " +
      "[data-testid*='editor' i] .cm-editor, " +
      ".editor-pane .cm-editor"
    );
    const rgb = visibleBackgroundColor(editorSurface || editorToolbar);
    if (!rgb) return globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false;
    const [red, green, blue] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.32;
  }

  function updateEditingToolbarTheme(editorToolbar = editorToolbarCandidates()[0] || null) {
    if (!editingToolbar) return;
    editingToolbar.classList.toggle(
      "smarttex-editor-dark",
      Boolean(editorToolbar && editorUsesDarkMode(editorToolbar))
    );
  }

  function pdfDownloadToolbarItem(toolbar) {
    const download = [...toolbar.querySelectorAll("button, a")].find((candidate) => {
      const label = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
        candidate.textContent
      ].filter(Boolean).join(" ");
      return /download(?:\s+pdf)?|herunterladen/i.test(label);
    });
    return download ? directChildWithin(download, toolbar) || download : null;
  }

  function attachEditingToolbar() {
    if (!editingToolbar || !integration?.toolbar) return;
    const editorToolbar = editorToolbarCandidates()[0] || null;
    const host = editorToolbar || integration.toolbar;
    updateEditingToolbarTheme(editorToolbar);
    editingToolbar.classList.toggle(
      "smarttex-document-editing-toolbar-editor",
      Boolean(editorToolbar)
    );
    editingToolbar.classList.toggle(
      "smarttex-document-editing-toolbar-pdf",
      !editorToolbar
    );
    if (editorToolbar) {
      if (editingToolbar.parentElement !== host) host.appendChild(editingToolbar);
      return;
    }
    const downloadItem = pdfDownloadToolbarItem(host);
    const insertionPoint = downloadItem?.nextSibling || null;
    if (
      editingToolbar.parentElement !== host ||
      (
        downloadItem
          ? editingToolbar.previousSibling !== downloadItem
          : editingToolbar.nextSibling !== null
      )
    ) {
      host.insertBefore(editingToolbar, insertionPoint);
    }
  }

  function attachPdfIntegration() {
    const found = locatePdfIntegration();
    if (!found) return;
    integration = found;
    updateNativeRecompileVisibility();
    ensureActivitySpinner();
    updateActivitySpinner();
    if (!controlsGroup || !controlsGroup.isConnected) {
      controlsGroup = createControlsGroup();
    }
    if (controlsGroup.parentElement !== integration.toolbar) {
      integration.toolbar.appendChild(controlsGroup);
    }
    if (!settingsMenu || !settingsMenu.isConnected) settingsMenu = createSettingsMenu();
    if (!preview || !preview.isConnected) {
      preview = document.createElement("section");
      preview.className = "smarttex-document-preview";
      preview.hidden = true;
      preview.tabIndex = 0;
      preview.setAttribute("aria-label", "SmartTeX live document preview");
      applyTextScale(textScale);
      bindPreviewInteractions(preview);
    }
    if (!zoomControls || !zoomControls.isConnected) {
      zoomControls = createZoomControls();
    }
    if (!editingToolbar || !editingToolbar.isConnected) {
      editingToolbar = createEditingToolbar();
    }
    attachEditingToolbar();
    if (preview.parentElement !== integration.container) {
      integration.container.insertBefore(preview, integration.nativeHost);
    }
    applyLiveMode();
  }

  function applyLiveMode() {
    if (!integration || !toggleButton || !preview) return;
    const startingLivePreview = liveEnabled && preview.hidden;
    integration.nativeHost.classList.toggle(
      "smarttex-document-native-hidden",
      liveEnabled
    );
    preview.hidden = !liveEnabled;
    toggleButton.classList.toggle("smarttex-document-preview-toggle-active", liveEnabled);
    settingsButton?.classList.toggle(
      "smarttex-document-preview-settings-button-active",
      liveEnabled
    );
    controlsGroup?.classList.toggle(
      "smarttex-document-preview-controls-active",
      liveEnabled
    );
    toggleButton.setAttribute("aria-pressed", liveEnabled ? "true" : "false");
    toggleButton.title = liveEnabled
      ? "Show the compiled PDF preview"
      : "Show the SmartTeX live KaTeX preview";
    document.documentElement.classList.toggle(
      "smarttex-document-live",
      liveEnabled
    );
    updateNativeRecompileVisibility();
    if (startingLivePreview) scheduleRender({ force: true });
  }

  function setLiveEnabled(value) {
    liveEnabled = Boolean(value);
    if (!liveEnabled && fastCursorFrame !== null) {
      cancelAnimationFrame(fastCursorFrame);
      fastCursorFrame = null;
    }
    attachPdfIntegration();
    applyLiveMode();
  }

  function documentBounds(source) {
    const begin = /\\begin\s*\{document\}/g.exec(source);
    if (!begin) return { start: 0, end: source.length };
    const start = begin.index + begin[0].length;
    const endPattern = /\\end\s*\{document\}/g;
    endPattern.lastIndex = start;
    const end = endPattern.exec(source);
    return {
      start,
      end: end ? end.index : source.length
    };
  }

  function commandArgument(source, name) {
    const pattern = new RegExp(`\\\\${name}\\s*\\{([^{}]*)\\}`, "i");
    return pattern.exec(source)?.[1]?.trim() || "";
  }

  function documentMetadata(source) {
    return {
      title: commandArgument(source, "title"),
      author: commandArgument(source, "author"),
      date: commandArgument(source, "date")
    };
  }

  function sourceContexts(source, bounds) {
    const equations = contextTools.equationContexts(source).contexts.map((context) => ({
      ...context,
      previewType: "equation",
      source: source.slice(context.contentStart, context.contentEnd)
    }));
    const tables = contextTools.tableContexts(source).map((context) => ({
      ...context,
      previewType: "table",
      source: source.slice(context.contentStart, context.contentEnd)
    }));
    const figures = environmentContexts(source, new Set(["figure", "figure*"]))
      .map((context) => ({
        ...context,
        display: true,
        previewType: "figure",
        source: source.slice(context.contentStart, context.contentEnd)
      }));
    const sorted = [...equations, ...tables, ...figures]
      .filter((context) => (
        context.openStart >= bounds.start &&
        context.closeEnd <= bounds.end
      ))
      .sort((left, right) => (
        left.openStart - right.openStart ||
        right.closeEnd - left.closeEnd
      ));
    const selected = [];
    let coveredUntil = bounds.start;
    for (const context of sorted) {
      if (context.openStart < coveredUntil) continue;
      selected.push(context);
      coveredUntil = context.closeEnd;
    }
    return selected;
  }

  function environmentContexts(sourceValue, names) {
    const source = String(sourceValue || "");
    const masked = contextTools.maskIgnoredLatex(source);
    const pattern = /\\(begin|end)\s*\{([^{}\r\n]+)\}/g;
    const stack = [];
    const contexts = [];
    let match;
    while ((match = pattern.exec(masked))) {
      const kind = match[1];
      const environment = match[2].trim();
      if (kind === "begin") {
        stack.push({
          environment,
          openStart: match.index,
          contentStart: match.index + match[0].length
        });
        continue;
      }
      let openingIndex = stack.length - 1;
      while (
        openingIndex >= 0 &&
        stack[openingIndex].environment !== environment
      ) {
        openingIndex -= 1;
      }
      if (openingIndex < 0) continue;
      const opening = stack[openingIndex];
      stack.splice(openingIndex);
      if (!names.has(environment)) continue;
      contexts.push({
        ...opening,
        contentEnd: match.index,
        closeEnd: match.index + match[0].length,
        complete: true
      });
    }
    return contexts;
  }

  function labelsWithin(source, start, end) {
    const labels = [];
    const pattern = /\\label\s*\{([^{}]+)\}/g;
    pattern.lastIndex = start;
    let match;
    while ((match = pattern.exec(source)) && match.index < end) {
      labels.push({
        label: match[1].trim(),
        index: match.index
      });
    }
    return labels;
  }

  function documentReferenceModel(sourceValue) {
    const source = String(sourceValue || "");
    const targets = new Map();
    const targetList = [];
    const register = (target) => {
      if (!target?.label || targets.has(target.label)) return;
      targets.set(target.label, target);
      targetList.push(target);
    };

    const equationContexts = contextTools.equationContexts(source).contexts;
    for (const context of equationContexts) {
      for (const label of labelsWithin(source, context.openStart, context.closeEnd)) {
        register({
          ...label,
          type: "equation",
          sourceIndex: context.openStart,
          contextStart: context.openStart,
          contextEnd: context.closeEnd
        });
      }
    }

    const figures = environmentContexts(source, new Set(["figure", "figure*"]))
      .sort((left, right) => left.openStart - right.openStart);
    let figureNumber = 0;
    for (const context of figures) {
      const body = source.slice(context.contentStart, context.contentEnd);
      const numbered = /\\caption(?!\*)\s*(?:\[[^\]]*\]\s*)?\{/.test(body);
      if (numbered) figureNumber += 1;
      for (const label of labelsWithin(source, context.openStart, context.closeEnd)) {
        register({
          ...label,
          type: "figure",
          number: numbered ? String(figureNumber) : "",
          sourceIndex: context.openStart,
          contextStart: context.openStart,
          contextEnd: context.closeEnd
        });
      }
    }

    const sectionCounters = [0, 0, 0, 0];
    const sections = [];
    const sectionPattern = /\\(section|subsection|subsubsection|paragraph)(\*)?\s*\{([^{}]*)\}/g;
    let sectionMatch;
    while ((sectionMatch = sectionPattern.exec(source))) {
      const level = ["section", "subsection", "subsubsection", "paragraph"]
        .indexOf(sectionMatch[1]);
      let number = "";
      if (!sectionMatch[2]) {
        sectionCounters[level] += 1;
        for (let index = level + 1; index < sectionCounters.length; index += 1) {
          sectionCounters[index] = 0;
        }
        number = sectionCounters.slice(0, level + 1).filter(Boolean).join(".");
      }
      sections.push({
        type: "section",
        level,
        title: sectionMatch[3].trim(),
        number,
        sourceIndex: sectionMatch.index,
        commandEnd: sectionPattern.lastIndex
      });
    }
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index];
      const end = sections[index + 1]?.sourceIndex ?? source.length;
      for (const label of labelsWithin(source, section.commandEnd, end)) {
        const alreadyStructural = targetList.some((target) => (
          label.index >= target.contextStart && label.index <= target.contextEnd
        ));
        if (!alreadyStructural) register({ ...section, ...label });
      }
    }

    const bibitemPattern = /\\bibitem(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;
    let bibitemMatch;
    while ((bibitemMatch = bibitemPattern.exec(source))) {
      register({
        label: bibitemMatch[1].trim(),
        type: "citation",
        sourceIndex: bibitemMatch.index,
        index: bibitemMatch.index
      });
    }

    const interactions = [];
    const interactionPattern = /\\(eqref|ref|pageref|cite|citep|citet|parencite|textcite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]+)\}/g;
    let interactionMatch;
    while ((interactionMatch = interactionPattern.exec(source))) {
      interactions.push({
        command: interactionMatch[1],
        labels: interactionMatch[2].split(",").map((label) => label.trim()).filter(Boolean),
        placeholder: `[${interactionMatch[2]}]`,
        sourceIndex: interactionMatch.index,
        sourceEnd: interactionPattern.lastIndex,
        type: /cite/i.test(interactionMatch[1]) ? "citation" : "reference"
      });
    }
    return { targets, targetList, sections, interactions };
  }

  function removeComments(value) {
    return String(value || "").split(/\r?\n/).map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") continue;
        let backslashes = 0;
        for (
          let previous = index - 1;
          previous >= 0 && line[previous] === "\\";
          previous -= 1
        ) {
          backslashes += 1;
        }
        if (backslashes % 2 === 0) return line.slice(0, index);
      }
      return line;
    }).join("\n");
  }

  function matchingBraceIndex(value, openIndex) {
    if (value[openIndex] !== "{") return -1;
    let depth = 1;
    for (let index = openIndex + 1; index < value.length; index += 1) {
      if (value[index] === "\\") {
        index += 1;
        continue;
      }
      if (value[index] === "{") depth += 1;
      else if (value[index] === "}") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }

  function encodeTextFormatting(value, preserveFormatting) {
    const source = String(value || "");
    let result = "";
    let index = 0;
    while (index < source.length) {
      if (source[index] !== "\\") {
        result += source[index];
        index += 1;
        continue;
      }
      const commandMatch = source.slice(index).match(
        /^\\(textbf|textit|emph|underline)\s*/
      );
      if (!commandMatch) {
        result += source[index];
        index += 1;
        continue;
      }
      const openIndex = index + commandMatch[0].length;
      if (source[openIndex] !== "{") {
        result += commandMatch[0];
        index = openIndex;
        continue;
      }
      const closeIndex = matchingBraceIndex(source, openIndex);
      if (closeIndex < 0) {
        result += commandMatch[0];
        index = openIndex;
        continue;
      }
      const command = commandMatch[1];
      const style = command === "textbf"
        ? "bold"
        : command === "underline"
          ? "underline"
          : "italic";
      const inner = encodeTextFormatting(
        source.slice(openIndex + 1, closeIndex),
        preserveFormatting
      );
      if (preserveFormatting) {
        const token = TEXT_FORMAT_TOKENS[style];
        result += token.open + inner + token.close;
      } else {
        result += inner;
      }
      index = closeIndex + 1;
    }
    return result;
  }

  function stripTextFormattingTokens(value) {
    return [...TEXT_FORMAT_OPEN.keys(), ...TEXT_FORMAT_CLOSE.keys()]
      .reduce((text, token) => text.replaceAll(token, ""), String(value || ""));
  }

  function renderListEnvironments(value) {
    return String(value || "").replace(
      /\\begin\s*\{(itemize|enumerate)\}([\s\S]*?)\\end\s*\{\1\}/g,
      (_match, environment, body) => {
        let itemNumber = 0;
        const renderedBody = String(body || "").replace(
          /\\item(?:\s*\[[^\]]*\])?\s*/g,
          () => environment === "enumerate"
            ? `\n${++itemNumber}. `
            : "\n• "
        );
        return `\n${renderedBody.trim()}\n`;
      }
    );
  }

  function plainLatex(value, metadata, preserveFormatting = false) {
    let text = renderListEnvironments(
      encodeTextFormatting(removeComments(value), preserveFormatting)
    )
      .replace(/\\maketitle\b/g, `\n\n${TITLE_TOKEN}\n\n`)
      .replace(/\\section\*?\s*\{([^{}]*)\}/g, "\n\n\uE110$1\n\n")
      .replace(/\\subsection\*?\s*\{([^{}]*)\}/g, "\n\n\uE111$1\n\n")
      .replace(/\\subsubsection\*?\s*\{([^{}]*)\}/g, "\n\n\uE112$1\n\n")
      .replace(/\\paragraph\*?\s*\{([^{}]*)\}/g, "\n\n\uE113$1\n\n")
      .replace(/\\caption\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/g, "\n\n\uE114$1\n\n")
      .replace(/\\(?:texttt|mbox)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\href\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$2 ($1)")
      .replace(/\\url\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\(?:cite|citep|citet|parencite|textcite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)\}/g, "[$1]")
      .replace(/\\(?:ref|eqref|pageref)\s*\{([^{}]*)\}/g, "[$1]")
      .replace(/\\label\s*\{[^{}]*\}/g, "")
      .replace(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]*)\}/g, "\n\n[Figure: $1]\n\n")
      .replace(/\\item\b/g, "\n• ")
      .replace(/\\begin\s*\{(?:itemize|enumerate|description|figure\*?|table\*?|center|flushleft|flushright)\}/g, "\n")
      .replace(/\\end\s*\{(?:itemize|enumerate|description|figure\*?|table\*?|center|flushleft|flushright)\}/g, "\n")
      .replace(/\\\\(?:\s*\[[^\]]*\])?/g, "\n")
      .replace(/\\(?:noindent|centering|raggedright|raggedleft)\b/g, "")
      .replace(/\\([%&#_$])/g, "$1")
      .replace(/~+/g, " ")
      .replace(/\\[A-Za-z@]+\*?(?:\s*\[[^\]]*\])?/g, "")
      .replace(/[{}]/g, "");
    if (!metadata.title && text.includes(TITLE_TOKEN)) {
      text = text.replaceAll(TITLE_TOKEN, "");
    }
    return text;
  }

  function appendTextWithCaret(parent, value) {
    const parts = String(value || "").split(TEXT_CARET);
    parts.forEach((part, index) => {
      if (part) parent.appendChild(document.createTextNode(part));
      if (index < parts.length - 1) {
        const caret = document.createElement("span");
        caret.className = "smarttex-document-text-caret";
        caret.setAttribute("aria-label", "Editor cursor");
        parent.appendChild(caret);
      }
    });
  }

  function appendFormattedTextWithCaret(parent, value) {
    const source = String(value || "");
    const stack = [{ element: parent, style: null }];
    let buffer = "";
    const flush = () => {
      if (!buffer) return;
      appendTextWithCaret(stack.at(-1).element, buffer);
      buffer = "";
    };
    for (const character of source) {
      const opening = TEXT_FORMAT_OPEN.get(character);
      if (opening) {
        flush();
        const span = document.createElement("span");
        span.className = opening.className;
        stack.at(-1).element.appendChild(span);
        stack.push({ element: span, style: opening.style });
        continue;
      }
      const closing = TEXT_FORMAT_CLOSE.get(character);
      if (closing) {
        flush();
        const matchingIndex = stack.findLastIndex(
          (entry) => entry.style === closing.style
        );
        if (matchingIndex > 0) stack.splice(matchingIndex);
        continue;
      }
      buffer += character;
    }
    flush();
  }

  function sourceRange(element) {
    const start = Number(element?.dataset?.smarttexSourceStart);
    const end = Number(element?.dataset?.smarttexSourceEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  }

  function setSourceRange(element, startValue, endValue) {
    if (!element?.dataset) return;
    const start = Math.max(0, Number(startValue) || 0);
    const end = Math.max(start, Number(endValue) || start);
    const previous = sourceRange(element);
    element.dataset.smarttexSourceStart = String(
      previous ? Math.min(previous.start, start) : start
    );
    element.dataset.smarttexSourceEnd = String(
      previous ? Math.max(previous.end, end) : end
    );
  }

  function appendTitleBlock(parent, metadata) {
    const title = document.createElement("header");
    title.className = "smarttex-document-title";
    if (metadata.title) {
      const heading = document.createElement("h1");
      appendTextWithCaret(heading, metadata.title);
      title.appendChild(heading);
    }
    if (metadata.author) {
      const author = document.createElement("p");
      appendTextWithCaret(author, metadata.author.replace(/\\and\b/g, " · "));
      title.appendChild(author);
    }
    if (metadata.date) {
      const date = document.createElement("small");
      appendTextWithCaret(date, metadata.date);
      title.appendChild(date);
    }
    parent.appendChild(title);
    return title;
  }

  function normalizedSeparatedText(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join(/^(?:•|\d+\.)\s/.test(String(value || "").trimStart()) ? "\n" : " ");
  }

  function appendSeparatedText(parent, value) {
    const normalized = normalizedSeparatedText(value);
    const visibleNormalized = stripTextFormattingTokens(normalized);
    if (!visibleNormalized) return;
    if (parent.childNodes.length) {
      const lastText = parent.lastChild?.textContent || "";
      if (
        lastText &&
        !/[\s([{/—-]$/.test(lastText) &&
        !/^[\s.,;:!?)}\]/—-]/.test(visibleNormalized)
      ) {
        parent.appendChild(document.createTextNode(" "));
      }
    }
    appendFormattedTextWithCaret(parent, normalized);
  }

  async function appendTextChunk(
    parent,
    source,
    absoluteStart,
    state,
    metadata,
    flow,
    checkpoint
  ) {
    if (!source) return true;
    let text = source;
    if (
      state.cursorIndex >= absoluteStart &&
      state.cursorIndex <= absoluteStart + source.length
    ) {
      const rawOffset = state.cursorIndex - absoluteStart;
      const placement = contextTools.resolveCaretPlacement(source, rawOffset);
      const offset = contextTools.commandAwareCaretOffset(
        source,
        rawOffset,
        placement.commandSide
      );
      text = source.slice(0, offset) + TEXT_CARET + source.slice(offset);
    }
    const plain = plainLatex(text, metadata, true);
    const parts = plain.split(/(\n{2,})/);
    const renderedParts = parts
      .filter((part) => !/^\n{2,}$/.test(part) && Boolean(part.trim()));
    const totalWeight = renderedParts.reduce(
      (total, part) => total + Math.max(1, part.trim().length),
      0
    );
    let consumedWeight = 0;
    let renderedPartIndex = 0;

    for (const part of parts) {
      if (/^\n{2,}$/.test(part)) {
        flow.paragraph = null;
        continue;
      }
      const paragraph = part.trim();
      if (!paragraph) continue;
      const partIndex = renderedPartIndex;
      renderedPartIndex += 1;
      const partWeight = Math.max(1, paragraph.length);
      const rangeStart = absoluteStart + Math.round(
        source.length * consumedWeight / Math.max(1, totalWeight)
      );
      consumedWeight += partWeight;
      const rangeEnd = absoluteStart + Math.round(
        source.length * consumedWeight / Math.max(1, totalWeight)
      );
      if (paragraph === TITLE_TOKEN) {
        flow.paragraph = null;
        setSourceRange(appendTitleBlock(parent, metadata), rangeStart, rangeEnd);
        continue;
      }
      const marker = paragraph[0];
      const content = ["\uE110", "\uE111", "\uE112", "\uE113", "\uE114"]
        .includes(marker)
        ? paragraph.slice(1).trim()
        : paragraph;
      let element;
      if (marker === "\uE110") element = document.createElement("h2");
      else if (marker === "\uE111") element = document.createElement("h3");
      else if (marker === "\uE112") element = document.createElement("h4");
      else if (marker === "\uE113") element = document.createElement("h5");
      else if (marker === "\uE114") {
        element = document.createElement("p");
        element.className = "smarttex-document-caption";
      } else {
        element = flow.paragraph;
        if (!element) {
          element = document.createElement("p");
          parent.appendChild(element);
          flow.paragraph = element;
        }
      }
      const previousLastChild = element.lastChild;
      appendSeparatedText(element, content);
      const firstAddedNode = previousLastChild
        ? previousLastChild.nextSibling
        : element.firstChild;
      const lastAddedNode = element.lastChild;
      if (firstAddedNode && lastAddedNode) {
        const startAnchor = document.createComment("smarttex-text-start");
        const endAnchor = document.createComment("smarttex-text-end");
        element.insertBefore(startAnchor, firstAddedNode);
        element.insertBefore(endAnchor, lastAddedNode.nextSibling);
        const segmentRange = document.createRange();
        segmentRange.setStartAfter(startAnchor);
        segmentRange.setEndBefore(endAnchor);
        flow.segments.push({
          element,
          startAnchor,
          endAnchor,
          chunkStart: absoluteStart,
          chunkEnd: absoluteStart + source.length,
          partIndex,
          leadingWhitespace: segmentRange.toString().match(/^\s*/)?.[0] || ""
        });
      }
      setSourceRange(element, rangeStart, rangeEnd);
      if (element !== flow.paragraph) {
        parent.appendChild(element);
        flow.paragraph = null;
      }
      if (!(await checkpoint())) return false;
    }
    return true;
  }

  function appendInlineEquationLeadingSpace(parent, sourceChunk) {
    const visibleSource = removeComments(String(sourceChunk || ""));
    if (!/[\s~]$/.test(visibleSource) || !parent?.childNodes?.length) return;
    const lastText = parent.lastChild?.textContent || "";
    if (!/\s$/.test(lastText)) {
      parent.appendChild(document.createTextNode(" "));
    }
  }

  function trustedKatexCommand(context) {
    return (
      context?.command === "\\htmlClass" &&
      (
        context?.class === "smarttex-rendered-caret" ||
        context?.class === "smarttex-source-selection"
      )
    );
  }

  function macrosFor(prepared) {
    return {
      ...prepared.macros,
      "\\label": { tokens: [], numArgs: 1 },
      "\\nonumber": "",
      "\\notag": "",
      "\\SmartTeXCaret": "\\htmlClass{smarttex-rendered-caret}{\\vphantom{|}}"
    };
  }

  function renderEquationBlock(parent, context, state) {
    const active = (
      state.cursorIndex >= context.openStart &&
      state.cursorIndex <= context.closeEnd
    );
    const renderContext = {
      ...context,
      cursorOffset: Math.max(
        0,
        Math.min(
          state.cursorIndex - context.contentStart,
          context.contentEnd - context.contentStart
        )
      )
    };
    const placement = active
      ? contextTools.resolveCaretPlacement(
        renderContext.source,
        renderContext.cursorOffset
      )
      : null;
    const numbering = contextTools.equationPreviewNumbering(
      state.value,
      renderContext
    );
    const selectionStart = Math.max(
      context.contentStart,
      Number(state.selectionFrom ?? state.cursorIndex) || 0
    );
    const selectionEnd = Math.min(
      context.contentEnd,
      Number(state.selectionTo ?? state.cursorIndex) || 0
    );
    const hasSelection = selectionEnd > selectionStart;
    const selectedContext = hasSelection
      ? {
          ...renderContext,
          source: (
            renderContext.source.slice(0, selectionStart - context.contentStart) +
            "\\htmlClass{smarttex-source-selection}{" +
            renderContext.source.slice(
              selectionStart - context.contentStart,
              selectionEnd - context.contentStart
            ) +
            "}" +
            renderContext.source.slice(selectionEnd - context.contentStart)
          )
        }
      : renderContext;
    const body = contextTools.previewBody(
      selectedContext,
      placement?.commandSide || null,
      numbering,
      active && !hasSelection
    );
    const prepared = contextTools.prepareDocumentCommands(
      state.value,
      context.openStart,
      body
    );
    const block = document.createElement(context.display ? "div" : "span");
    block.className = context.display
      ? "smarttex-document-equation"
      : "smarttex-document-inline-equation";
    setSourceRange(block, context.openStart, context.closeEnd);
    if (!context.display && parent?.matches?.("p")) {
      setSourceRange(parent, context.openStart, context.closeEnd);
    }
    block.classList.toggle("smarttex-document-active-source", active);
    try {
      katex.render(prepared.body, block, {
        displayMode: Boolean(context.display),
        throwOnError: true,
        strict: "ignore",
        trust: trustedKatexCommand,
        maxExpand: 1000,
        maxSize: 25,
        macros: macrosFor(prepared)
      });
    } catch (error) {
      if (hasSelection) {
        try {
          const fallbackBody = contextTools.previewBody(
            renderContext,
            placement?.commandSide || null,
            numbering,
            false
          );
          const fallback = contextTools.prepareDocumentCommands(
            state.value,
            context.openStart,
            fallbackBody
          );
          katex.render(fallback.body, block, {
            displayMode: Boolean(context.display),
            throwOnError: true,
            strict: "ignore",
            trust: trustedKatexCommand,
            maxExpand: 1000,
            maxSize: 25,
            macros: macrosFor(fallback)
          });
          parent.appendChild(block);
          return;
        } catch (_selectionError) {
          // Fall through to the normal source error display.
        }
      }
      block.classList.add("smarttex-document-render-error");
      const code = document.createElement("code");
      code.textContent = context.source.trim() || " ";
      code.title = String(error?.message || error);
      block.appendChild(code);
    }
    parent.appendChild(block);
  }

  function renderTableBlock(parent, context, state) {
    const active = (
      state.cursorIndex >= context.openStart &&
      state.cursorIndex <= context.closeEnd
    );
    const renderContext = {
      ...context,
      cursorOffset: Math.max(
        0,
        Math.min(
          state.cursorIndex - context.contentStart,
          context.contentEnd - context.contentStart
        )
      )
    };
    const placement = active
      ? contextTools.resolveCaretPlacement(
        renderContext.source,
        renderContext.cursorOffset
      )
      : null;
    const prepared = contextTools.prepareDocumentCommands(
      state.value,
      context.openStart,
      ""
    );
    const block = document.createElement("figure");
    block.className = "smarttex-document-table";
    setSourceRange(block, context.openStart, context.closeEnd);
    block.classList.toggle("smarttex-document-active-source", active);
    const number = contextTools.tablePreviewNumber(state.value, renderContext);
    if (number !== null) {
      const label = document.createElement("figcaption");
      label.textContent = `Table ${number}`;
      block.appendChild(label);
    }
    try {
      block.appendChild(tableRenderer.renderTable(renderContext, {
        commandSide: placement?.commandSide || null,
        contextTools,
        document,
        katex,
        macros: macrosFor(prepared),
        trust: trustedKatexCommand,
        includeCaret: active
      }));
    } catch (error) {
      block.classList.add("smarttex-document-render-error");
      const code = document.createElement("code");
      code.textContent = context.source.trim() || " ";
      code.title = String(error?.message || error);
      block.appendChild(code);
    }
    parent.appendChild(block);
  }

  function projectFigureUrl(pathValue) {
    const path = String(pathValue || "").replace(/\\/g, "/").replace(/^\.?\//, "");
    const baseName = path.split("/").pop();
    const items = [...document.querySelectorAll('.file-tree-list [role="treeitem"]')];
    const normalizedStem = (value) => String(value || "")
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/\.[a-z0-9]{1,8}$/i, "")
      .toLowerCase();
    const item = items.find((candidate) => {
      const candidatePath = String(
        candidate.getAttribute("data-path") ||
        candidate.getAttribute("data-file-path") ||
        candidate.getAttribute("aria-label") ||
        candidate.querySelector(".item-name-button span, .item-name span, .entity-name span")
          ?.textContent ||
        ""
      ).trim().replace(/\\/g, "/").replace(/^\/+/, "");
      return (
        candidatePath === path ||
        candidatePath.split("/").pop() === baseName ||
        normalizedStem(candidatePath) === normalizedStem(path) ||
        normalizedStem(candidatePath.split("/").pop()) === normalizedStem(baseName)
      );
    });
    if (!item) return null;
    const resolvedPath = String(
      item.getAttribute("data-path") ||
      item.getAttribute("data-file-path") ||
      item.getAttribute("aria-label") ||
      item.querySelector(".item-name-button span, .item-name span, .entity-name span")
        ?.textContent ||
      path
    ).trim();
    const explicit = (
      item.getAttribute("data-download-url") ||
      item.getAttribute("data-url") ||
      item.querySelector("a[href]")?.href ||
      ""
    ).trim();
    if (explicit) {
      return {
        url: new URL(explicit, window.location.href).href,
        path: resolvedPath
      };
    }
    const fileId = (
      item.getAttribute("data-file-id") ||
      item.getAttribute("data-entity-id") ||
      item.getAttribute("data-id") ||
      item.dataset?.fileId ||
      item.dataset?.entityId ||
      ""
    ).trim();
    const projectId = window.location.pathname.match(/\/project\/([^/?#]+)/i)?.[1] || "";
    return fileId && projectId
      ? {
          url: `${window.location.origin}/project/${encodeURIComponent(projectId)}/file/${encodeURIComponent(fileId)}`,
          path: resolvedPath
        }
      : "";
  }

  async function replaceFigureMedia(placeholder, path, sourceUrl) {
    const renderer = globalThis.SmartTeXFigureRenderer;
    if (!renderer?.createMedia) throw new Error("The figure renderer is unavailable.");
    const media = await renderer.createMedia(path, sourceUrl, {
      imageClass: "smarttex-document-figure-image",
      pdfClass: "smarttex-document-figure-image smarttex-document-figure-pdf"
    });
    if (!placeholder.parentNode) return;
    media.loading = "lazy";
    placeholder.replaceWith(media);
  }

  function appendFigureImage(images, path) {
    const placeholder = figurePlaceholder(path);
    placeholder.classList.add("smarttex-document-figure-resolving");
    placeholder.textContent = `Locating ${path}…`;
    images.appendChild(placeholder);
    const resolved = projectFigureUrl(path);
    if (resolved?.url) {
      replaceFigureMedia(placeholder, resolved.path || path, resolved.url).catch(() => {
        if (!placeholder.parentNode) return;
        placeholder.classList.remove("smarttex-document-figure-resolving");
        placeholder.textContent = path;
        placeholder.title = "The figure could not be rendered.";
      });
      return;
    }
    bridgeRequest("resolveProjectFile", { path }, 5000).then((response) => {
      if (!placeholder.parentNode) return;
      const url = String(response?.file?.url || "");
      if (!url) {
        placeholder.classList.remove("smarttex-document-figure-resolving");
        placeholder.textContent = path;
        return;
      }
      return replaceFigureMedia(placeholder, response?.file?.path || path, url);
    }).catch(() => {
      if (!placeholder.parentNode) return;
      placeholder.classList.remove("smarttex-document-figure-resolving");
      placeholder.textContent = path;
      placeholder.title = "The figure file could not be resolved from the CollabTeX project.";
    });
  }

  function renderFigureBlock(parent, context, state, referenceModel) {
    const block = document.createElement("figure");
    block.className = "smarttex-document-figure";
    setSourceRange(block, context.openStart, context.closeEnd);
    const body = String(context.source || "");
    const paths = [...body.matchAll(
      /\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g
    )].map((match) => match[1].trim());
    const images = document.createElement("div");
    images.className = "smarttex-document-figure-images";
    for (const path of paths) {
      if (renderFigures) {
        appendFigureImage(images, path);
      } else {
        images.appendChild(figurePlaceholder(path));
      }
    }
    if (!paths.length) images.appendChild(figurePlaceholder("Figure"));
    block.appendChild(images);
    if (!renderFigures) enableFigureHoverPreview(
      images,
      context,
      state,
      referenceModel
    );
    const captionModel = contextTools.floatCaption(
      state.value,
      context,
      "figure"
    );
    const number = contextTools.figurePreviewNumber(state.value, context);
    if (captionModel?.text) {
      const prepared = contextTools.prepareDocumentCommands(
        state.value,
        context.openStart,
        captionModel.text
      );
      const caption = document.createElement("figcaption");
      caption.className = "smarttex-document-figure-caption";
      setSourceRange(caption, captionModel.start, captionModel.end);
      const label = document.createElement("strong");
      label.textContent = `Fig. ${number ?? "?"}:`;
      const renderedCaption = tableRenderer.renderInlineLatex(prepared.body, {
        contextTools,
        document,
        katex,
        macros: macrosFor(prepared),
        sourceOffset: captionModel.start,
        trust: trustedKatexCommand
      });
      renderedCaption.classList?.add("smarttex-document-caption-source");
      setSourceRange(renderedCaption, captionModel.start, captionModel.end);
      caption.append(
        label,
        " ",
        renderedCaption
      );
      if (
        state.cursorIndex >= captionModel.start &&
        state.cursorIndex <= captionModel.end
      ) {
        insertMappedInlineCaret(
          renderedCaption,
          state.cursorIndex,
          state.value
        );
      }
      block.appendChild(caption);
    }
    const target = referenceModel?.targetList.find((candidate) => (
      candidate.type === "figure" &&
      candidate.index >= context.openStart &&
      candidate.index <= context.closeEnd
    ));
    const referenceNumber = target?.number || number;
    if (referenceNumber !== null && referenceNumber !== undefined) {
      block.dataset.referenceNumber = String(referenceNumber);
    }
    parent.appendChild(block);
  }

  function figureHoverPreviewBlock(context, state, referenceModel) {
    const figure = document.createElement("figure");
    figure.className =
      "smarttex-document-figure smarttex-reference-popup-target " +
      "smarttex-document-figure-hover-popup";
    const body = String(context.source || "");
    const paths = [...body.matchAll(
      /\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g
    )].map((match) => match[1].trim());
    const images = document.createElement("div");
    images.className = "smarttex-document-figure-images";
    for (const path of paths) appendFigureImage(images, path);
    if (!paths.length) images.appendChild(figurePlaceholder("Figure"));
    figure.appendChild(images);

    const captionModel = contextTools.floatCaption(
      state.value,
      context,
      "figure"
    );
    const number = contextTools.figurePreviewNumber(state.value, context);
    if (captionModel?.text) {
      const prepared = contextTools.prepareDocumentCommands(
        state.value,
        context.openStart,
        captionModel.text
      );
      const caption = document.createElement("figcaption");
      caption.className = "smarttex-document-figure-caption";
      const label = document.createElement("strong");
      label.textContent = `Fig. ${number ?? "?"}:`;
      const renderedCaption = tableRenderer.renderInlineLatex(prepared.body, {
        contextTools,
        document,
        katex,
        macros: macrosFor(prepared),
        trust: trustedKatexCommand,
        renderReference: (reference) => createPopupCaptionReferenceLink(
          reference,
          referenceModel,
          captionModel.start
        )
      });
      caption.append(label, " ", renderedCaption);
      figure.appendChild(caption);
    }
    return figure;
  }

  function positionReferencePopup(anchor, popup) {
    if (!anchor?.isConnected || !popup || popup.hidden) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 10;
    const left = Math.max(
      margin,
      Math.min(anchorRect.left, window.innerWidth - popupRect.width - margin)
    );
    const below = anchorRect.bottom + 8;
    const top = below + popupRect.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, anchorRect.top - popupRect.height - 8);
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function showFigureHoverPopup(anchor, context, state, referenceModel) {
    if (renderFigures || !figureHoverPreviewsEnabled) return;
    window.clearTimeout(referencePopupTimer);
    referencePopupGeneration += 1;
    const popup = ensureReferencePopup();
    hideNestedReferencePopup();
    popup.replaceChildren(figureHoverPreviewBlock(context, state, referenceModel));
    popup.hidden = false;
    positionReferencePopup(anchor, popup);
  }

  function enableFigureHoverPreview(anchor, context, state, referenceModel) {
    if (renderFigures || !figureHoverPreviewsEnabled || !anchor) return;
    anchor.classList.add("smarttex-document-figure-hover-anchor");
    anchor.tabIndex = 0;
    anchor.title = "Hover to preview this figure";
    const show = (event) => {
      const spinnerGeneration = showPopupLoadingSpinner(event, anchor);
      window.requestAnimationFrame(() => {
        try {
          showFigureHoverPopup(
            anchor,
            context,
            currentState?.value === state.value ? currentState : state,
            referenceModel
          );
        } finally {
          hidePopupLoadingSpinner(spinnerGeneration);
        }
      });
    };
    anchor.addEventListener("pointerenter", show);
    anchor.addEventListener("focus", show);
    anchor.addEventListener("pointerleave", scheduleHideReferencePopup);
    anchor.addEventListener("blur", scheduleHideReferencePopup);
  }

  function figurePlaceholder(labelValue) {
    const placeholder = document.createElement("div");
    placeholder.className = "smarttex-document-figure-placeholder";
    placeholder.textContent = String(labelValue || "Figure");
    placeholder.title = "The image file is not currently available in the file tree.";
    return placeholder;
  }

  function workCheckpoint(generation) {
    let sliceStarted = performance.now();
    return async (force = false) => {
      if (generation !== renderGeneration || !liveEnabled) return false;
      if (!force && performance.now() - sliceStarted < WORK_SLICE_MS) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (generation !== renderGeneration || !liveEnabled) return false;
      sliceStarted = performance.now();
      return true;
    };
  }

  function mapCursorToRenderedSource(sourceValue, cursorValue) {
    const source = String(sourceValue || "");
    const rendered = lastRenderedSource;
    const cursor = Math.max(0, Math.min(Number(cursorValue) || 0, source.length));
    if (!rendered || source === rendered) {
      return Math.max(0, Math.min(cursor, rendered.length));
    }

    const commonLimit = Math.min(source.length, rendered.length);
    let prefix = 0;
    while (prefix < commonLimit && source[prefix] === rendered[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < commonLimit - prefix &&
      source[source.length - 1 - suffix] === rendered[rendered.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    if (cursor <= prefix) return cursor;
    const currentChangedEnd = source.length - suffix;
    if (cursor >= currentChangedEnd) {
      return Math.max(
        0,
        Math.min(rendered.length, cursor - (source.length - rendered.length))
      );
    }
    return prefix;
  }

  function mapRenderedIndexToCurrentSource(sourceValue, renderedIndexValue, bias) {
    const source = String(sourceValue || "");
    const rendered = lastRenderedSource;
    const renderedIndex = Math.max(
      0,
      Math.min(Number(renderedIndexValue) || 0, rendered.length)
    );
    if (!rendered || source === rendered) {
      return Math.max(0, Math.min(renderedIndex, source.length));
    }
    const commonLimit = Math.min(source.length, rendered.length);
    let prefix = 0;
    while (prefix < commonLimit && source[prefix] === rendered[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < commonLimit - prefix &&
      source[source.length - 1 - suffix] === rendered[rendered.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    if (renderedIndex <= prefix) return renderedIndex;
    const renderedChangedEnd = rendered.length - suffix;
    if (renderedIndex >= renderedChangedEnd) {
      return Math.max(
        0,
        Math.min(source.length, renderedIndex + (source.length - rendered.length))
      );
    }
    return bias === "end" ? source.length - suffix : prefix;
  }

  function renderedPartLocation(source, offsetValue, metadata) {
    const offset = Math.max(0, Math.min(Number(offsetValue) || 0, source.length));
    const marked = source.slice(0, offset) + TEXT_CARET + source.slice(offset);
    const parts = plainLatex(marked, metadata).split(/(\n{2,})/);
    let partIndex = 0;
    for (const part of parts) {
      if (/^\n{2,}$/.test(part) || !part.trim()) continue;
      const paragraph = part.trim();
      const marker = paragraph[0];
      const content = ["\uE110", "\uE111", "\uE112", "\uE113", "\uE114"]
        .includes(marker)
        ? paragraph.slice(1).trim()
        : paragraph;
      const normalized = normalizedSeparatedText(content);
      const caretOffset = normalized.indexOf(TEXT_CARET);
      if (caretOffset >= 0) return { partIndex, caretOffset, found: true };
      partIndex += 1;
    }
    return { partIndex, caretOffset: 0, found: false };
  }

  function renderedPartTexts(source, metadata) {
    return plainLatex(source, metadata)
      .split(/(\n{2,})/)
      .filter((part) => !/^\n{2,}$/.test(part) && Boolean(part.trim()))
      .map((part) => {
        const paragraph = part.trim();
        const marker = paragraph[0];
        const content = ["\uE110", "\uE111", "\uE112", "\uE113", "\uE114"]
          .includes(marker)
          ? paragraph.slice(1).trim()
          : paragraph;
        return normalizedSeparatedText(content);
      });
  }

  function validatedRenderedPartLocation(
    source,
    offsetValue,
    metadata,
    baselineParts
  ) {
    const offset = Math.max(0, Math.min(Number(offsetValue) || 0, source.length));
    const marked = source.slice(0, offset) + TEXT_CARET + source.slice(offset);
    const markedParts = renderedPartTexts(marked, metadata);
    const partIndex = markedParts.findIndex((part) => part.includes(TEXT_CARET));
    if (
      partIndex < 0 ||
      markedParts.length !== baselineParts.length ||
      markedParts[partIndex].replaceAll(TEXT_CARET, "") !== baselineParts[partIndex]
    ) {
      return null;
    }
    return {
      partIndex,
      caretOffset: markedParts[partIndex].indexOf(TEXT_CARET),
      found: true,
      sourceOffset: offset
    };
  }

  function sourceIndexForTextSegment(segment, visibleOffset) {
    const source = lastRenderedSource.slice(segment.chunkStart, segment.chunkEnd);
    const metadata = documentMetadata(
      lastRenderedSource.slice(0, documentBounds(lastRenderedSource).start)
    );
    const baselineParts = renderedPartTexts(source, metadata);
    const targetOffset = Math.max(
      0,
      Number(visibleOffset) - segment.leadingWhitespace.length
    );
    let low = 0;
    let high = source.length;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestLocation = null;

    const locationOrder = (location) => {
      if (!location) return Number.POSITIVE_INFINITY;
      const partDifference = location.partIndex - segment.partIndex;
      if (partDifference !== 0) {
        return Math.sign(partDifference) * (
          1_000_000 + Math.abs(partDifference) * 100_000 + location.caretOffset
        );
      }
      return location.caretOffset - targetOffset;
    };

    const locationDistance = (location) => {
      if (!location) return Number.POSITIVE_INFINITY;
      const partDifference = Math.abs(location.partIndex - segment.partIndex);
      return (
        partDifference * 1_000_000 +
        Math.abs(location.caretOffset - targetOffset)
      );
    };

    const validatedLocation = (offset) => validatedRenderedPartLocation(
      source,
      offset,
      metadata,
      baselineParts
    );

    const segmentRange = document.createRange();
    segmentRange.setStartAfter(segment.startAnchor);
    segmentRange.setEndBefore(segment.endAnchor);
    const visibleText = segmentRange.toString().slice(
      segment.leadingWhitespace.length
    );
    const escapedLiteralPattern = (value) => String(value || "")
      .split(/(\s+)/)
      .filter(Boolean)
      .map((part) => (
        /^\s+$/.test(part)
          ? "[\\s~]+"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ))
      .join("");
    for (const radius of [40, 28, 18, 10]) {
      const start = Math.max(0, targetOffset - radius);
      const end = Math.min(visibleText.length, targetOffset + radius);
      const leftText = visibleText.slice(start, targetOffset);
      const rightText = visibleText.slice(targetOffset, end);
      if ((leftText + rightText).replace(/\s/g, "").length < 8) continue;
      let pattern;
      try {
        pattern = new RegExp(
          `(${escapedLiteralPattern(leftText)})(${escapedLiteralPattern(rightText)})`,
          "g"
        );
      } catch (_error) {
        continue;
      }
      const exactCandidates = [];
      let match;
      while ((match = pattern.exec(source))) {
        const candidate = match.index + match[1].length;
        const location = validatedLocation(candidate);
        if (
          location?.partIndex === segment.partIndex &&
          location.caretOffset === targetOffset
        ) {
          exactCandidates.push(candidate);
        }
        if (!match[0]) pattern.lastIndex += 1;
      }
      if (exactCandidates.length) {
        return segment.chunkStart + Math.max(...exactCandidates);
      }
    }

    const nearestValidatedLocation = (middle, minimum, maximum) => {
      const direct = validatedLocation(middle);
      if (direct) return direct;
      const maximumDistance = Math.max(middle - minimum, maximum - middle);
      for (let distance = 1; distance <= maximumDistance; distance *= 2) {
        const candidates = [];
        if (middle - distance >= minimum) {
          const left = validatedLocation(middle - distance);
          if (left) candidates.push(left);
        }
        if (middle + distance <= maximum) {
          const right = validatedLocation(middle + distance);
          if (right) candidates.push(right);
        }
        if (candidates.length) {
          return candidates.sort((left, right) => (
            locationDistance(left) - locationDistance(right) ||
            right.sourceOffset - left.sourceOffset
          ))[0];
        }
      }
      const boundaryCandidates = [minimum, maximum]
        .map(validatedLocation)
        .filter(Boolean);
      if (boundaryCandidates.length) {
        return boundaryCandidates.sort((left, right) => (
          locationDistance(left) - locationDistance(right) ||
          right.sourceOffset - left.sourceOffset
        ))[0];
      }
      return null;
    };

    for (let attempt = 0; attempt < 24 && low <= high; attempt += 1) {
      const middle = Math.floor((low + high) / 2);
      const location = nearestValidatedLocation(middle, low, high);
      if (!location) break;
      const distance = locationDistance(location);
      if (
        distance < bestDistance ||
        (distance === bestDistance && location.sourceOffset > best)
      ) {
        best = location.sourceOffset;
        bestDistance = distance;
        bestLocation = location;
      }
      const order = locationOrder(location);
      if (order < 0) {
        low = location.sourceOffset + 1;
      } else if (order > 0) {
        high = location.sourceOffset - 1;
      } else {
        best = location.sourceOffset;
        bestLocation = location;
        break;
      }
    }

    const refinementRadius = Math.min(
      source.length,
      Math.min(768, Math.max(256, Math.ceil(source.length / 64)))
    );
    const refinementStart = Math.max(
      0,
      Math.min(best, low, high) - refinementRadius
    );
    const refinementEnd = Math.min(
      source.length,
      Math.max(best, low, high) + refinementRadius
    );
    for (let offset = refinementStart; offset <= refinementEnd; offset += 1) {
      const location = validatedLocation(offset);
      if (!location) continue;
      const distance = locationDistance(location);
      if (
        distance < bestDistance ||
        (distance === bestDistance && offset > best)
      ) {
        best = offset;
        bestDistance = distance;
        bestLocation = location;
      }
    }

    if (!bestLocation) {
      const fallback = renderedPartLocation(source, best, metadata);
      if (!fallback.found) return segment.chunkStart + best;
    }
    return segment.chunkStart + best;
  }

  function pointFromViewport(clientX, clientY) {
    const position = document.caretPositionFromPoint?.(clientX, clientY);
    if (position) return {
      node: position.offsetNode,
      offset: position.offset
    };
    const range = document.caretRangeFromPoint?.(clientX, clientY);
    return range ? {
      node: range.startContainer,
      offset: range.startOffset
    } : null;
  }

  function mappedInlineSourceIndex(point, clientX, clientY) {
    if (!point?.node) return null;
    if (
      point.node.nodeType === Node.TEXT_NODE &&
      Array.isArray(point.node.smarttexSourceBoundaries)
    ) {
      const boundaries = point.node.smarttexSourceBoundaries;
      const offset = Math.max(
        0,
        Math.min(Number(point.offset) || 0, boundaries.length - 1)
      );
      const mapped = Number(boundaries[offset]);
      if (Number.isFinite(mapped)) return mapped;
    }

    let element = point.node.nodeType === Node.ELEMENT_NODE
      ? point.node
      : point.node.parentElement;
    const caption = element?.closest?.(".smarttex-document-caption-source");
    if (!caption) return null;
    while (element && caption.contains(element)) {
      const mappedRange = element.smarttexSourceRange;
      if (
        Number.isFinite(Number(mappedRange?.start)) &&
        Number.isFinite(Number(mappedRange?.end))
      ) {
        const start = Number(mappedRange.start);
        const end = Math.max(start, Number(mappedRange.end));
        const rect = element.getBoundingClientRect();
        const ratio = rect.width > 0
          ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
          : 0;
        return Math.round(start + (end - start) * ratio);
      }
      if (element === caption) break;
      element = element.parentElement;
    }
    return null;
  }

  function renderedIndexForDomPoint(page, point, clientX, clientY) {
    if (!point?.node) return null;
    const inlineMappedIndex = mappedInlineSourceIndex(
      point,
      clientX,
      clientY
    );
    if (inlineMappedIndex !== null) return inlineMappedIndex;
    const segments = page.smarttexTextSegments || [];
    for (const segment of segments) {
      if (!segment.startAnchor?.isConnected || !segment.endAnchor?.isConnected) continue;
      const range = document.createRange();
      range.setStartAfter(segment.startAnchor);
      range.setEndBefore(segment.endAnchor);
      let inside = false;
      try {
        inside = range.comparePoint(point.node, point.offset) === 0;
      } catch (_error) {
        inside = false;
      }
      if (!inside) continue;
      const prefix = document.createRange();
      prefix.setStartAfter(segment.startAnchor);
      prefix.setEnd(point.node, point.offset);
      return sourceIndexForTextSegment(segment, prefix.toString().length);
    }

    const element = (
      point.node.nodeType === Node.ELEMENT_NODE
        ? point.node
        : point.node.parentElement
    )?.closest?.("[data-smarttex-source-start][data-smarttex-source-end]");
    const range = sourceRange(element);
    if (!element || !range) return null;
    const rect = element.getBoundingClientRect();
    if (
      element.matches(".smarttex-document-caption-source") &&
      !point.node.parentElement?.closest?.(".katex")
    ) {
      try {
        const contents = document.createRange();
        contents.selectNodeContents(element);
        const prefix = document.createRange();
        prefix.setStart(contents.startContainer, contents.startOffset);
        prefix.setEnd(point.node, point.offset);
        const visibleLength = contents.toString().length;
        if (visibleLength > 0) {
          const visibleOffset = Math.max(
            0,
            Math.min(visibleLength, prefix.toString().length)
          );
          return Math.round(
            range.start +
            (range.end - range.start) * visibleOffset / visibleLength
          );
        }
      } catch (_error) {
        // Fall back to geometric placement for unusual rendered caption nodes.
      }
    }
    const horizontal = rect.width > 0
      ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      : 0;
    const vertical = rect.height > 0
      ? Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      : 0;
    const ratio = rect.height > (Number(currentState?.screen?.lineHeight) || 18) * 2
      ? (horizontal + vertical) / 2
      : horizontal;
    return Math.round(range.start + (range.end - range.start) * ratio);
  }

  function domPointWithinSegment(segment, visibleOffsetValue) {
    if (!segment?.startAnchor?.isConnected || !segment?.endAnchor?.isConnected) {
      return null;
    }
    const segmentRange = document.createRange();
    segmentRange.setStartAfter(segment.startAnchor);
    segmentRange.setEndBefore(segment.endAnchor);
    const walker = document.createTreeWalker(segment.element, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, Number(visibleOffsetValue) || 0);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      let inside = false;
      try {
        inside = (
          segmentRange.comparePoint(node, 0) === 0 ||
          segmentRange.comparePoint(node, node.data.length) === 0
        );
      } catch (_error) {
        inside = false;
      }
      if (!inside) continue;
      if (remaining > node.data.length) {
        remaining -= node.data.length;
        continue;
      }
      return {
        node,
        offset: Math.max(0, Math.min(remaining, node.data.length))
      };
    }
    return {
      node: segment.endAnchor.parentNode,
      offset: [...segment.endAnchor.parentNode.childNodes].indexOf(segment.endAnchor)
    };
  }

  function domPointWithinElement(element, visibleOffsetValue) {
    if (!element?.isConnected) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, Number(visibleOffsetValue) || 0);
    let lastNode = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      lastNode = node;
      if (remaining > node.data.length) {
        remaining -= node.data.length;
        continue;
      }
      return {
        node,
        offset: Math.max(0, Math.min(remaining, node.data.length))
      };
    }
    return lastNode ? { node: lastNode, offset: lastNode.data.length } : null;
  }

  function metadataDomPoint(page, index) {
    const mappings = [
      { command: "title", selector: ".smarttex-document-title h1" },
      { command: "author", selector: ".smarttex-document-title p" },
      { command: "date", selector: ".smarttex-document-title small" }
    ];
    for (const mapping of mappings) {
      const pattern = new RegExp(`\\\\${mapping.command}\\s*\\{([^{}]*)\\}`, "i");
      const match = pattern.exec(lastRenderedSource);
      if (!match) continue;
      const valueOffset = match[0].indexOf(match[1]);
      const start = match.index + valueOffset;
      const end = start + match[1].length;
      if (index < start || index > end) continue;
      return domPointWithinElement(
        page.querySelector(mapping.selector),
        index - start
      );
    }
    return null;
  }

  function domPointForRenderedIndex(page, indexValue) {
    const index = Math.max(
      0,
      Math.min(Number(indexValue) || 0, lastRenderedSource.length)
    );
    const metadata = documentMetadata(
      lastRenderedSource.slice(0, documentBounds(lastRenderedSource).start)
    );
    const segments = page.smarttexTextSegments || [];
    const chunks = [...new Map(
      segments.map((segment) => [
        `${segment.chunkStart}:${segment.chunkEnd}`,
        { start: segment.chunkStart, end: segment.chunkEnd }
      ])
    ).values()].filter((chunk) => index >= chunk.start && index <= chunk.end);
    for (const chunk of chunks) {
      const location = renderedPartLocation(
        lastRenderedSource.slice(chunk.start, chunk.end),
        index - chunk.start,
        metadata
      );
      const segment = segments.find((candidate) => (
        candidate.chunkStart === chunk.start &&
        candidate.chunkEnd === chunk.end &&
        candidate.partIndex === location.partIndex
      ));
      if (!segment) continue;
      return domPointWithinSegment(
        segment,
        segment.leadingWhitespace.length + location.caretOffset
      );
    }
    return metadataDomPoint(page, index);
  }

  function clearPreviewSourceHighlight() {
    globalThis.CSS?.highlights?.delete?.(PREVIEW_SELECTION_HIGHLIGHT);
  }

  function refreshPreviewSourceHighlight(state) {
    clearPreviewSourceHighlight();
    if (!preview || preview.hidden || !state || !lastRenderedSource) return;
    const selectionFrom = Number(state.selectionFrom ?? state.cursorIndex) || 0;
    const selectionTo = Number(state.selectionTo ?? state.cursorIndex) || 0;
    if (selectionFrom === selectionTo) return;
    const page = preview.querySelector(".smarttex-document-page");
    if (!page || !globalThis.Highlight || !globalThis.CSS?.highlights) return;
    const startIndex = mapCursorToRenderedSource(state.value, selectionFrom);
    const endIndex = mapCursorToRenderedSource(state.value, selectionTo);
    const start = domPointForRenderedIndex(page, Math.min(startIndex, endIndex));
    const end = domPointForRenderedIndex(page, Math.max(startIndex, endIndex));
    if (!start?.node || !end?.node) return;
    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      if (!range.collapsed) {
        CSS.highlights.set(PREVIEW_SELECTION_HIGHLIGHT, new Highlight(range));
      }
    } catch (_error) {
      // Selections that cross a replaced KaTeX block are rendered by KaTeX itself.
    }
  }

  function domPointCoordinates(point) {
    if (!point?.node) return { x: 0, y: 0 };
    try {
      const range = document.createRange();
      range.setStart(point.node, point.offset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    } catch (_error) {
      return { x: 0, y: 0 };
    }
  }

  function syncPreviewSelectionToEditor() {
    if (applyingPreviewSelection || !preview || preview.hidden || !currentState) return;
    const selection = document.getSelection();
    const page = preview.querySelector(".smarttex-document-page");
    if (
      !selection ||
      selection.isCollapsed ||
      !page ||
      !page.contains(selection.anchorNode) ||
      !page.contains(selection.focusNode)
    ) {
      return;
    }
    const anchorPoint = {
      node: selection.anchorNode,
      offset: selection.anchorOffset
    };
    const focusPoint = {
      node: selection.focusNode,
      offset: selection.focusOffset
    };
    const anchorCoordinates = domPointCoordinates(anchorPoint);
    const focusCoordinates = domPointCoordinates(focusPoint);
    const renderedAnchor = renderedIndexForDomPoint(
      page,
      anchorPoint,
      anchorCoordinates.x,
      anchorCoordinates.y
    );
    const renderedHead = renderedIndexForDomPoint(
      page,
      focusPoint,
      focusCoordinates.x,
      focusCoordinates.y
    );
    if (renderedAnchor === null || renderedHead === null) return;
    const anchor = mapRenderedIndexToCurrentSource(
      currentState.value,
      renderedAnchor,
      "start"
    );
    const head = mapRenderedIndexToCurrentSource(
      currentState.value,
      renderedHead,
      "end"
    );
    if (anchor === head) return;
    currentState = {
      ...currentState,
      cursorIndex: head,
      selectionFrom: Math.min(anchor, head),
      selectionTo: Math.max(anchor, head),
      selectionAnchor: anchor,
      selectionHead: head,
      focused: false
    };
    bridgeRequest("setSelection", { anchor, head, focus: false }).catch((error) => {
      console.warn("SmartTeX could not synchronize the preview selection:", error);
    });
  }

  function moveEditorToCurrentIndex(indexValue, focusEditor = false) {
    if (!currentState) return;
    const index = Math.max(
      0,
      Math.min(Number(indexValue) || 0, String(currentState.value || "").length)
    );
    currentState = {
      ...currentState,
      cursorIndex: index,
      selectionFrom: index,
      selectionTo: index,
      selectionAnchor: index,
      selectionHead: index,
      focused: Boolean(focusEditor)
    };
    scheduleFastCursorUpdate(currentState);
    bridgeRequest("setCursor", { index, focus: focusEditor }).catch((error) => {
      console.warn("SmartTeX could not move the editor cursor:", error);
    });
  }

  function moveEditorSelectionToIndex(indexValue, focusEditor = false) {
    if (!currentState) return;
    const sourceLength = String(currentState.value || "").length;
    const head = Math.max(0, Math.min(Number(indexValue) || 0, sourceLength));
    const hasSelection = (
      Number(currentState.selectionFrom ?? currentState.cursorIndex) !==
      Number(currentState.selectionTo ?? currentState.cursorIndex)
    );
    const anchor = Math.max(
      0,
      Math.min(
        Number(
          hasSelection
            ? currentState.selectionAnchor ?? currentState.selectionFrom
            : currentState.cursorIndex
        ) || 0,
        sourceLength
      )
    );
    currentState = {
      ...currentState,
      cursorIndex: head,
      selectionFrom: Math.min(anchor, head),
      selectionTo: Math.max(anchor, head),
      selectionAnchor: anchor,
      selectionHead: head,
      focused: Boolean(focusEditor)
    };
    scheduleFastCursorUpdate(currentState);
    bridgeRequest("setSelection", { anchor, head, focus: focusEditor }).catch((error) => {
      console.warn("SmartTeX could not extend the editor selection:", error);
    });
  }

  function moveEditorFromPreview(
    renderedIndexValue,
    extendSelection = false,
    focusEditor = false
  ) {
    if (!currentState || renderedIndexValue === null) return;
    const index = mapRenderedIndexToCurrentSource(
      currentState.value,
      renderedIndexValue,
      "start"
    );
    if (extendSelection) moveEditorSelectionToIndex(index, focusEditor);
    else moveEditorToCurrentIndex(index, focusEditor);
  }

  function latexCommandEnd(source, startValue) {
    const start = Math.max(0, Number(startValue) || 0);
    if (source[start] !== "\\") return start;
    if (/[A-Za-z@]/.test(source[start + 1] || "")) {
      let end = start + 2;
      while (/[A-Za-z@]/.test(source[end] || "")) end += 1;
      return end;
    }
    return Math.min(source.length, start + 2);
  }

  function latexVisualCommandRanges(sourceValue) {
    const source = String(sourceValue || "");
    const ranges = [];
    const delimiterModifier = /^(?:left|right|middle|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr)$/;
    for (let start = 0; start < source.length; start += 1) {
      if (source[start] !== "\\") continue;
      let end = latexCommandEnd(source, start);
      const command = source.slice(start + 1, end);
      if (delimiterModifier.test(command)) {
        while (/\s/.test(source[end] || "")) end += 1;
        end = source[end] === "\\"
          ? latexCommandEnd(source, end)
          : Math.min(source.length, end + 1);
      } else {
        let groupStart = end;
        while (/\s/.test(source[groupStart] || "")) groupStart += 1;
        if (source[groupStart] === "{" || source[groupStart] === "[") {
          end = groupStart + 1;
        }
      }
      ranges.push({ start, end });
      start = Math.max(start, end - 1);
    }
    return ranges;
  }

  function movePreviewCursorHorizontally(
    direction,
    extendSelection = false,
    focusEditor = false
  ) {
    if (!currentState) return;
    previewNavigationPreferredX = null;
    const source = String(currentState.value || "");
    const cursor = Math.max(0, Math.min(currentState.cursorIndex, source.length));
    const ranges = latexVisualCommandRanges(source);
    const commandRange = direction < 0
      ? ranges.filter((range) => range.start < cursor && cursor <= range.end).at(-1)
      : ranges.find((range) => range.start <= cursor && cursor < range.end);
    if (commandRange) {
      const index = direction < 0 ? commandRange.start : commandRange.end;
      if (extendSelection) moveEditorSelectionToIndex(index, focusEditor);
      else moveEditorToCurrentIndex(index, focusEditor);
      return;
    }
    if (direction < 0 && cursor > 0) {
      const previousUnit = source.charCodeAt(cursor - 1);
      const previousWidth = (
        previousUnit >= 0xDC00 &&
        previousUnit <= 0xDFFF &&
        cursor > 1 &&
        source.charCodeAt(cursor - 2) >= 0xD800 &&
        source.charCodeAt(cursor - 2) <= 0xDBFF
      ) ? 2 : 1;
      const index = cursor - previousWidth;
      if (extendSelection) moveEditorSelectionToIndex(index, focusEditor);
      else moveEditorToCurrentIndex(index, focusEditor);
      return;
    }
    if (direction > 0 && cursor < source.length) {
      const codePoint = source.codePointAt(cursor);
      const index = cursor + (codePoint > 0xFFFF ? 2 : 1);
      if (extendSelection) moveEditorSelectionToIndex(index, focusEditor);
      else moveEditorToCurrentIndex(index, focusEditor);
      return;
    }
    if (focusEditor) {
      bridgeRequest("focus").catch(() => {});
    }
  }

  function balancedGroupAt(source, openingValue) {
    const opening = Math.max(0, Number(openingValue) || 0);
    const openingCharacter = source[opening];
    const closingCharacter = openingCharacter === "{" ? "}" : "]";
    if (openingCharacter !== "{" && openingCharacter !== "[") return null;
    let depth = 0;
    for (let index = opening; index < source.length; index += 1) {
      if (source[index] === "\\") {
        index = Math.max(index, latexCommandEnd(source, index) - 1);
        continue;
      }
      if (source[index] === openingCharacter) depth += 1;
      if (source[index] !== closingCharacter) continue;
      depth -= 1;
      if (depth === 0) {
        return {
          open: opening,
          start: opening + 1,
          end: index,
          closeEnd: index + 1
        };
      }
    }
    return null;
  }

  function fractionVerticalTarget(sourceValue, cursorValue, direction) {
    const source = String(sourceValue || "");
    const cursor = Math.max(0, Math.min(Number(cursorValue) || 0, source.length));
    const equation = contextTools.findEquationContext(source, cursor);
    if (!equation) return null;
    const equationSource = source.slice(equation.contentStart, equation.contentEnd);
    const localCursor = cursor - equation.contentStart;
    const fractions = [];
    const pattern = /\\(?:dfrac|tfrac|frac|binom)\b/g;
    let match;
    while ((match = pattern.exec(equationSource))) {
      let position = match.index + match[0].length;
      while (/\s/.test(equationSource[position] || "")) position += 1;
      const numerator = balancedGroupAt(equationSource, position);
      if (!numerator) continue;
      position = numerator.closeEnd;
      while (/\s/.test(equationSource[position] || "")) position += 1;
      const denominator = balancedGroupAt(equationSource, position);
      if (!denominator) continue;
      fractions.push({
        numerator,
        denominator,
        span: denominator.closeEnd - match.index
      });
    }
    const candidates = fractions.filter(({ numerator, denominator }) => (
      (
        direction > 0 &&
        localCursor >= numerator.start &&
        localCursor <= numerator.end
      ) ||
      (
        direction < 0 &&
        localCursor >= denominator.start &&
        localCursor <= denominator.end
      )
    )).sort((left, right) => left.span - right.span);
    const fraction = candidates[0];
    if (!fraction) return null;
    const from = direction > 0 ? fraction.numerator : fraction.denominator;
    const to = direction > 0 ? fraction.denominator : fraction.numerator;
    const column = Math.max(0, localCursor - from.start);
    return equation.contentStart + to.start + Math.min(column, to.end - to.start);
  }

  function equationRowRanges(sourceValue) {
    const source = String(sourceValue || "");
    const rows = [];
    let start = 0;
    let braceDepth = 0;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "{" && source[index - 1] !== "\\") {
        braceDepth += 1;
        continue;
      }
      if (source[index] === "}" && source[index - 1] !== "\\") {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (
        braceDepth !== 0 ||
        source[index] !== "\\" ||
        source[index + 1] !== "\\"
      ) {
        continue;
      }
      rows.push({ start, end: index });
      index += 1;
      start = index + 1;
      while (/[ \t]/.test(source[start] || "")) start += 1;
      if (source[start] === "[") {
        const spacing = balancedGroupAt(source, start);
        if (spacing) start = spacing.closeEnd;
      }
    }
    rows.push({ start, end: source.length });
    return rows.map((row) => {
      let startIndex = row.start;
      let endIndex = row.end;
      while (/\s/.test(source[startIndex] || "")) startIndex += 1;
      while (endIndex > startIndex && /\s/.test(source[endIndex - 1] || "")) {
        endIndex -= 1;
      }
      return { start: startIndex, end: endIndex };
    });
  }

  function equationRowVerticalTarget(sourceValue, cursorValue, direction) {
    const source = String(sourceValue || "");
    const cursor = Math.max(0, Math.min(Number(cursorValue) || 0, source.length));
    const equation = contextTools.findEquationContext(source, cursor);
    if (!equation) return null;
    const equationSource = source.slice(equation.contentStart, equation.contentEnd);
    const localCursor = cursor - equation.contentStart;
    const rows = equationRowRanges(equationSource);
    if (rows.length < 2) return null;
    const rowIndex = rows.findIndex((row) => (
      localCursor >= row.start && localCursor <= row.end
    ));
    const targetIndex = rowIndex + direction;
    if (rowIndex < 0 || targetIndex < 0 || targetIndex >= rows.length) return null;
    const row = rows[rowIndex];
    const target = rows[targetIndex];
    const column = Math.max(0, localCursor - row.start);
    return equation.contentStart + target.start + Math.min(column, target.end - target.start);
  }

  function movePreviewCursorByVisualLine(
    direction,
    extendSelection = false,
    focusEditor = false
  ) {
    const source = String(currentState?.value || "");
    const structuredTarget = (
      fractionVerticalTarget(source, currentState?.cursorIndex, direction) ??
      equationRowVerticalTarget(source, currentState?.cursorIndex, direction)
    );
    if (structuredTarget !== null) {
      if (extendSelection) moveEditorSelectionToIndex(structuredTarget, focusEditor);
      else moveEditorToCurrentIndex(structuredTarget, focusEditor);
      return;
    }
    const caret = preview?.querySelector(
      ".smarttex-rendered-caret, .smarttex-table-rendered-caret, .smarttex-document-text-caret"
    );
    const page = preview?.querySelector(".smarttex-document-page");
    if (!caret || !page) {
      if (focusEditor) bridgeRequest("focus").catch(() => {});
      return;
    }
    if (caret.closest(".smarttex-document-equation, .smarttex-document-inline-equation")) {
      if (focusEditor) bridgeRequest("focus").catch(() => {});
      return;
    }
    const caretRect = caret.getBoundingClientRect();
    const lineHeight = Math.max(
      14,
      parseFloat(getComputedStyle(caret.closest("p, div, td, th") || caret).lineHeight) || 18
    );
    if (previewNavigationPreferredX === null) {
      previewNavigationPreferredX = caretRect.left + 2;
    }
    const x = Math.max(
      2,
      Math.min(window.innerWidth - 2, previewNavigationPreferredX)
    );
    for (let lines = 1; lines <= 5; lines += 1) {
      const y = caretRect.top + direction * lineHeight * lines + lineHeight / 2;
      const point = pointFromViewport(x, y);
      const index = renderedIndexForDomPoint(page, point, x, y);
      if (index !== null && index !== mapCursorToRenderedSource(
        currentState?.value,
        currentState?.cursorIndex
      )) {
        moveEditorFromPreview(index, extendSelection, focusEditor);
        return;
      }
    }
    if (focusEditor) bridgeRequest("focus").catch(() => {});
  }

  function sourcePageTarget(direction) {
    const source = String(currentState?.value || "");
    const cursor = Math.max(
      0,
      Math.min(Number(currentState?.cursorIndex) || 0, source.length)
    );
    const lineStarts = [0];
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "\n") lineStarts.push(index + 1);
    }
    const currentLine = Math.max(
      0,
      lineStarts.findLastIndex((startIndex) => startIndex <= cursor)
    );
    const column = cursor - lineStarts[currentLine];
    const visibleLines = Math.max(
      8,
      Math.floor((preview?.clientHeight || 480) / 20 * 0.82)
    );
    const targetLine = Math.max(
      0,
      Math.min(lineStarts.length - 1, currentLine + direction * visibleLines)
    );
    const lineEnd = targetLine + 1 < lineStarts.length
      ? Math.max(lineStarts[targetLine], lineStarts[targetLine + 1] - 1)
      : source.length;
    return Math.min(lineStarts[targetLine] + column, lineEnd);
  }

  function movePreviewCursorByPage(
    direction,
    extendSelection = false,
    focusEditor = false
  ) {
    const page = preview?.querySelector(".smarttex-document-page");
    const caret = preview?.querySelector(
      ".smarttex-rendered-caret, .smarttex-table-rendered-caret, .smarttex-document-text-caret"
    );
    if (!page || !caret) {
      const target = sourcePageTarget(direction);
      if (extendSelection) moveEditorSelectionToIndex(target, focusEditor);
      else moveEditorToCurrentIndex(target, focusEditor);
      return;
    }
    const previewRect = preview.getBoundingClientRect();
    const caretRect = caret.getBoundingClientRect();
    const distance = Math.max(80, preview.clientHeight * 0.82);
    preview.scrollTop += direction * distance;
    requestAnimationFrame(() => {
      const x = Math.max(
        previewRect.left + 18,
        Math.min(previewRect.right - 18, caretRect.left)
      );
      const y = direction > 0
        ? previewRect.bottom - 48
        : previewRect.top + 48;
      const point = pointFromViewport(x, y);
      const index = renderedIndexForDomPoint(page, point, x, y);
      if (index !== null) {
        moveEditorFromPreview(index, extendSelection, focusEditor);
      } else {
        const target = sourcePageTarget(direction);
        if (extendSelection) moveEditorSelectionToIndex(target, focusEditor);
        else moveEditorToCurrentIndex(target, focusEditor);
      }
    });
  }

  function bindPreviewInteractions(element) {
    let pan = null;
    element.addEventListener("focus", () => {
      element.classList.add("smarttex-document-focused");
    });
    element.addEventListener("blur", () => {
      element.classList.remove("smarttex-document-focused");
    });
    element.addEventListener("focusin", () => {
      element.classList.add("smarttex-document-focused");
    });
    element.addEventListener("focusout", (event) => {
      if (!element.contains(event.relatedTarget)) {
        element.classList.remove("smarttex-document-focused");
      }
    });
    element.addEventListener("pointerdown", (event) => {
      if (
        !(
          event.button === 1 ||
          (event.button === 0 && event.altKey)
        ) ||
        event.target.closest("button, a, input, label, .smarttex-document-reference-popup")
      ) {
        return;
      }
      pan = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        moved: false
      };
      element.setPointerCapture?.(event.pointerId);
    });
    element.addEventListener("pointermove", (event) => {
      if (!pan || pan.id !== event.pointerId) return;
      const deltaX = event.clientX - pan.x;
      const deltaY = event.clientY - pan.y;
      if (!pan.moved && Math.hypot(deltaX, deltaY) < 5) return;
      pan.moved = true;
      element.classList.add("smarttex-document-panning");
      element.scrollLeft = pan.scrollLeft - deltaX;
      element.scrollTop = pan.scrollTop - deltaY;
      event.preventDefault();
    });
    const endPan = (event) => {
      if (!pan || pan.id !== event.pointerId) return;
      suppressPreviewClick = pan.moved;
      if (suppressPreviewClick) {
        window.setTimeout(() => {
          suppressPreviewClick = false;
        }, 0);
      }
      pan = null;
      element.classList.remove("smarttex-document-panning");
      element.releasePointerCapture?.(event.pointerId);
    };
    element.addEventListener("pointerup", endPan);
    element.addEventListener("pointerup", () => {
      window.setTimeout(syncPreviewSelectionToEditor, 0);
    });
    element.addEventListener("pointercancel", endPan);
    element.addEventListener("click", (event) => {
      if (suppressPreviewClick) {
        suppressPreviewClick = false;
        event.preventDefault();
        return;
      }
      if (event.target.closest("button, a, input, label, select")) return;
      const page = element.querySelector(".smarttex-document-page");
      if (!page) return;
      previewNavigationPreferredX = null;
      previewKeyboardHandoff = false;
      element.focus({ preventScroll: true });
      const selection = document.getSelection();
      if (
        selection &&
        !selection.isCollapsed &&
        page.contains(selection.anchorNode) &&
        page.contains(selection.focusNode)
      ) {
        syncPreviewSelectionToEditor();
        return;
      }
      const point = pointFromViewport(event.clientX, event.clientY);
      const index = renderedIndexForDomPoint(
        page,
        point,
        event.clientX,
        event.clientY
      );
      if (index !== null) moveEditorFromPreview(index);
    });
    element.addEventListener("keydown", (event) => {
      if (event.target.closest("button, input, select, textarea")) return;
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        const range = sourceSelectionRange();
        previewKeyboardHandoff = true;
        replacePreviewSource(
          range.start,
          range.end,
          event.key,
          range.start + event.key.length,
          range.start + event.key.length,
          true
        ).then((replaced) => {
          if (replaced) {
            window.requestAnimationFrame(() => {
              bridgeRequest("focus").catch(() => {});
            });
          }
        }).catch((error) => {
          console.warn("SmartTeX could not continue typing in the editor:", error);
        });
        return;
      }
      if (![
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "PageUp",
        "PageDown"
      ].includes(event.key)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        movePreviewCursorByVisualLine(
          event.key === "ArrowUp" ? -1 : 1,
          event.shiftKey,
          previewKeyboardHandoff
        );
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        movePreviewCursorHorizontally(
          event.key === "ArrowLeft" ? -1 : 1,
          event.shiftKey,
          previewKeyboardHandoff
        );
      } else {
        previewNavigationPreferredX = null;
        movePreviewCursorByPage(
          event.key === "PageUp" ? -1 : 1,
          event.shiftKey,
          previewKeyboardHandoff
        );
      }
    });
    document.addEventListener("selectionchange", () => {
      window.clearTimeout(previewSelectionSyncTimer);
      previewSelectionSyncTimer = window.setTimeout(
        syncPreviewSelectionToEditor,
        25
      );
    }, true);
  }

  function renderedSourceElement(page, sourceIndex) {
    const rangedElements = [...page.querySelectorAll(
      "[data-smarttex-source-start][data-smarttex-source-end]"
    )];
    let candidates = rangedElements.filter((element) => {
      const range = sourceRange(element);
      return range && sourceIndex >= range.start && sourceIndex <= range.end;
    });
    if (!candidates.length) {
      candidates = rangedElements.sort((left, right) => {
        const leftRange = sourceRange(left);
        const rightRange = sourceRange(right);
        const leftDistance = sourceIndex < leftRange.start
          ? leftRange.start - sourceIndex
          : sourceIndex - leftRange.end;
        const rightDistance = sourceIndex < rightRange.start
          ? rightRange.start - sourceIndex
          : sourceIndex - rightRange.end;
        return leftDistance - rightDistance;
      }).slice(0, 1);
    }
    return candidates.sort((left, right) => {
      const leftRange = sourceRange(left);
      const rightRange = sourceRange(right);
      const leftPriority = left.matches(
        ".smarttex-document-equation, .smarttex-document-inline-equation, .smarttex-document-table"
      ) ? 0 : 1;
      const rightPriority = right.matches(
        ".smarttex-document-equation, .smarttex-document-inline-equation, .smarttex-document-table"
      ) ? 0 : 1;
      return (
        leftPriority - rightPriority ||
        (leftRange.end - leftRange.start) - (rightRange.end - rightRange.start)
      );
    })[0] || null;
  }

  function clearFastCursor(page) {
    page.querySelectorAll(
      ".smarttex-document-text-caret, .smarttex-rendered-caret, .smarttex-table-rendered-caret"
    ).forEach((caret) => caret.remove());
    page.querySelectorAll(".smarttex-document-active-source")
      .forEach((element) => element.classList.remove("smarttex-document-active-source"));
  }

  function revealPreviewCaret(caret) {
    if (!caret || !preview || preview.hidden) return;
    const caretRect = caret.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const margin = Math.min(56, Math.max(24, preview.clientHeight * 0.12));
    if (
      caretRect.top < previewRect.top + margin ||
      caretRect.bottom > previewRect.bottom - margin
    ) {
      const caretCenter = caretRect.top + caretRect.height / 2;
      const previewCenter = previewRect.top + preview.clientHeight / 2;
      preview.scrollTop += caretCenter - previewCenter;
    }
  }

  function insertApproximateTextCaret(element, renderedIndex) {
    const range = sourceRange(element);
    if (!range) return null;
    const ratio = range.end > range.start
      ? Math.max(0, Math.min(1, (renderedIndex - range.start) / (range.end - range.start)))
      : 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest(".katex")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = [];
    let totalLength = 0;
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
      totalLength += walker.currentNode.data.length;
    }
    const caret = document.createElement("span");
    caret.className = "smarttex-document-text-caret smarttex-document-fast-caret";
    caret.setAttribute("aria-label", "Editor cursor");
    let remaining = Math.round(totalLength * ratio);
    for (const node of textNodes) {
      if (remaining > node.data.length) {
        remaining -= node.data.length;
        continue;
      }
      const tail = splitMappedTextNode(
        node,
        Math.max(0, Math.min(remaining, node.data.length))
      );
      tail.parentNode.insertBefore(caret, tail);
      return caret;
    }
    element.appendChild(caret);
    return caret;
  }

  function splitMappedTextNode(node, offsetValue) {
    const offset = Math.max(
      0,
      Math.min(Number(offsetValue) || 0, node?.data?.length || 0)
    );
    const boundaries = Array.isArray(node?.smarttexSourceBoundaries)
      ? node.smarttexSourceBoundaries.slice()
      : null;
    const tail = node.splitText(offset);
    if (boundaries?.length === node.data.length + tail.data.length + 1) {
      node.smarttexSourceBoundaries = boundaries.slice(0, offset + 1);
      tail.smarttexSourceBoundaries = boundaries.slice(offset);
    }
    return tail;
  }

  function createFastTextCaret(documentValue = document) {
    const caret = documentValue.createElement("span");
    caret.className = "smarttex-document-text-caret smarttex-document-fast-caret";
    caret.setAttribute("aria-label", "Editor cursor");
    return caret;
  }

  function mappedBoundaryCaret(container, renderedIndex) {
    if (!container) return null;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let best = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const boundaries = Array.isArray(node.smarttexSourceBoundaries)
        ? node.smarttexSourceBoundaries
        : null;
      if (!boundaries || boundaries.length !== node.data.length + 1) continue;
      const first = Number(boundaries[0]);
      const last = Number(boundaries.at(-1));
      if (
        !Number.isFinite(first) ||
        !Number.isFinite(last) ||
        renderedIndex < Math.min(first, last) ||
        renderedIndex > Math.max(first, last)
      ) {
        continue;
      }
      for (let offset = 0; offset < boundaries.length; offset += 1) {
        const boundary = Number(boundaries[offset]);
        if (!Number.isFinite(boundary)) continue;
        const distance = Math.abs(boundary - renderedIndex);
        if (!best || distance < best.distance) {
          best = { node, offset, distance };
          if (distance === 0) break;
        }
      }
      if (best?.distance === 0) break;
    }
    if (!best) return null;
    const caret = createFastTextCaret(container.ownerDocument || document);
    const tail = splitMappedTextNode(best.node, best.offset);
    tail.parentNode.insertBefore(caret, tail);
    return caret;
  }

  function inlineMappedRange(element) {
    const start = Number(element?.smarttexSourceRange?.start);
    const end = Number(element?.smarttexSourceRange?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end: Math.max(start, end) };
  }

  function mappedInlineRangeElement(container, renderedIndex) {
    return [container, ...container.querySelectorAll("*")]
      .filter((element) => {
        const range = inlineMappedRange(element);
        return range && renderedIndex >= range.start && renderedIndex <= range.end;
      })
      .sort((left, right) => {
        const leftRange = inlineMappedRange(left);
        const rightRange = inlineMappedRange(right);
        return (
          (leftRange.end - leftRange.start) -
          (rightRange.end - rightRange.start)
        );
      })[0] || null;
  }

  function insertCaretBesideElement(element, before) {
    if (!element?.parentNode) return null;
    const caret = createFastTextCaret(element.ownerDocument || document);
    element.parentNode.insertBefore(caret, before ? element : element.nextSibling);
    return caret;
  }

  function rerenderInlineMathCaret(math, renderedIndex, sourceValue) {
    const range = inlineMappedRange(math);
    const source = String(sourceValue || "");
    if (!range || range.end > source.length) return null;
    const raw = source.slice(range.start, range.end);
    let opening = "";
    let closing = "";
    if (raw.startsWith("\\(")) {
      opening = "\\(";
      closing = "\\)";
    } else if (raw.startsWith("$$")) {
      opening = "$$";
      closing = "$$";
    } else if (raw.startsWith("$")) {
      opening = "$";
      closing = "$";
    }
    if (!opening || !raw.endsWith(closing)) return null;
    const contentStart = range.start + opening.length;
    const contentEnd = range.end - closing.length;
    if (renderedIndex <= contentStart) return insertCaretBesideElement(math, true);
    if (renderedIndex >= contentEnd) return insertCaretBesideElement(math, false);
    const mathSource = source.slice(contentStart, contentEnd);
    const rawOffset = Math.max(
      0,
      Math.min(renderedIndex - contentStart, mathSource.length)
    );
    const placement = contextTools.resolveCaretPlacement(mathSource, rawOffset);
    const caretOffset = contextTools.commandAwareCaretOffset(
      mathSource,
      rawOffset,
      placement.commandSide
    );
    const prepared = contextTools.prepareDocumentCommands(
      source,
      range.start,
      ""
    );
    try {
      katex.render(
        mathSource.slice(0, caretOffset) +
          "\\SmartTeXCaret{}" +
          mathSource.slice(caretOffset),
        math,
        {
          displayMode: false,
          throwOnError: true,
          strict: "ignore",
          trust: trustedKatexCommand,
          maxExpand: 1000,
          maxSize: 25,
          macros: macrosFor(prepared)
        }
      );
      return math.querySelector(".smarttex-rendered-caret");
    } catch (_error) {
      return null;
    }
  }

  function insertApproximateMappedRangeCaret(element, renderedIndex) {
    const range = inlineMappedRange(element);
    if (!range) return null;
    const ratio = range.end > range.start
      ? Math.max(
          0,
          Math.min(1, (renderedIndex - range.start) / (range.end - range.start))
        )
      : 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest(".katex")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let length = 0;
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
      length += walker.currentNode.data.length;
    }
    let remaining = Math.round(length * ratio);
    for (const node of nodes) {
      if (remaining > node.data.length) {
        remaining -= node.data.length;
        continue;
      }
      const caret = createFastTextCaret(element.ownerDocument || document);
      const tail = splitMappedTextNode(node, remaining);
      tail.parentNode.insertBefore(caret, tail);
      return caret;
    }
    return insertCaretBesideElement(element, false);
  }

  function insertMappedInlineCaret(
    container,
    renderedIndex,
    sourceValue = lastRenderedSource
  ) {
    if (!container) return null;
    const containerRange = sourceRange(container);
    if (
      containerRange &&
      (
        renderedIndex < containerRange.start ||
        renderedIndex > containerRange.end
      )
    ) {
      return null;
    }
    const exact = mappedBoundaryCaret(container, renderedIndex);
    if (exact) return exact;
    const mappedElement = mappedInlineRangeElement(container, renderedIndex);
    if (!mappedElement) return null;
    const math = mappedElement.matches?.(".smarttex-table-inline-math")
      ? mappedElement
      : mappedElement.closest?.(".smarttex-table-inline-math");
    if (math && container.contains(math)) {
      const mathCaret = rerenderInlineMathCaret(
        math,
        renderedIndex,
        sourceValue
      );
      if (mathCaret) return mathCaret;
    }
    return insertApproximateMappedRangeCaret(mappedElement, renderedIndex);
  }

  function exactTextPartForCursor(page, state, renderedIndex) {
    const source = String(state.value || "");
    const metadata = documentMetadata(source.slice(0, documentBounds(source).start));
    const segments = page.smarttexTextSegments || [];
    const chunks = [];
    for (const segment of segments) {
      if (
        renderedIndex < segment.chunkStart ||
        renderedIndex > segment.chunkEnd
      ) {
        continue;
      }
      if (!chunks.some((chunk) => (
        chunk.start === segment.chunkStart && chunk.end === segment.chunkEnd
      ))) {
        chunks.push({ start: segment.chunkStart, end: segment.chunkEnd });
      }
    }
    chunks.sort((left, right) => (
      (left.end - left.start) - (right.end - right.start)
    ));

    for (const chunk of chunks) {
      const currentStart = mapRenderedIndexToCurrentSource(
        source,
        chunk.start,
        "start"
      );
      const currentEnd = mapRenderedIndexToCurrentSource(
        source,
        chunk.end,
        "end"
      );
      if (
        state.cursorIndex < currentStart ||
        state.cursorIndex > currentEnd
      ) {
        continue;
      }
      const currentChunk = source.slice(currentStart, currentEnd);
      const rawOffset = Math.max(
        0,
        Math.min(state.cursorIndex - currentStart, currentChunk.length)
      );
      const placement = contextTools.resolveCaretPlacement(currentChunk, rawOffset);
      const caretOffset = contextTools.commandAwareCaretOffset(
        currentChunk,
        rawOffset,
        placement.commandSide
      );
      const markedChunk = (
        currentChunk.slice(0, caretOffset) +
        TEXT_CARET +
        currentChunk.slice(caretOffset)
      );
      const parts = plainLatex(markedChunk, metadata, true).split(/(\n{2,})/);
      let partIndex = 0;
      for (const part of parts) {
        if (/^\n{2,}$/.test(part) || !part.trim()) continue;
        const paragraph = part.trim();
        if (!paragraph.includes(TEXT_CARET)) {
          partIndex += 1;
          continue;
        }
        const marker = paragraph[0];
        const content = ["\uE110", "\uE111", "\uE112", "\uE113", "\uE114"]
          .includes(marker)
          ? paragraph.slice(1).trim()
          : paragraph;
        const segment = segments.find((candidate) => (
          candidate.chunkStart === chunk.start &&
          candidate.chunkEnd === chunk.end &&
          candidate.partIndex === partIndex
        ));
        if (!segment) return null;
        return {
          segment,
          value: segment.leadingWhitespace + normalizedSeparatedText(content)
        };
      }
    }
    return null;
  }

  function replaceTextSegmentWithCaret(part, { showCaret = true } = {}) {
    const { segment, value } = part || {};
    if (
      !segment?.startAnchor?.isConnected ||
      !segment?.endAnchor?.isConnected
    ) {
      return null;
    }
    const range = document.createRange();
    range.setStartAfter(segment.startAnchor);
    range.setEndBefore(segment.endAnchor);
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    appendFormattedTextWithCaret(
      fragment,
      showCaret ? String(value || "") : String(value || "").replaceAll(TEXT_CARET, "")
    );
    range.insertNode(fragment);
    segment.fastPatched = true;
    const caret = showCaret
      ? segment.element.querySelector(".smarttex-document-text-caret")
      : null;
    caret?.classList.add("smarttex-document-fast-caret");
    return caret;
  }

  function referenceDecoratedText(value, model) {
    let decorated = String(value || "");
    for (const interaction of model?.interactions || []) {
      const index = decorated.indexOf(interaction.placeholder);
      if (index < 0) continue;
      decorated = (
        decorated.slice(0, index) +
        referenceDisplay(interaction, model) +
        decorated.slice(index + interaction.placeholder.length)
      );
    }
    return decorated;
  }

  function insertCaretWithoutReplacingLinks(part, model) {
    const { segment } = part || {};
    if (
      !segment?.startAnchor?.isConnected ||
      !segment?.endAnchor?.isConnected
    ) {
      return null;
    }
    const decorated = referenceDecoratedText(part.value, model);
    const caretOffset = decorated.indexOf(TEXT_CARET);
    if (caretOffset < 0) return null;
    const segmentRange = document.createRange();
    segmentRange.setStartAfter(segment.startAnchor);
    segmentRange.setEndBefore(segment.endAnchor);
    const walker = document.createTreeWalker(segment.element, NodeFilter.SHOW_TEXT);
    let remaining = caretOffset;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      let inside = false;
      try {
        inside = (
          segmentRange.comparePoint(node, 0) === 0 ||
          segmentRange.comparePoint(node, node.data.length) === 0
        );
      } catch (_error) {
        inside = false;
      }
      if (!inside) continue;
      if (remaining > node.data.length) {
        remaining -= node.data.length;
        continue;
      }
      const caret = document.createElement("span");
      caret.className = "smarttex-document-text-caret smarttex-document-fast-caret";
      caret.setAttribute("aria-label", "Editor cursor");
      const tail = splitMappedTextNode(
        node,
        Math.max(0, Math.min(remaining, node.data.length))
      );
      tail.parentNode.insertBefore(caret, tail);
      return caret;
    }
    const caret = document.createElement("span");
    caret.className = "smarttex-document-text-caret smarttex-document-fast-caret";
    caret.setAttribute("aria-label", "Editor cursor");
    segment.endAnchor.parentNode.insertBefore(caret, segment.endAnchor);
    return caret;
  }

  function refreshActiveRenderedBlock(target, state) {
    const oldRange = sourceRange(target);
    if (!oldRange) return null;
    const source = String(state.value || "");
    let context = null;
    let renderer = null;
    if (target.matches(".smarttex-document-table")) {
      context = contextTools.findTableContext(source, state.cursorIndex);
      renderer = renderTableBlock;
    } else if (target.matches(
      ".smarttex-document-equation, .smarttex-document-inline-equation"
    )) {
      context = contextTools.findEquationContext(source, state.cursorIndex);
      if (!context) {
        const enclosing = contextTools.equationContexts(source).contexts
          .filter((candidate) => (
            state.cursorIndex >= candidate.openStart &&
            state.cursorIndex <= candidate.closeEnd
          ))
          .sort((left, right) => (
            (left.closeEnd - left.openStart) - (right.closeEnd - right.openStart)
          ))[0];
        if (enclosing) {
          context = {
            ...enclosing,
            source: source.slice(enclosing.contentStart, enclosing.contentEnd),
            cursorOffset: Math.max(
              0,
              Math.min(
                state.cursorIndex - enclosing.contentStart,
                enclosing.contentEnd - enclosing.contentStart
              )
            )
          };
        }
      }
      renderer = renderEquationBlock;
    }
    if (!context || !renderer) return null;
    const fragment = document.createDocumentFragment();
    renderer(fragment, context, state);
    const replacement = fragment.firstElementChild;
    if (!replacement) return null;
    replacement.dataset.smarttexSourceStart = String(oldRange.start);
    replacement.dataset.smarttexSourceEnd = String(oldRange.end);
    target.replaceWith(replacement);
    return replacement.querySelector(
      ".smarttex-rendered-caret, .smarttex-table-rendered-caret"
    );
  }


  function sourceEditDifference(previousValue, nextValue) {
    const previous = String(previousValue || "");
    const next = String(nextValue || "");
    if (previous === next) return null;
    const commonLimit = Math.min(previous.length, next.length);
    let prefix = 0;
    while (prefix < commonLimit && previous[prefix] === next[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < commonLimit - prefix &&
      previous[previous.length - 1 - suffix] ===
        next[next.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    return {
      oldStart: prefix,
      oldEnd: previous.length - suffix,
      newStart: prefix,
      newEnd: next.length - suffix,
      delta: next.length - previous.length
    };
  }

  function changesParagraphStructure(previousValue, nextValue, difference = null) {
    const previous = String(previousValue || "");
    const next = String(nextValue || "");
    const diff = difference || sourceEditDifference(previous, next);
    if (!diff) return false;
    const previousWindow = previous.slice(
      Math.max(0, diff.oldStart - 2),
      Math.min(previous.length, diff.oldEnd + 2)
    );
    const nextWindow = next.slice(
      Math.max(0, diff.newStart - 2),
      Math.min(next.length, diff.newEnd + 2)
    );
    return /[\r\n]/.test(previousWindow) || /[\r\n]/.test(nextWindow);
  }

  function blockFlowContexts(sourceValue) {
    const source = String(sourceValue || "");
    const bounds = documentBounds(source);
    return sourceContexts(source, bounds).filter((context) => (
      context.previewType === "figure" ||
      context.previewType === "table" ||
      Boolean(context.display)
    ));
  }

  function sourceEditIntersectsContext(startValue, endValue, context) {
    const start = Math.max(0, Number(startValue) || 0);
    const end = Math.max(start, Number(endValue) || start);
    if (end > start) {
      return start < context.closeEnd && end > context.openStart;
    }
    return start > context.openStart && start < context.closeEnd;
  }

  function flowRegionAroundEdit(sourceValue, startValue, endValue) {
    const source = String(sourceValue || "");
    const bounds = documentBounds(source);
    const start = Math.max(bounds.start, Math.min(Number(startValue) || 0, bounds.end));
    const end = Math.max(start, Math.min(Number(endValue) || start, bounds.end));
    if (start < bounds.start || start > bounds.end) return null;
    const blocks = blockFlowContexts(source);
    if (blocks.some((context) => sourceEditIntersectsContext(start, end, context))) {
      return null;
    }
    let regionStart = bounds.start;
    let regionEnd = bounds.end;
    for (const context of blocks) {
      if (context.closeEnd <= start) regionStart = context.closeEnd;
      if (context.openStart >= end) {
        regionEnd = context.openStart;
        break;
      }
    }
    if (regionEnd < regionStart) return null;
    return { start: regionStart, end: regionEnd };
  }

  function rangesOverlap(range, start, end) {
    if (!range) return false;
    if (start === end) return range.start <= start && range.end >= end;
    return range.end > start && range.start < end;
  }

  function remapSourceIndexAfterEdit(indexValue, difference, bias = "start") {
    const index = Math.max(0, Number(indexValue) || 0);
    if (index <= difference.oldStart) return index;
    if (index >= difference.oldEnd) return index + difference.delta;
    return bias === "end" ? difference.newEnd : difference.newStart;
  }

  function remapExistingSourceMappings(root, difference) {
    if (!root || !difference) return;
    for (const element of [root, ...root.querySelectorAll("*")]) {
      const range = sourceRange(element);
      if (range) {
        element.dataset.smarttexSourceStart = String(
          remapSourceIndexAfterEdit(range.start, difference, "start")
        );
        element.dataset.smarttexSourceEnd = String(
          remapSourceIndexAfterEdit(range.end, difference, "end")
        );
      }
      const inlineRange = inlineMappedRange(element);
      if (inlineRange) {
        element.smarttexSourceRange = {
          start: remapSourceIndexAfterEdit(
            inlineRange.start,
            difference,
            "start"
          ),
          end: remapSourceIndexAfterEdit(
            inlineRange.end,
            difference,
            "end"
          )
        };
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!Array.isArray(node.smarttexSourceBoundaries)) continue;
      node.smarttexSourceBoundaries = node.smarttexSourceBoundaries.map(
        (boundary) => remapSourceIndexAfterEdit(boundary, difference, "start")
      );
    }
  }

  function restoreReferencePlaceholders(page) {
    const model = page?.smarttexReferenceModel;
    if (!model) return;
    const interactions = new Map();
    for (const interaction of model.interactions || []) {
      const key = String(interaction.sourceIndex);
      if (!interactions.has(key)) interactions.set(key, []);
      interactions.get(key).push(interaction);
    }
    for (const link of page.querySelectorAll(".smarttex-document-reference")) {
      const queue = interactions.get(String(link.dataset.sourceIndex || ""));
      const interaction = queue?.shift();
      link.replaceWith(document.createTextNode(
        interaction?.placeholder || link.textContent || ""
      ));
    }
  }

  function resetReferenceTargets(page) {
    for (const element of page.querySelectorAll("[data-smarttex-reference-target]")) {
      if (element.id?.startsWith("smarttex-reference-target-")) {
        element.removeAttribute("id");
      }
      delete element.dataset.smarttexReferenceTarget;
      delete element.dataset.smarttexTargetSource;
    }
  }

  async function renderFlowRegion(
    source,
    region,
    state,
    metadata,
    referenceModel,
    generation
  ) {
    const host = document.createElement("div");
    const flow = { paragraph: null, segments: [] };
    const contexts = sourceContexts(source, region);
    let sliceStarted = performance.now();
    const checkpoint = async (force = false) => {
      if (
        generation !== fastStructureGeneration ||
        !liveEnabled ||
        currentState?.value !== source
      ) {
        return false;
      }
      if (!force && performance.now() - sliceStarted < WORK_SLICE_MS / 2) {
        return true;
      }
      // Yield a browser task so CodeMirror can paint newly entered text before
      // the larger paragraph region continues rendering.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (
        generation !== fastStructureGeneration ||
        !liveEnabled ||
        currentState?.value !== source
      ) {
        return false;
      }
      sliceStarted = performance.now();
      return true;
    };
    if (!(await checkpoint(true))) return null;
    let position = region.start;
    for (const context of contexts) {
      const appended = await appendTextChunk(
        host,
        source.slice(position, context.openStart),
        position,
        state,
        metadata,
        flow,
        checkpoint
      );
      if (!appended) return null;
      if (context.previewType === "figure") {
        flow.paragraph = null;
        renderFigureBlock(host, context, state, referenceModel);
      } else if (context.previewType === "table") {
        flow.paragraph = null;
        renderTableBlock(host, context, state);
      } else if (context.display) {
        flow.paragraph = null;
        renderEquationBlock(host, context, state);
      } else {
        if (!flow.paragraph) {
          flow.paragraph = document.createElement("p");
          host.appendChild(flow.paragraph);
        }
        appendInlineEquationLeadingSpace(
          flow.paragraph,
          source.slice(position, context.openStart)
        );
        renderEquationBlock(flow.paragraph, context, state);
      }
      if (
        context.previewType === "table" ||
        context.previewType === "figure" ||
        context.display
      ) {
        flow.paragraph = null;
      }
      position = context.closeEnd;
    }
    const appended = await appendTextChunk(
      host,
      source.slice(position, region.end),
      position,
      state,
      metadata,
      flow,
      checkpoint
    );
    if (!appended || !(await checkpoint(true))) return null;
    return { host, segments: flow.segments };
  }

  async function applyFastStructuralRegion(
    baseSource,
    state,
    difference,
    oldRegion,
    newRegion,
    generation
  ) {
    const source = String(state.value || "");
    const metadata = documentMetadata(
      source.slice(0, documentBounds(source).start)
    );
    const referenceModel = documentReferenceModel(source);
    const rendered = await renderFlowRegion(
      source,
      newRegion,
      state,
      metadata,
      referenceModel,
      generation
    );
    if (
      !rendered ||
      generation !== fastStructureGeneration ||
      !currentState ||
      currentState.value !== source ||
      lastRenderedSource !== baseSource
    ) {
      return false;
    }
    const page = preview?.querySelector(".smarttex-document-page");
    if (!page) return false;
    const directChildren = [...page.children];
    const replacedNodes = directChildren.filter((element) => (
      rangesOverlap(sourceRange(element), oldRegion.start, oldRegion.end)
    ));
    const insertionPoint = directChildren.find((element) => {
      const range = sourceRange(element);
      return range && range.start >= oldRegion.end;
    }) || null;
    if (!replacedNodes.length && !insertionPoint && oldRegion.end < baseSource.length) {
      return false;
    }

    clearFastCursor(page);
    restoreReferencePlaceholders(page);
    resetReferenceTargets(page);

    const retainedSegments = [];
    for (const segment of page.smarttexTextSegments || []) {
      const oldChunkRange = {
        start: segment.chunkStart,
        end: segment.chunkEnd
      };
      if (rangesOverlap(oldChunkRange, oldRegion.start, oldRegion.end)) continue;
      segment.chunkStart = remapSourceIndexAfterEdit(
        segment.chunkStart,
        difference,
        "start"
      );
      segment.chunkEnd = remapSourceIndexAfterEdit(
        segment.chunkEnd,
        difference,
        "end"
      );
      retainedSegments.push(segment);
    }
    remapExistingSourceMappings(page, difference);

    const fragment = document.createDocumentFragment();
    while (rendered.host.firstChild) {
      fragment.appendChild(rendered.host.firstChild);
    }
    for (const node of replacedNodes) node.remove();
    page.insertBefore(fragment, insertionPoint?.isConnected ? insertionPoint : null);

    page.smarttexTextSegments = [...retainedSegments, ...rendered.segments]
      .sort((left, right) => (
        left.chunkStart - right.chunkStart || left.partIndex - right.partIndex
      ));
    page.smarttexReferenceModel = referenceModel;
    decorateReferenceTargets(page, source, referenceModel);
    decorateReferenceLinks(page, referenceModel);
    lastRenderedSource = source;
    preview.dataset.lastFastRegionAt = String(Date.now());
    refreshPreviewSourceHighlight(state);
    const caret = page.querySelector(
      ".smarttex-rendered-caret, .smarttex-table-rendered-caret, " +
      ".smarttex-document-text-caret"
    );
    revealPreviewCaret(caret);
    // Re-resolve the current editor position against the newly installed exact
    // text segments. This covers a cursor move that occurred while the region
    // was yielding to keep editor input responsive.
    if (currentState?.value === source) {
      scheduleFastCursorUpdate({ ...currentState });
    }
    return true;
  }

  function scheduleFastStructuralRegionUpdate(
    baseSourceValue,
    state,
    { structuralOnly = true } = {}
  ) {
    const baseSource = String(baseSourceValue || "");
    const source = String(state?.value || "");
    if (!baseSource || !source || baseSource === source) return "none";
    const difference = sourceEditDifference(baseSource, source);
    if (
      !difference ||
      (structuralOnly && !changesParagraphStructure(baseSource, source, difference))
    ) {
      return "none";
    }
    const oldRegion = flowRegionAroundEdit(
      baseSource,
      difference.oldStart,
      difference.oldEnd
    );
    const newRegion = flowRegionAroundEdit(
      source,
      difference.newStart,
      difference.newEnd
    );
    if (!oldRegion || !newRegion) return "force";
    if (
      oldRegion.end - oldRegion.start > FAST_STRUCTURAL_REGION_LIMIT ||
      newRegion.end - newRegion.start > FAST_STRUCTURAL_REGION_LIMIT
    ) {
      return "force";
    }
    const generation = ++fastStructureGeneration;
    pendingFastStructureSource = source;
    applyFastStructuralRegion(
      baseSource,
      { ...state },
      difference,
      oldRegion,
      newRegion,
      generation
    ).then((applied) => {
      if (generation !== fastStructureGeneration) return;
      if (pendingFastStructureSource === source) {
        pendingFastStructureSource = null;
      }
      if (!applied && currentState?.value === source) {
        scheduleRender({ force: true, contentChanged: true });
      }
    }).catch((error) => {
      if (generation === fastStructureGeneration) {
        pendingFastStructureSource = null;
        console.error("SmartTeX fast paragraph rendering failed:", error);
        scheduleRender({ force: true, contentChanged: true });
      }
    });
    return "scheduled";
  }

  function updatePreviewAfterSourceMutation(
    previousSource,
    state,
    { preferRegion = false } = {}
  ) {
    const source = String(state?.value || "");
    const baseSource = String(lastRenderedSource || previousSource || "");
    const fastMode = scheduleFastStructuralRegionUpdate(
      baseSource,
      state,
      { structuralOnly: !preferRegion }
    );
    // Formatting and list commands need a wider region replacement for exact
    // structure, but the active text segment can still be patched on the next
    // animation frame so the visible change appears without waiting for that
    // region render to finish.
    if (fastMode === "none" || preferRegion) scheduleFastCursorUpdate(state);
    return fastMode;
  }


  function fastSourceChangeCanBeCommitted(previousValue, nextValue, difference) {
    if (!difference || changesParagraphStructure(previousValue, nextValue, difference)) {
      return false;
    }
    const previous = String(previousValue || "");
    const next = String(nextValue || "");
    const changed = (
      previous.slice(difference.oldStart, difference.oldEnd) +
      next.slice(difference.newStart, difference.newEnd)
    );
    // Only commit literal prose edits through the lightweight path. Commands,
    // comments, math delimiters, and grouping characters may change document
    // structure or reference decoration and are handled by the deferred render.
    return !/[\\${}%\[\]]/.test(changed);
  }

  function remapFastReferenceModel(model, difference) {
    if (!model || !difference) return;
    const visited = new Set();
    const remapObject = (entry) => {
      if (!entry || visited.has(entry)) return;
      visited.add(entry);
      for (const [key, bias] of [
        ["index", "start"],
        ["sourceIndex", "start"],
        ["sourceEnd", "end"],
        ["contextStart", "start"],
        ["contextEnd", "end"],
        ["commandEnd", "end"]
      ]) {
        if (!Number.isFinite(Number(entry[key]))) continue;
        entry[key] = remapSourceIndexAfterEdit(entry[key], difference, bias);
      }
    };
    for (const entry of model.targetList || []) remapObject(entry);
    for (const entry of model.sections || []) remapObject(entry);
    for (const entry of model.interactions || []) remapObject(entry);
    for (const entry of model.targets?.values?.() || []) remapObject(entry);
  }

  function remapFastRenderedMappings(page, difference) {
    if (!page || !difference) return;

    // Source-ranged rendering blocks are sufficient for editor-to-preview
    // navigation. Avoid traversing every KaTeX and formatting descendant on
    // each keypress, which previously blocked CodeMirror's next paint.
    for (const element of page.querySelectorAll(
      "[data-smarttex-source-start][data-smarttex-source-end]"
    )) {
      const range = sourceRange(element);
      if (!range) continue;
      element.dataset.smarttexSourceStart = String(
        remapSourceIndexAfterEdit(range.start, difference, "start")
      );
      element.dataset.smarttexSourceEnd = String(
        remapSourceIndexAfterEdit(range.end, difference, "end")
      );
    }

    for (const segment of page.smarttexTextSegments || []) {
      segment.chunkStart = remapSourceIndexAfterEdit(
        segment.chunkStart,
        difference,
        "start"
      );
      segment.chunkEnd = remapSourceIndexAfterEdit(
        segment.chunkEnd,
        difference,
        "end"
      );
    }

    // Character-accurate mappings are only attached inside rendered captions
    // and tables. Updating those limited subtrees preserves immediate click
    // accuracy without walking every text node in the document.
    const mappedContainers = [...page.querySelectorAll(
      ".smarttex-document-caption-source, .smarttex-document-table"
    )].filter((container, index, containers) => (
      !containers.slice(0, index).some((parent) => parent.contains(container))
    ));
    for (const container of mappedContainers) {
      for (const element of [container, ...container.querySelectorAll("*")]) {
        const inlineRange = inlineMappedRange(element);
        if (!inlineRange) continue;
        element.smarttexSourceRange = {
          start: remapSourceIndexAfterEdit(
            inlineRange.start,
            difference,
            "start"
          ),
          end: remapSourceIndexAfterEdit(
            inlineRange.end,
            difference,
            "end"
          )
        };
      }
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!Array.isArray(node.smarttexSourceBoundaries)) continue;
        node.smarttexSourceBoundaries = node.smarttexSourceBoundaries.map(
          (boundary) => remapSourceIndexAfterEdit(
            boundary,
            difference,
            "start"
          )
        );
      }
    }

    // Existing references retain their rendered labels; only their source
    // positions need to move until the deferred full render refreshes them.
    for (const link of page.querySelectorAll(".smarttex-document-reference")) {
      const sourceIndex = Number(link.dataset.sourceIndex);
      if (!Number.isFinite(sourceIndex)) continue;
      link.dataset.sourceIndex = String(
        remapSourceIndexAfterEdit(sourceIndex, difference, "start")
      );
    }
    for (const target of page.querySelectorAll("[data-smarttex-target-source]")) {
      const sourceIndex = Number(target.dataset.smarttexTargetSource);
      if (!Number.isFinite(sourceIndex)) continue;
      target.dataset.smarttexTargetSource = String(
        remapSourceIndexAfterEdit(sourceIndex, difference, "start")
      );
    }
    remapFastReferenceModel(page.smarttexReferenceModel, difference);
  }

  function commitFastRenderedSource(nextSourceValue, state) {
    const previousSource = String(lastRenderedSource || "");
    const nextSource = String(nextSourceValue || "");
    const difference = sourceEditDifference(previousSource, nextSource);
    if (
      !difference ||
      !fastSourceChangeCanBeCommitted(previousSource, nextSource, difference)
    ) {
      return false;
    }
    const page = preview?.querySelector(".smarttex-document-page");
    if (!page) return false;
    remapFastRenderedMappings(page, difference);
    lastRenderedSource = nextSource;
    preview.dataset.lastFastSourceAt = String(Date.now());
    preview.dataset.lastFastCommitMode = "lightweight";
    refreshPreviewSourceHighlight(state);
    return true;
  }

  function updateFastCursor(state) {
    if (!liveEnabled || !preview || preview.hidden || !lastRenderedSource) {
      return { handled: false, contentPatched: false };
    }
    const page = preview.querySelector(".smarttex-document-page");
    if (!page) return { handled: false, contentPatched: false };
    const renderedIndex = mapCursorToRenderedSource(
      state.value,
      state.cursorIndex
    );
    clearFastCursor(page);
    let contentPatched = false;
    const contentDifference = state.value !== lastRenderedSource
      ? sourceEditDifference(lastRenderedSource, state.value)
      : null;
    const selectionStart = Math.min(
      Number(state.selectionFrom ?? state.cursorIndex) || 0,
      Number(state.selectionTo ?? state.cursorIndex) || 0
    );
    const selectionEnd = Math.max(
      Number(state.selectionFrom ?? state.cursorIndex) || 0,
      Number(state.selectionTo ?? state.cursorIndex) || 0
    );
    const changeTouchesActiveSelection = Boolean(contentDifference) && (
      selectionStart <= contentDifference.newEnd + 1 &&
      selectionEnd >= Math.max(0, contentDifference.newStart - 1)
    );
    const hasSelection = selectionStart !== selectionEnd;

    // Text segments have exact source/chunk mappings. Resolve them before the
    // coarser element ranges, whose boundaries can be temporarily approximate
    // immediately after inserting or deleting paragraph separators.
    const exactPart = exactTextPartForCursor(page, state, renderedIndex);
    if (exactPart) {
      if (hasSelection) {
        if (
          state.value !== lastRenderedSource ||
          exactPart.segment.fastPatched
        ) {
          contentPatched = Boolean(
            replaceTextSegmentWithCaret(exactPart, { showCaret: false })
          ) && changeTouchesActiveSelection;
          if (state.value === lastRenderedSource) {
            exactPart.segment.fastPatched = false;
          }
        }
        refreshPreviewSourceHighlight(state);
        return { handled: true, contentPatched };
      }

      clearPreviewSourceHighlight();
      let caret;
      if (
        state.value === lastRenderedSource &&
        !exactPart.segment.fastPatched
      ) {
        caret = insertCaretWithoutReplacingLinks(
          exactPart,
          page.smarttexReferenceModel
        );
      } else {
        caret = replaceTextSegmentWithCaret(exactPart);
        if (caret && changeTouchesActiveSelection) contentPatched = true;
        if (state.value === lastRenderedSource) {
          exactPart.segment.fastPatched = false;
        }
      }
      revealPreviewCaret(caret);
      return { handled: Boolean(caret), contentPatched };
    }

    const target = renderedSourceElement(page, renderedIndex);
    if (!target) {
      if (hasSelection) refreshPreviewSourceHighlight(state);
      else clearPreviewSourceHighlight();
      return { handled: false, contentPatched: false };
    }

    if (hasSelection) {
      if (target.matches(
        ".smarttex-document-equation, .smarttex-document-inline-equation"
      )) {
        contentPatched = (
          changeTouchesActiveSelection &&
          Boolean(refreshActiveRenderedBlock(target, state))
        );
      }
      refreshPreviewSourceHighlight(state);
      return { handled: true, contentPatched };
    }

    clearPreviewSourceHighlight();
    let caret = refreshActiveRenderedBlock(target, state);
    contentPatched = Boolean(caret) && changeTouchesActiveSelection;
    if (!caret) {
      const captionSource = target.matches?.(".smarttex-document-caption-source")
        ? target
        : (
            target.querySelector?.(".smarttex-document-caption-source") ||
            target.closest?.(".smarttex-document-caption-source")
          );
      if (captionSource) {
        caret = insertMappedInlineCaret(
          captionSource,
          renderedIndex,
          lastRenderedSource
        );
      }
    }
    if (!caret) {
      const textTarget = target.matches(
        "p, h1, h2, h3, h4, h5, header, figcaption, " +
        ".smarttex-document-title, .smarttex-document-caption-source"
      ) ? target : target.closest(
        "p, h1, h2, h3, h4, h5, header, figcaption, " +
        ".smarttex-document-title, .smarttex-document-caption-source"
      );
      if (textTarget) {
        caret = insertApproximateTextCaret(textTarget, renderedIndex);
      }
    }
    revealPreviewCaret(caret);
    return { handled: Boolean(caret), contentPatched };
  }

  function scheduleFastCursorUpdate(state) {
    if (!liveEnabled || !preview || !state) return;
    if (fastCursorFrame !== null) cancelAnimationFrame(fastCursorFrame);
    const snapshot = { ...state };
    fastCursorFrame = requestAnimationFrame(() => {
      fastCursorFrame = null;
      const result = updateFastCursor(snapshot);
      if (
        result?.contentPatched &&
        currentState?.value === snapshot.value &&
        pendingFastStructureSource !== snapshot.value
      ) {
        commitFastRenderedSource(snapshot.value, snapshot);
      }
    });
  }

  function referenceTargetElement(page, target) {
    if (target.type === "section") {
      const sectionIndex = page.smarttexReferenceModel?.sections.findIndex(
        (section) => section.sourceIndex === target.sourceIndex
      );
      return sectionIndex >= 0
        ? page.querySelectorAll("h2, h3, h4, h5")[sectionIndex] || null
        : null;
    }
    const selector = target.type === "equation"
      ? ".smarttex-document-equation, .smarttex-document-inline-equation"
      : target.type === "figure"
        ? ".smarttex-document-figure"
        : "p, li";
    return [...page.querySelectorAll(selector)].find((element) => {
      const range = sourceRange(element);
      return range && target.index >= range.start && target.index <= range.end;
    }) || null;
  }

  function equationReferenceNumber(source, target) {
    const context = contextTools.equationContexts(source).contexts.find(
      (candidate) => candidate.openStart === target.contextStart
    );
    if (!context) return "";
    const complete = {
      ...context,
      source: source.slice(context.contentStart, context.contentEnd)
    };
    const numbering = contextTools.equationPreviewNumbering(source, complete);
    return numbering.numbers.find((number) => number?.value)?.value || "";
  }

  function decorateReferenceTargets(page, source, model) {
    model.targetList.forEach((target, index) => {
      const element = referenceTargetElement(page, target);
      if (!element) return;
      if (!element.id) element.id = `smarttex-reference-target-${index + 1}`;
      target.domId = element.id;
      target.element = element;
      target.number = target.number || (
        target.type === "equation" ? equationReferenceNumber(source, target) : ""
      );
      element.dataset.smarttexReferenceTarget = target.label;
      element.dataset.smarttexTargetSource = String(target.sourceIndex);
      if (target.number) element.dataset.referenceNumber = target.number;
    });
  }

  function referenceDisplay(interaction, model) {
    const first = model.targets.get(interaction.labels[0]);
    if (interaction.type === "citation") {
      return `[${interaction.labels.join(", ")}]`;
    }
    const value = first?.number || interaction.labels[0] || "?";
    return interaction.command === "eqref" ? `(${value})` : value;
  }

  function navigateReference(interaction, model, { focusEditor = false } = {}) {
    const destination = model.targets.get(interaction.labels[0]);
    destination?.element?.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "smooth"
    });
    if (destination?.sourceIndex !== undefined) {
      bridgeRequest("setCursor", {
        index: destination.sourceIndex,
        focus: focusEditor
      }).catch(
        (error) => console.warn("SmartTeX could not navigate to the reference:", error)
      );
    }
  }

  function createReferenceLink(interaction, model) {
    const link = document.createElement("a");
    link.className = "smarttex-document-reference";
    link.textContent = referenceDisplay(interaction, model);
    link.dataset.labels = JSON.stringify(interaction.labels);
    link.dataset.referenceType = interaction.type;
    link.dataset.sourceIndex = String(interaction.sourceIndex);
    const target = model.targets.get(interaction.labels[0]);
    if (target?.domId) link.href = `#${target.domId}`;
    else link.href = "#";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideReferencePopup();
      hideNestedReferencePopup();
      navigateReference(interaction, model);
    });
    const show = (event) => {
      const spinnerGeneration = showPopupLoadingSpinner(event, link);
      window.requestAnimationFrame(() => {
        try {
          showReferencePopup(link, interaction, model);
        } finally {
          hidePopupLoadingSpinner(spinnerGeneration);
        }
      });
    };
    link.addEventListener("pointerenter", show);
    link.addEventListener("focus", show);
    link.addEventListener("pointerleave", scheduleHideReferencePopup);
    link.addEventListener("blur", scheduleHideReferencePopup);
    return link;
  }

  function inlineReferenceInteraction(reference, sourceIndex = 0) {
    const command = String(reference?.command || "ref");
    const label = String(reference?.label || "").trim();
    const labels = label.split(",").map((value) => value.trim()).filter(Boolean);
    const citation = /^(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)$/i.test(command);
    return {
      command,
      labels,
      placeholder: labels.length ? `[${labels.join(", ")}]` : "[?]",
      sourceIndex: Number(sourceIndex) || 0,
      type: citation ? "citation" : "reference"
    };
  }

  function createPopupCaptionReferenceLink(reference, model, sourceIndex = 0) {
    const interaction = inlineReferenceInteraction(reference, sourceIndex);
    const link = document.createElement("a");
    link.className = "smarttex-document-reference smarttex-caption-reference";
    link.textContent = referenceDisplay(interaction, model);
    link.href = "#";
    link.dataset.labels = JSON.stringify(interaction.labels);
    link.dataset.referenceType = interaction.type;
    link.dataset.sourceIndex = String(interaction.sourceIndex);
    link.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideNestedReferencePopup();
      hideReferencePopup();
      navigateReference(interaction, model);
    });
    const show = (event) => {
      const spinnerGeneration = showPopupLoadingSpinner(event, link);
      window.requestAnimationFrame(() => {
        try {
          showNestedReferencePopup(link, interaction, model);
        } finally {
          hidePopupLoadingSpinner(spinnerGeneration);
        }
      });
    };
    link.addEventListener("pointerenter", show);
    link.addEventListener("focus", show);
    link.addEventListener("pointerleave", scheduleHideNestedReferencePopup);
    link.addEventListener("blur", scheduleHideNestedReferencePopup);
    return link;
  }

  function decorateReferenceLinks(page, model) {
    const queues = new Map();
    for (const interaction of model.interactions) {
      if (!queues.has(interaction.placeholder)) {
        queues.set(interaction.placeholder, []);
      }
      queues.get(interaction.placeholder).push(interaction);
    }
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest(
          ".katex, code, .smarttex-document-figure-placeholder"
        ) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
      const pattern = /\[[^\]\n]+\]/g;
      let match;
      let position = 0;
      let changed = false;
      const fragment = document.createDocumentFragment();
      while ((match = pattern.exec(node.data))) {
        const queue = queues.get(match[0]);
        if (!queue?.length) continue;
        const interaction = queue.shift();
        if (match.index > position) {
          fragment.appendChild(document.createTextNode(
            node.data.slice(position, match.index)
          ));
        }
        fragment.appendChild(createReferenceLink(interaction, model));
        position = match.index + match[0].length;
        changed = true;
      }
      if (!changed) continue;
      if (position < node.data.length) {
        fragment.appendChild(document.createTextNode(node.data.slice(position)));
      }
      node.replaceWith(fragment);
    }
  }

  function ensureReferencePopup() {
    if (referencePopup?.isConnected) return referencePopup;
    referencePopup = document.createElement("aside");
    referencePopup.className = "smarttex-document-reference-popup";
    referencePopup.hidden = true;
    referencePopup.setAttribute("role", "tooltip");
    bindReferencePopupInteractionGuards(referencePopup);
    referencePopup.addEventListener("pointerleave", scheduleHideReferencePopup);
    document.body.appendChild(referencePopup);
    return referencePopup;
  }

  function citationCacheKey() {
    const project = window.location.pathname.match(/\/project\/([^/?#]+)/i)?.[1]
      || window.location.pathname;
    return `smarttex:citation-cache:v1:${window.location.origin}:${project}`;
  }

  function loadCitationRecords() {
    if (citationRecordsPromise) return citationRecordsPromise;
    citationRecordsPromise = Promise.resolve(
      extensionApi?.storage?.local?.get?.(citationCacheKey())
    ).then((stored) => {
      const records = stored?.[citationCacheKey()]?.records;
      citationRecords = new Map(
        (Array.isArray(records) ? records : []).map((record) => [
          String(record?.key || "").trim(),
          record
        ]).filter(([key]) => key)
      );
      citationRecordsLoaded = true;
      return citationRecords;
    }).catch((error) => {
      citationRecordsLoaded = true;
      console.warn("SmartTeX could not load citation previews:", error);
      return citationRecords;
    });
    return citationRecordsPromise;
  }

  function citationRecordCard(record, label) {
    const bounded = (value, maximum) => {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
    };
    const publicationText = (entry) => {
      if (!entry) return "";
      const volumeIssue = [entry.volume, entry.number].filter(Boolean).join("(") + (
        entry.volume && entry.number ? ")" : ""
      );
      return [
        entry.journal,
        volumeIssue,
        entry.pages,
        entry.year
      ].filter(Boolean).join(", ");
    };

    const card = document.createElement("article");
    card.className = "smarttex-reference-popup-citation";
    const heading = document.createElement("div");
    heading.className = "smarttex-reference-popup-citation-heading";
    const title = document.createElement("strong");
    title.className = "smarttex-reference-popup-citation-title";
    title.textContent = bounded(record?.title || label, 280);
    const key = document.createElement("code");
    key.className = "smarttex-reference-popup-citation-key";
    key.textContent = String(record?.key || label || "?");
    heading.append(title, key);

    const authors = document.createElement("span");
    authors.className = "smarttex-reference-popup-citation-authors";
    authors.textContent = bounded(
      (Array.isArray(record?.authors) ? record.authors : []).join(", ")
        || (record ? "Unknown author" : `Citation key: ${label}`),
      700
    );
    const publication = document.createElement("span");
    publication.className = "smarttex-reference-popup-citation-publication";
    publication.textContent = bounded(publicationText(record), 520);
    card.append(heading, authors);
    if (publication.textContent) card.appendChild(publication);
    if (record?.doi) {
      const doi = document.createElement("span");
      doi.className = "smarttex-reference-popup-citation-doi";
      doi.textContent = `DOI: ${bounded(record.doi, 240)}`;
      card.appendChild(doi);
    }
    return card;
  }

  function renderCitationPopupCards(popup, labels) {
    popup.replaceChildren();
    const visibleLabels = labels.slice(0, 8);
    for (const label of visibleLabels) {
      const targetText = citationRecords.get(label)
        ? null
        : popupCitationTargetText(label);
      popup.appendChild(citationRecordCard(
        citationRecords.get(label) || (
          targetText ? { title: targetText } : null
        ),
        label
      ));
    }
    if (labels.length > visibleLabels.length) {
      const more = document.createElement("div");
      more.className = "smarttex-reference-popup-missing";
      more.textContent = `+${labels.length - visibleLabels.length} more citations`;
      popup.appendChild(more);
    }
  }

  function popupCitationTargetText(label) {
    const target = preview?.querySelector(
      `[data-smarttex-reference-target="${CSS.escape(String(label || ""))}"]`
    );
    const text = String(target?.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > 420 ? `${text.slice(0, 419)}…` : text;
  }

  function cursorIsInsideCitationCommand() {
    const source = String(currentState?.value || "");
    const cursor = Number(currentState?.cursorIndex);
    if (!Number.isInteger(cursor) || !source) return false;
    const masked = contextTools.maskIgnoredLatex(source);
    const pattern = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{[^{}]*\}/gi;
    let match;
    while ((match = pattern.exec(masked))) {
      if (cursor >= match.index && cursor <= pattern.lastIndex) return true;
    }
    return false;
  }

  function ensureNestedReferencePopup() {
    if (nestedReferencePopup?.isConnected) return nestedReferencePopup;
    nestedReferencePopup = document.createElement("aside");
    nestedReferencePopup.className =
      "smarttex-document-reference-popup smarttex-nested-reference-popup";
    nestedReferencePopup.hidden = true;
    nestedReferencePopup.setAttribute("role", "tooltip");
    bindReferencePopupInteractionGuards(nestedReferencePopup);
    nestedReferencePopup.addEventListener("pointerleave", () => {
      scheduleHideNestedReferencePopup();
      scheduleHideReferencePopup();
    });
    document.body.appendChild(nestedReferencePopup);
    return nestedReferencePopup;
  }

  function positionNestedReferencePopup(anchor, popup) {
    if (!anchor?.isConnected || !popup || popup.hidden) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const parentRect = referencePopup?.hidden
      ? null
      : referencePopup?.getBoundingClientRect?.();
    const margin = 10;
    const gap = 8;
    const maximumLeft = Math.max(margin, window.innerWidth - popupRect.width - margin);
    let left;
    if (parentRect && parentRect.right + gap + popupRect.width <= window.innerWidth - margin) {
      left = parentRect.right + gap;
    } else if (parentRect && parentRect.left - gap - popupRect.width >= margin) {
      left = parentRect.left - gap - popupRect.width;
    } else {
      left = Math.max(margin, Math.min(anchorRect.left, maximumLeft));
    }
    const top = Math.max(
      margin,
      Math.min(anchorRect.top - 12, window.innerHeight - popupRect.height - margin)
    );
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function bindPopupCloneReferenceLinks(root, model) {
    for (const existing of [...root.querySelectorAll(".smarttex-document-reference")]) {
      let labels = [];
      try {
        labels = JSON.parse(existing.dataset.labels || "[]");
      } catch (_error) {
        labels = [];
      }
      const label = String(labels[0] || "").trim();
      if (!label) continue;
      const interaction = {
        command: existing.textContent?.startsWith("(") ? "eqref" : "ref",
        labels: [label],
        sourceIndex: Number(existing.dataset.sourceIndex) || 0,
        type: existing.dataset.referenceType === "citation" ? "citation" : "reference"
      };
      const replacement = createPopupCaptionReferenceLink({
        command: interaction.type === "citation" ? "cite" : interaction.command,
        label
      }, model, interaction.sourceIndex);
      replacement.textContent = existing.textContent || referenceDisplay(interaction, model);
      existing.replaceWith(replacement);
    }
  }

  function renderReferencePopupContent(popup, interaction, model) {
    popup.replaceChildren();
    if (interaction.type === "citation") {
      renderCitationPopupCards(popup, interaction.labels);
      return;
    }
    for (const label of interaction.labels.slice(0, 8)) {
      const target = model.targets.get(label);
      if (target?.element) {
        const clone = target.element.cloneNode(true);
        clone.removeAttribute("id");
        clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
        clone.classList.add("smarttex-reference-popup-target");
        bindPopupCloneReferenceLinks(clone, model);
        popup.appendChild(clone);
      } else {
        const missing = document.createElement("div");
        missing.className = "smarttex-reference-popup-missing";
        missing.textContent = `Reference target “${label}” was not found.`;
        popup.appendChild(missing);
      }
    }
  }

  function showReferencePopup(anchor, interaction, model) {
    if (interaction.type === "citation" && cursorIsInsideCitationCommand()) {
      hideReferencePopup();
      hideNestedReferencePopup();
      return;
    }
    window.clearTimeout(referencePopupTimer);
    hideNestedReferencePopup();
    const generation = ++referencePopupGeneration;
    const popup = ensureReferencePopup();
    renderReferencePopupContent(popup, interaction, model);
    popup.hidden = false;
    positionReferencePopup(anchor, popup);
    if (interaction.type === "citation" && !citationRecordsLoaded) {
      loadCitationRecords().then(() => {
        if (
          generation !== referencePopupGeneration ||
          popup.hidden ||
          !anchor.isConnected
        ) return;
        renderCitationPopupCards(popup, interaction.labels);
        positionReferencePopup(anchor, popup);
      });
    }
  }

  function showNestedReferencePopup(anchor, interaction, model) {
    if (!interaction?.labels?.length) return;
    if (interaction.type === "citation" && cursorIsInsideCitationCommand()) {
      hideNestedReferencePopup();
      return;
    }
    window.clearTimeout(referencePopupTimer);
    window.clearTimeout(nestedReferencePopupTimer);
    const generation = ++nestedReferencePopupGeneration;
    const popup = ensureNestedReferencePopup();
    renderReferencePopupContent(popup, interaction, model);
    popup.hidden = false;
    positionNestedReferencePopup(anchor, popup);
    if (interaction.type === "citation" && !citationRecordsLoaded) {
      loadCitationRecords().then(() => {
        if (
          generation !== nestedReferencePopupGeneration ||
          popup.hidden ||
          !anchor.isConnected
        ) return;
        renderCitationPopupCards(popup, interaction.labels);
        positionNestedReferencePopup(anchor, popup);
      });
    }
  }

  function hideNestedReferencePopup() {
    window.clearTimeout(nestedReferencePopupTimer);
    nestedReferencePopupGeneration += 1;
    if (nestedReferencePopup) nestedReferencePopup.hidden = true;
  }

  function scheduleHideNestedReferencePopup() {
    window.clearTimeout(nestedReferencePopupTimer);
    nestedReferencePopupTimer = window.setTimeout(() => {
      if (
        popupInteractionActive(nestedReferencePopup) ||
        popupInteractionActive(referencePopup)
      ) return;
      hideNestedReferencePopup();
    }, 180);
  }

  function hideReferencePopup() {
    window.clearTimeout(referencePopupTimer);
    referencePopupGeneration += 1;
    hidePopupLoadingSpinner();
    hideNestedReferencePopup();
    if (referencePopup) referencePopup.hidden = true;
  }

  function scheduleHideReferencePopup() {
    window.clearTimeout(referencePopupTimer);
    referencePopupTimer = window.setTimeout(() => {
      if (
        popupInteractionActive(referencePopup) ||
        popupInteractionActive(nestedReferencePopup)
      ) return;
      hideReferencePopup();
    }, 180);
  }

  async function renderDocument(state, generation) {
    if (!preview || !liveEnabled || generation !== renderGeneration) return;
    const checkpoint = workCheckpoint(generation);
    const source = String(state.value || "");
    const bounds = documentBounds(source);
    if (!(await checkpoint(true))) return;
    const contexts = sourceContexts(source, bounds);
    if (!(await checkpoint(true))) return;
    const referenceModel = documentReferenceModel(source);
    const metadata = documentMetadata(source.slice(0, bounds.start));
    const previousScrollTop = preview.scrollTop;
    const page = document.createElement("article");
    page.className = "smarttex-document-page";
    page.dataset.fileName = String(state.fileName || "");
    const flow = { paragraph: null, segments: [] };
    let position = bounds.start;
    for (const context of contexts) {
      const sourceChunk = source.slice(position, context.openStart);
      const appended = await appendTextChunk(
        page,
        sourceChunk,
        position,
        state,
        metadata,
        flow,
        checkpoint
      );
      if (!appended) return;
      if (context.previewType === "figure") {
        flow.paragraph = null;
        renderFigureBlock(page, context, state, referenceModel);
      } else if (context.previewType === "table") {
        flow.paragraph = null;
        renderTableBlock(page, context, state);
      } else if (context.display) {
        flow.paragraph = null;
        renderEquationBlock(page, context, state);
      } else {
        if (!flow.paragraph) {
          flow.paragraph = document.createElement("p");
          page.appendChild(flow.paragraph);
        }
        appendInlineEquationLeadingSpace(flow.paragraph, sourceChunk);
        renderEquationBlock(flow.paragraph, context, state);
      }
      if (
        context.previewType === "table" ||
        context.previewType === "figure" ||
        context.display
      ) {
        flow.paragraph = null;
      }
      position = context.closeEnd;
      if (!(await checkpoint(true))) return;
    }
    const appended = await appendTextChunk(
      page,
      source.slice(position, bounds.end),
      position,
      state,
      metadata,
      flow,
      checkpoint
    );
    if (!appended || generation !== renderGeneration || !liveEnabled) return;
    if (!page.childNodes.length) {
      const empty = document.createElement("p");
      empty.className = "smarttex-document-empty";
      empty.textContent = "The document body is empty.";
      page.appendChild(empty);
    }
    page.smarttexTextSegments = flow.segments;
    page.smarttexReferenceModel = referenceModel;
    decorateReferenceTargets(page, source, referenceModel);
    decorateReferenceLinks(page, referenceModel);
    if (!zoomControls) zoomControls = createZoomControls();
    zoomStage = document.createElement("div");
    zoomStage.className = "smarttex-document-zoom-stage";
    zoomStage.appendChild(page);
    preview.replaceChildren(zoomControls, zoomStage);
    attachEditingToolbar();
    zoomResizeObserver?.disconnect();
    if (globalThis.ResizeObserver) {
      zoomResizeObserver = new ResizeObserver(() => updateZoomLayout());
      zoomResizeObserver.observe(page);
    }
    applyZoom(zoom);
    lastRenderedSource = source;
    preview.scrollTop = previousScrollTop;
    preview.dataset.lastRenderedAt = String(Date.now());
    refreshPreviewSourceHighlight(state);
    requestAnimationFrame(() => {
      if (generation !== renderGeneration || !liveEnabled) return;
      const caret = preview.querySelector(
        ".smarttex-rendered-caret, .smarttex-table-rendered-caret, .smarttex-document-text-caret"
      );
      if (!caret) return;
      const caretRect = caret.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      if (
        caretRect.top < previewRect.top + 40 ||
        caretRect.bottom > previewRect.bottom - 40
      ) {
        revealPreviewCaret(caret);
      }
      if (
        currentState &&
        (
          currentState.cursorIndex !== state.cursorIndex ||
          currentState.value !== state.value
        )
      ) {
        scheduleFastCursorUpdate(currentState);
      }
    });
  }

  function scheduleRender({ force = false, contentChanged = false } = {}) {
    if (!liveEnabled || !preview || !currentState) return;
    const fingerprint = [
      currentState.fileName || "",
      currentState.cursorIndex,
      currentState.value?.length || 0,
      currentState.value || ""
    ].join("\u0000");
    if (!force && fingerprint === lastSeenFingerprint) return;
    lastSeenFingerprint = fingerprint;
    window.clearTimeout(renderTimer);
    renderGeneration += 1;
    const generation = renderGeneration;
    let delay = 0;
    if (!force) {
      if (contentChanged || pendingContentSince !== null) {
        if (pendingContentSince === null) pendingContentSince = performance.now();
        const untilContinuousRefresh = Math.max(
          0,
          CONTINUOUS_RENDER_INTERVAL_MS - (performance.now() - pendingContentSince)
        );
        delay = Math.min(QUIET_RENDER_DELAY_MS, untilContinuousRefresh);
      } else {
        delay = CURSOR_RENDER_DELAY_MS;
      }
    }
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      if (generation !== renderGeneration || !liveEnabled || !currentState) return;
      pendingContentSince = null;
      activeRenderGeneration = generation;
      setLiveRenderBusy(true);
      preview.classList.add("smarttex-document-rendering");
      preview.setAttribute("aria-busy", "true");
      renderDocument({ ...currentState }, generation).catch((error) => {
        if (generation === renderGeneration) {
          console.error("SmartTeX live document rendering failed:", error);
        }
      }).finally(() => {
        if (activeRenderGeneration !== generation) return;
        activeRenderGeneration = null;
        setLiveRenderBusy(false);
        preview?.classList.remove("smarttex-document-rendering");
        preview?.removeAttribute("aria-busy");
      });
    }, delay);
  }

  window.addEventListener(STATE_EVENT, (event) => {
    const previousValue = currentState?.value;
    const previousFileName = currentState?.fileName;
    try {
      currentState = JSON.parse(String(event.detail || "null"));
    } catch (_error) {
      currentState = null;
      return;
    }
    updateEditingToolbarState();
    if (cursorIsInsideCitationCommand()) {
      hideReferencePopup();
    }
    const contentChanged = (
      previousValue !== undefined &&
      previousValue !== currentState?.value
    );
    const fileChanged = (
      previousFileName !== undefined &&
      previousFileName !== currentState?.fileName
    );
    if (fileChanged) {
      if (fastCursorFrame !== null) {
        cancelAnimationFrame(fastCursorFrame);
        fastCursorFrame = null;
      }
      lastRenderedSource = "";
      lastSeenFingerprint = "";
      pendingContentSince = null;
      scheduleRender({ force: true });
      return;
    }
    const pendingStructuralUpdate = (
      pendingFastStructureSource === currentState?.value
    );
    let fastMode = "none";
    if (contentChanged || pendingStructuralUpdate) {
      fastMode = updatePreviewAfterSourceMutation(previousValue, currentState);
    } else {
      scheduleFastCursorUpdate(currentState);
    }
    if (fastMode === "force") {
      scheduleRender({ force: true, contentChanged: true });
    } else {
      scheduleRender({ contentChanged });
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (
      !settingsMenu?.hidden &&
      !settingsMenu.contains(event.target) &&
      !settingsButton?.contains(event.target)
    ) {
      closeSettingsMenu();
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsMenu?.hidden) {
      closeSettingsMenu();
      settingsButton?.focus({ preventScroll: true });
    }
  }, true);

  window.addEventListener("resize", () => {
    positionSettingsMenu();
    positionActivitySpinner();
  }, { passive: true });

  if (extensionApi?.storage?.local?.get) {
    extensionApi.storage.local.get(FEATURES_KEY).then((stored) => {
      const features = stored?.[FEATURES_KEY];
      figureHoverPreviewsEnabled = features?.figures !== false;
    }).catch(() => {
      figureHoverPreviewsEnabled = true;
    });
    extensionApi.storage.local.get(SETTINGS_KEY).then((stored) => {
      const settings = stored?.[SETTINGS_KEY] || {};
      applyTextScale(settings.textScale);
      applyZoom(settings.zoom);
      setRenderFigures(settings.renderFigures);
    }).catch((error) => {
      console.warn("SmartTeX could not load the live-preview settings:", error);
      applyTextScale(DEFAULT_TEXT_SCALE);
      applyZoom(DEFAULT_ZOOM);
      setRenderFigures(false);
    });
  }

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[FEATURES_KEY]) return;
    const features = changes[FEATURES_KEY].newValue;
    figureHoverPreviewsEnabled = features?.figures !== false;
    if (!figureHoverPreviewsEnabled) hideReferencePopup();
  });

  attachPdfIntegration();
  loadCitationRecords();
  observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === "childList")) {
      attachPdfIntegration();
    } else {
      attachEditingToolbar();
    }
    updateActivitySpinner();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "aria-hidden",
      "aria-busy",
      "aria-label",
      "title",
      "disabled",
      "data-loading"
    ]
  });

  window.addEventListener("pagehide", () => {
    observer?.disconnect();
    zoomResizeObserver?.disconnect();
    window.clearTimeout(renderTimer);
    window.clearTimeout(previewSelectionSyncTimer);
    clearPreviewSourceHighlight();
    if (fastCursorFrame !== null) cancelAnimationFrame(fastCursorFrame);
    settingsMenu?.remove();
    referencePopup?.remove();
    activitySpinner?.remove();
    for (const pending of pendingRequests.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("SmartTeX page closed."));
    }
    pendingRequests.clear();
  }, { once: true });
})();
