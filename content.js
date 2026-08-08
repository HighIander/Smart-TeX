/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  function isSmartTeXDocumentPage() {
    // Do not classify a page from /project/<id> alone: CollabTeX uses project
    // URLs for views that do not contain an editor. Require either an actual
    // editing surface or the editor-specific source/PDF shell/format toolbar.
    const sourcePanel = document.querySelector(
      "#ide-redesign-panel-source-editor, #ide-redesign-panel-editor, " +
      "[data-testid='source-editor'], [data-testid*='source-editor' i]"
    );
    const pdfPanel = document.querySelector(
      "#ide-redesign-panel-pdf, [data-testid='pdf-preview'], [data-testid*='pdf-preview' i]"
    );
    const editorSurface = document.querySelector(
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
    );
    const editorToolbar = document.querySelector(
      ".toolbar.toolbar-editor, .ol-cm-toolbar, [data-testid*='editor-toolbar' i]"
    );
    return Boolean(editorSurface || editorToolbar || (sourcePanel && pdfPanel));
  }

  // Keep page-type detection available to the other isolated-world modules.
  // CollabTeX's project overview also contains toolbar/action elements that
  // resemble the document toolbar, so toolbar controls must be gated explicitly.
  globalThis.SmartTeXPageContext = Object.freeze({
    isDocumentPage: isSmartTeXDocumentPage
  });
  document.documentElement.classList.toggle(
    "smarttex-document-page",
    isSmartTeXDocumentPage()
  );

  // The extension is registered for the whole CollabTeX origin, including the
  // project overview. Do not start editor parsing, observers, popups, or cache
  // work there. Detection is based on the editor DOM/shell, never on the
  // /project/<id> route alone, because that route is also used by overviews.
  if (!isSmartTeXDocumentPage()) return;

  const existingPreview = document.getElementById("smarttex-equation-preview");
  if (globalThis.__smartTeXPreviewLoaded && existingPreview) return;
  if (globalThis.__smartTeXPreviewLoaded && !existingPreview) {
    globalThis.__smartTeXPreviewLoaded = false;
  }
  if (globalThis.__smartTeXPreviewLoading) return;
  globalThis.__smartTeXPreviewLoading = true;

  const initializeWhenDependenciesAreReady = async () => {
    const startedAt = Date.now();
    let repairRequested = false;
    while (!(globalThis.SmartTeXLatexContext && globalThis.SmartTeXTableRenderer && globalThis.katex?.render)) {
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
        throw new Error("SmartTeX: A preview renderer could not be loaded.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (globalThis.__smartTeXPreviewLoaded) return;
    globalThis.__smartTeXPreviewLoaded = true;
    globalThis.__smartTeXPreviewLoading = false;

  const STATE_EVENT = "smarttex:editor-state";
  const REQUEST_EVENT = "smarttex:citation-editor-request";
  const RESPONSE_EVENT = "smarttex:citation-editor-response";
  const REFERENCE_AUTOCOMPLETE_PREVIEW_EVENT = "smarttex:reference-autocomplete-preview";
  const REFERENCE_AUTOCOMPLETE_PREVIEW_HIDE_EVENT = "smarttex:reference-autocomplete-preview-hide";
  const REFERENCE_AUTOCOMPLETE_ACTIVE_EVENT = "smarttex:reference-autocomplete-active";
  const NAVIGATION_PUSH_EVENT = "smarttex:navigation-history-push";
  const CITATION_REFRESH_REQUEST_EVENT = "smarttex:citation-refresh-request";
  const CITATION_REFRESH_RESULT_EVENT = "smarttex:citation-refresh-result";
  const CITATION_CACHE_UPDATED_EVENT = "smarttex:citation-cache-updated";
  const FEATURES_KEY = "smarttex:features:v1";
  const REFERENCE_POPUPS_KEY = "smarttex:reference-popups:v1";
  const STRUCTURE_HIGHLIGHT_KEY = "smarttex:structure-highlight:v1";
  const RUNTIME_SETTINGS_EVENT = "smarttex:runtime-settings";
  const STRUCTURE_ANALYSIS_STATE_EVENT = "smarttex:structure-analysis-state";
  const COMMENTS_INITIALIZATION_STATE_EVENT = "smarttex:comments-initialization-state";
  const REVIEW_HYDRATION_STATE_EVENT = "smarttex:review-hydration-state";
  const SOURCE_RENDER_DELAY_MS = 24;
  const POPUP_SELECTION_HIGHLIGHT = "smarttex-popup-selection";
  const LATEX_FILE = /\.(?:tex|ltx|sty|cls)$/i;
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const contextTools = globalThis.SmartTeXLatexContext;
  const interactionTasks = globalThis.SmartTeXInteractionTasks;
  const popupInteractionReady = () => globalThis.SmartTeXPopupGate?.isReady?.() !== false;
  const tableRenderer = globalThis.SmartTeXTableRenderer;
  const katex = globalThis.katex;
  const katexFontsReady = Promise.resolve(
    globalThis.SmartTeXKatexFonts?.ready
  ).catch(() => ({ loaded: 0, total: 0 }));
  const enabledFeatures = {
    equations: true,
    tables: true,
    figures: true
  };
  let runtimeSettingsOverrideActive = false;

  function taskCheckpoint(iteration = 0, interval = 128, token = undefined) {
    interactionTasks?.checkpoint?.(iteration, interval, token);
  }
  const featureSettingsReady = (
    typeof extensionApi?.storage?.local?.get === "function"
      ? extensionApi.storage.local.get(FEATURES_KEY).then((stored) => {
        const features = stored?.[FEATURES_KEY];
        enabledFeatures.equations = features?.equations !== false;
        enabledFeatures.tables = features?.tables !== false;
        enabledFeatures.figures = features?.figures !== false;
      })
      : Promise.resolve()
  ).catch(() => {});
  let referencePopupTrigger = "cursor";
  let environmentPopupTrigger = "cursor";
  const popupSettingsReady = (
    typeof extensionApi?.storage?.local?.get === "function"
      ? extensionApi.storage.local.get(REFERENCE_POPUPS_KEY).then((stored) => {
        const settings = stored?.[REFERENCE_POPUPS_KEY] || {};
        referencePopupTrigger = settings.trigger === "hover" ? "hover" : "cursor";
        environmentPopupTrigger = settings.environmentTrigger === "hover"
          ? "hover"
          : "cursor";
      })
      : Promise.resolve()
  ).catch(() => {
    referencePopupTrigger = "cursor";
    environmentPopupTrigger = "cursor";
  });

  function dispatchStructureHighlightSettings(value) {
    const validColor = (candidate, fallback) => /^#[0-9a-f]{6}$/i.test(String(candidate || ""))
      ? String(candidate).toLowerCase()
      : fallback;
    const settings = value || {};
    window.dispatchEvent(new CustomEvent("smarttex:structure-highlight-settings", {
      detail: {
        environmentEnabled: settings.environmentEnabled !== undefined
          ? settings.environmentEnabled !== false
          : settings.enabled !== false,
        environmentColor: validColor(settings.environmentColor || settings.color, "#dfedfb"),
        environmentFirstLineEnabled: settings.environmentFirstLineEnabled !== undefined
          ? settings.environmentFirstLineEnabled !== false
          : (settings.environmentEnabled !== undefined ? settings.environmentEnabled !== false : settings.enabled !== false),
        environmentFirstLineColor: validColor(
          settings.environmentFirstLineColor,
          settings.color !== undefined
            ? validColor(settings.environmentColor || settings.color, "#c7e4ff")
            : "#c7e4ff"
        ),
        sectionEnabled: settings.sectionEnabled !== undefined
          ? settings.sectionEnabled !== false
          : (settings.environmentEnabled !== undefined ? settings.environmentEnabled !== false : settings.enabled !== false),
        sectionColor: validColor(
          settings.sectionColor,
          settings.color !== undefined
            ? validColor(settings.environmentColor || settings.color, "#c4a7ff")
            : "#c4a7ff"
        ),
        captionEnabled: settings.captionEnabled === true,
        captionColor: validColor(settings.captionColor, "#70afea"),
        labelEnabled: settings.labelEnabled === true,
        labelColor: validColor(settings.labelColor, "#8fd19e"),
        referenceEnabled: settings.referenceEnabled !== false,
        referenceColor: validColor(settings.referenceColor, "#bcf0c8"),
        nonumberEnabled: settings.nonumberEnabled === true,
        nonumberColor: validColor(settings.nonumberColor, "#ffe69a"),
        inlineMathEnabled: settings.inlineMathEnabled !== false,
        inlineMathColor: validColor(settings.inlineMathColor, "#cce5ff"),
        activeEnabled: settings.activeEnabled !== false,
        activeStrength: Math.max(
          0,
          Math.min(100, Number.isFinite(Number(settings.activeStrength)) ? Number(settings.activeStrength) : 55)
        )
      }
    }));
  }

  const structureHighlightSettingsReady = (
    typeof extensionApi?.storage?.local?.get === "function"
      ? extensionApi.storage.local.get(STRUCTURE_HIGHLIGHT_KEY).then((stored) => {
        dispatchStructureHighlightSettings(stored?.[STRUCTURE_HIGHLIGHT_KEY]);
      })
      : Promise.resolve(dispatchStructureHighlightSettings(null))
  ).catch(() => dispatchStructureHighlightSettings(null));


  const graphicAutocompletePreview = document.createElement("aside");
  graphicAutocompletePreview.id = "smarttex-graphic-autocomplete-preview";
  graphicAutocompletePreview.hidden = true;
  graphicAutocompletePreview.setAttribute("role", "tooltip");
  graphicAutocompletePreview.setAttribute("aria-label", "Selected figure preview");
  graphicAutocompletePreview.innerHTML = `
    <div class="smarttex-preview-heading">
      <span class="smarttex-preview-title">Figure file preview</span>
      <span class="smarttex-preview-meta"></span>
      <span class="smarttex-inline-loading-spinner smarttex-graphic-preview-spinner" hidden aria-hidden="true"></span>
    </div>
    <div class="smarttex-graphic-autocomplete-output"></div>`;
  document.documentElement.appendChild(graphicAutocompletePreview);
  const graphicAutocompleteOutput = graphicAutocompletePreview.querySelector(
    ".smarttex-graphic-autocomplete-output"
  );
  const graphicAutocompleteMeta = graphicAutocompletePreview.querySelector(
    ".smarttex-preview-meta"
  );
  const graphicAutocompleteSpinner = graphicAutocompletePreview.querySelector(
    ".smarttex-graphic-preview-spinner"
  );

  const preview = document.createElement("aside");
  preview.id = "smarttex-equation-preview";
  preview.hidden = true;
  preview.setAttribute("role", "tooltip");
  preview.setAttribute("aria-label", "Live LaTeX preview");
  preview.innerHTML = `
    <div class="smarttex-preview-heading">
      <span class="smarttex-preview-title">Equation preview</span>
      <span class="smarttex-preview-heading-actions">
        <span class="smarttex-inline-loading-spinner smarttex-preview-loading-indicator" hidden aria-hidden="true"></span>
        <span class="smarttex-preview-meta" hidden></span>
        <button class="smarttex-preview-close" type="button" title="Close preview (Esc)" aria-label="Close preview">&times;</button>
      </span>
    </div>
    <div class="smarttex-equation-output"></div>
    <div class="smarttex-preview-status" hidden></div>
  `;
  document.documentElement.appendChild(preview);

  const output = preview.querySelector(".smarttex-equation-output");
  const status = preview.querySelector(".smarttex-preview-status");
  const previewTitle = preview.querySelector(".smarttex-preview-title");
  const previewMeta = preview.querySelector(".smarttex-preview-meta");
  const previewLoadingIndicator = preview.querySelector(".smarttex-preview-loading-indicator");
  const closeButton = preview.querySelector(".smarttex-preview-close");
  const optionsButton = document.createElement("button");
  optionsButton.id = "smarttex-options-button";
  optionsButton.type = "button";
  optionsButton.innerHTML = `
    <span class="smarttex-options-mark" aria-hidden="true">S</span>
    <span class="smarttex-options-menu-icon" aria-hidden="true">
      <span></span><span></span><span></span>
    </span>
    <span class="smarttex-toolbar-loading-spinner" aria-hidden="true"></span>`;
  const STRUCTURE_SPINNER_MIN_VISIBLE_MS = 140;
  let structureAnalysisActive =
    document.documentElement.dataset.smarttexStructureAnalysis !== "ready";
  // comments.js is loaded after content.js. Keep the global loading indicator
  // active until its initial collaborative metadata hydration has completed,
  // so the S button accurately covers the period in which comment/mark overlays
  // are still absent after a page reload.
  let commentsInitializationActive =
    globalThis.__smartTeXCommentsInitializationActive !== false;
  // review.js is injected after content.js. Treat its initial hydration as
  // pending until it explicitly reports completion so a pre-review structure
  // paint cannot hide the S-button spinner too early.
  let reviewHydrationActive =
    globalThis.__smartTeXReviewHydrationActive !== false;
  let structureSpinnerShownAt = (structureAnalysisActive || commentsInitializationActive || reviewHydrationActive) ? performance.now() : 0;
  let structureSpinnerHideTimer = 0;
  let commentsInitializationFailSafe = window.setTimeout(() => {
    commentsInitializationActive = false;
    updateToolbarLoadingSpinner();
  }, 15000);
  let reviewHydrationFailSafe = window.setTimeout(() => {
    reviewHydrationActive = false;
    updateToolbarLoadingSpinner();
  }, 15000);

  function updateToolbarLoadingSpinner() {
    const next = Boolean(structureAnalysisActive || commentsInitializationActive || reviewHydrationActive);
    window.clearTimeout(structureSpinnerHideTimer);
    structureSpinnerHideTimer = 0;
    if (next) {
      if (!structureSpinnerShownAt) structureSpinnerShownAt = performance.now();
      optionsButton.classList.add("smarttex-initializing");
      return;
    }
    const elapsed = structureSpinnerShownAt ? performance.now() - structureSpinnerShownAt : STRUCTURE_SPINNER_MIN_VISIBLE_MS;
    const hide = () => {
      structureSpinnerShownAt = 0;
      optionsButton.classList.remove("smarttex-initializing");
    };
    const remaining = Math.max(0, STRUCTURE_SPINNER_MIN_VISIBLE_MS - elapsed);
    if (remaining > 0) structureSpinnerHideTimer = window.setTimeout(hide, remaining);
    else hide();
  }

  function setStructureSpinnerActive(active) {
    structureAnalysisActive = Boolean(active);
    updateToolbarLoadingSpinner();
  }

  optionsButton.title = "Open SmartTeX options";
  optionsButton.setAttribute("aria-label", "Open SmartTeX options");
  let optionsButtonSlot = null;

  function attachOptionsButton() {
    const documentPage = isSmartTeXDocumentPage();
    document.documentElement.classList.toggle("smarttex-document-page", documentPage);
    if (!documentPage) {
      optionsButtonSlot?.remove();
      optionsButton.remove();
      return;
    }

    const shareButton = [...document.querySelectorAll("button, a")].find((candidate) => {
      const style = globalThis.getComputedStyle?.(candidate);
      if (
        candidate.getClientRects().length === 0 ||
        style?.display === "none" ||
        style?.visibility === "hidden"
      ) {
        return false;
      }
      const label = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
        candidate.textContent
      ].filter(Boolean).join(" ").trim();
      return /(^|\s)(share|teilen)(\s|$)/i.test(label);
    }) || null;
    const fallbackActions = document.querySelector(
      ".ide-redesign-toolbar-actions, " +
      ".toolbar-header .toolbar-right, " +
      ".project-actions, " +
      "[class*='project'][class*='actions']"
    );
    const actions = shareButton?.closest(
      ".ide-redesign-toolbar-actions, " +
      ".toolbar-header .toolbar-right, " +
      ".project-actions, " +
      "[class*='project'][class*='actions']"
    ) || shareButton?.parentElement || fallbackActions;
    if (!actions) {
      if (!optionsButton.isConnected) document.documentElement.appendChild(optionsButton);
      return;
    }
    if (!optionsButtonSlot || !optionsButtonSlot.isConnected) {
      optionsButtonSlot = document.createElement("div");
      optionsButtonSlot.id = "smarttex-toolbar-slot";
      optionsButtonSlot.className = "ide-redesign-toolbar-button-container";
    }
    optionsButton.className = "d-inline-grid btn btn-sm smarttex-toolbar-button";
    optionsButton.classList.toggle(
      "smarttex-initializing",
      structureAnalysisActive || commentsInitializationActive || reviewHydrationActive
    );
    if (optionsButton.parentElement !== optionsButtonSlot) {
      optionsButtonSlot.insertBefore(optionsButton, optionsButtonSlot.firstChild);
    } else if (optionsButtonSlot.firstElementChild !== optionsButton) {
      optionsButtonSlot.insertBefore(optionsButton, optionsButtonSlot.firstChild);
    }

    // The Nextcloud module may have attached its action before this toolbar
    // slot was reconstructed. Preserve one deterministic order: SmartTeX menu
    // first, Nextcloud immediately to its right.
    const nextcloudButton = optionsButtonSlot.querySelector(
      ".smarttex-nextcloud-update-all"
    );
    if (
      nextcloudButton &&
      optionsButton.nextElementSibling !== nextcloudButton
    ) {
      optionsButtonSlot.insertBefore(nextcloudButton, optionsButton.nextSibling);
    }
    if (shareButton) {
      let shareContainer = shareButton;
      while (
        shareContainer.parentElement &&
        shareContainer.parentElement !== actions
      ) {
        shareContainer = shareContainer.parentElement;
      }
      let insertionAnchor = shareContainer;
      while (
        insertionAnchor.previousElementSibling?.matches(
          "#ctca-project-cloud-slot, .ctca-project-cloud-slot"
        )
      ) {
        insertionAnchor = insertionAnchor.previousElementSibling;
      }
      if (
        optionsButtonSlot.parentElement !== actions ||
        optionsButtonSlot.nextSibling !== insertionAnchor
      ) {
        actions.insertBefore(optionsButtonSlot, insertionAnchor);
      }
    } else if (optionsButtonSlot.parentElement !== actions) {
      actions.insertBefore(optionsButtonSlot, actions.firstChild);
    }
  }
  let currentState = null;
  let hoverPreviewState = null;
  let activePreviewState = null;
  let environmentHoverTimer = null;
  let environmentHoverGeneration = 0;
  let renderTimer = null;
  let renderGeneration = 0;
  let activeContextId = "";
  const dismissedPreviewContexts = new Map();
  let caretPlacementState = null;
  let lastSuccessfulMarkup = "";
  let previewPositioned = false;
  let activePreviewContext = null;
  let documentAnalysisCache = {
    fileName: "",
    source: null,
    equations: null,
    equationRenderData: new Map()
  };
  let previewPositionGeneration = 0;
  let lastPointerScreen = null;
  let verticalScrollRepositionPending = false;
  let previewPointerInside = false;
  let previewInteractionUntil = 0;
  let requestCounter = 0;
  let captionReferencePopup = null;
  let captionReferencePopupTimer = null;
  let captionReferencePopupAnchor = null;
  let captionReferencePopupAnchorRect = null;
  let autocompleteReferenceAnchorRect = null;
  let autocompleteReferenceOwnerRect = null;
  let autocompleteReferenceCommandStart = null;
  let autocompleteReferenceTargetKey = "";
  const nestedCaptionReferencePopupStates = [];
  let editorReferenceHoverTimer = null;
  let editorReferenceHoverGeneration = 0;
  let referenceAutocompleteActive = false;
  let graphicAutocompleteActive = false;
  let graphicAutocompletePath = "";
  let graphicAutocompleteGeneration = 0;
  let graphicAutocompleteUpdateFrame = null;
  let graphicAutocompleteHoveredOwner = null;
  let graphicAutocompleteHoveredEntry = null;
  let activeEditorReferenceKey = "";
  let activeEditorReferenceType = "";
  let activeSecondaryEditorReferenceKey = "";
  let captionInnerReferenceActive = false;
  let popupLoadingSpinner = null;
  let popupLoadingSpinnerGeneration = 0;
  let previewLoadingGeneration = 0;
  let previewLoadingGlobalGeneration = null;
  let referencePopupInteractionUntil = 0;
  let referencePopupPointerDown = false;
  let citationRecords = new Map();
  let citationRecordsPromise = null;
  let citationRecordsLoaded = false;
  let citationRefreshCounter = 0;
  const pendingCitationRefreshes = new Map();
  const pendingRequests = new Map();
  let popupsSuppressedAfterEditorScroll = false;

  interactionTasks?.subscribe?.(() => {
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    renderTimer = null;
    renderGeneration += 1;
    if (environmentHoverTimer !== null) window.clearTimeout(environmentHoverTimer);
    environmentHoverTimer = null;
    environmentHoverGeneration += 1;
    if (editorReferenceHoverTimer !== null) window.clearTimeout(editorReferenceHoverTimer);
    editorReferenceHoverTimer = null;
    editorReferenceHoverGeneration += 1;
    if (captionReferencePopupTimer !== null) window.clearTimeout(captionReferencePopupTimer);
    captionReferencePopupTimer = null;
    if (graphicAutocompleteUpdateFrame !== null) {
      window.cancelAnimationFrame(graphicAutocompleteUpdateFrame);
      graphicAutocompleteUpdateFrame = null;
    }
    graphicAutocompleteGeneration += 1;
    previewPositionGeneration += 1;
  });

  preview.addEventListener("pointerenter", () => {
    previewPointerInside = true;
    previewInteractionUntil = Date.now() + 900;
  });
  preview.addEventListener("pointermove", () => {
    previewPointerInside = true;
    previewInteractionUntil = Date.now() + 900;
  }, { passive: true });
  preview.addEventListener("pointerleave", () => {
    previewPointerInside = false;
    // Keep a short bridge interval while the pointer crosses the gap to a
    // nested reference popup opened from a figure or table caption.
    previewInteractionUntil = Date.now() + 650;
  });
  preview.addEventListener("focusin", () => {
    previewInteractionUntil = Date.now() + 900;
  });

  function referencePopupUsesHover() {
    return referencePopupTrigger !== "cursor";
  }

  function environmentPopupUsesHover() {
    return environmentPopupTrigger === "hover";
  }

  function announceNavigationOrigin(destinationIndex = null) {
    if (!currentState) return;
    const cursorIndex = Math.max(0, Number(currentState.cursorIndex) || 0);
    if (Number.isFinite(Number(destinationIndex)) && cursorIndex === Number(destinationIndex)) {
      return;
    }
    const anchor = Math.max(
      0,
      Number(currentState.selectionAnchor ?? currentState.selectionFrom ?? cursorIndex) || 0
    );
    const head = Math.max(
      0,
      Number(currentState.selectionHead ?? currentState.selectionTo ?? cursorIndex) || 0
    );
    window.dispatchEvent(new CustomEvent(NAVIGATION_PUSH_EVENT, {
      detail: JSON.stringify({
        fileName: String(currentState.fileName || ""),
        cursorIndex,
        anchor,
        head
      })
    }));
  }

  function previewStateForRender() {
    return environmentPopupUsesHover() && hoverPreviewState
      ? hoverPreviewState
      : currentState;
  }


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

  function popupSpinnerButtonPosition() {
    const rect = optionsButton?.getBoundingClientRect?.();
    if (
      rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    ) {
      return {
        left: rect.left + rect.width / 2 - 9,
        top: rect.top + rect.height / 2 - 9
      };
    }
    return { left: Math.max(8, window.innerWidth - 42), top: 17 };
  }

  function showPopupLoadingSpinner(_event, _anchor = null) {
    if (!popupInteractionReady()) return null;
    const spinner = ensurePopupLoadingSpinner();
    const position = popupSpinnerButtonPosition();
    const generation = ++popupLoadingSpinnerGeneration;
    spinner.style.left = `${Math.round(position.left)}px`;
    spinner.style.top = `${Math.round(position.top)}px`;
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

  function showPreviewLoading() {
    const generation = ++previewLoadingGeneration;
    preview.setAttribute("aria-busy", "true");
    if (!preview.hidden) {
      previewLoadingIndicator.hidden = false;
      previewLoadingGlobalGeneration = null;
    } else {
      previewLoadingIndicator.hidden = true;
      previewLoadingGlobalGeneration = showPopupLoadingSpinner(
        null,
        editorCursorAnchorRect(currentState)
      );
    }
    return generation;
  }

  function hidePreviewLoading(generation = null) {
    if (generation !== null && generation !== previewLoadingGeneration) return;
    previewLoadingGeneration += 1;
    preview.removeAttribute("aria-busy");
    previewLoadingIndicator.hidden = true;
    if (previewLoadingGlobalGeneration !== null) {
      hidePopupLoadingSpinner(previewLoadingGlobalGeneration);
      previewLoadingGlobalGeneration = null;
    }
  }

  function contextRangeContainsState(range, state) {
    if (!range || !state) return false;
    if (String(state.fileName || "") !== String(range.fileName || "")) return false;
    const index = Number(state.cursorIndex);
    if (!Number.isInteger(index)) return false;
    return index >= Number(range.openStart) && index <= Number(range.closeEnd);
  }

  function pruneDismissedPreviewContexts(state = previewStateForRender()) {
    for (const [contextId, range] of dismissedPreviewContexts) {
      if (!contextRangeContainsState(range, state)) {
        dismissedPreviewContexts.delete(contextId);
      }
    }
  }

  function previewContextIsDismissed(state, context) {
    if (!state || !context) return false;
    pruneDismissedPreviewContexts(state);
    return dismissedPreviewContexts.has(previewContextId(state, context));
  }


  function hidePreview({ clearDismissal = true } = {}) {
    hidePreviewLoading();
    if (renderTimer !== null) {
      window.clearTimeout(renderTimer);
      renderTimer = null;
    }
    renderGeneration += 1;
    preview.hidden = true;
    preview.classList.remove("smarttex-preview-visible", "smarttex-preview-stale");
    activeContextId = "";
    caretPlacementState = null;
    lastSuccessfulMarkup = "";
    previewPositioned = false;
    activePreviewContext = null;
    activePreviewState = null;
    previewPositionGeneration += 1;
    verticalScrollRepositionPending = false;
    clearPopupSelectionHighlight();
    // Environment previews and editor reference popups have independent
    // lifecycles. Only close a reference popup when its anchor belongs to the
    // environment preview that is being hidden; otherwise a pending editor
    // hover lookup would be cancelled before it can open.
    if (
      !activeEditorReferenceKey &&
      !referenceAutocompleteActive &&
      popupChainOriginatesInPreview()
    ) {
      hideCaptionReferencePopup();
    }
    status.hidden = true;
    if (clearDismissal) pruneDismissedPreviewContexts(previewStateForRender());
  }

  function dismissPreview() {
    if (preview.hidden) return;
    if (activeContextId && activePreviewContext && activePreviewState) {
      const range = contextEnvironmentRange(activePreviewContext);
      dismissedPreviewContexts.set(activeContextId, {
        fileName: String(activePreviewState.fileName || ""),
        openStart: range.openStart,
        closeEnd: range.closeEnd,
        hover: activePreviewState.smarttexHoverPreview === true
      });
    }
    hidePreview({ clearDismissal: false });
  }

  function stateCanShowPreview(state) {
    if (!popupInteractionReady() || graphicAutocompleteActive) return false;
    const popupInteraction = (
      previewPointerInside ||
      Date.now() < previewInteractionUntil ||
      elementIsHovered(preview) ||
      preview.contains(document.activeElement) ||
      popupChainOriginatesInPreview() ||
      popupChainIsHovered()
    );
    if (
      !state ||
      (!state.focused && !popupInteraction) ||
      !Number.isInteger(state.cursorIndex) ||
      !state.screen
    ) {
      return false;
    }
    const fileName = String(state.fileName || "").trim();
    return !fileName || LATEX_FILE.test(fileName);
  }

  function contextEnvironmentRange(context) {
    const openStart = Number.isFinite(Number(context?.floatOpenStart))
      ? Number(context.floatOpenStart)
      : Number(context?.openStart) || 0;
    const closeEnd = Number.isFinite(Number(context?.floatCloseEnd))
      ? Number(context.floatCloseEnd)
      : Number(context?.closeEnd) || openStart;
    return {
      openStart: Math.max(0, openStart),
      closeEnd: Math.max(Math.max(0, openStart), closeEnd)
    };
  }

  function previewContextId(state, context) {
    const range = contextEnvironmentRange(context);
    return [
      state.fileName || "",
      range.openStart,
      context.kind,
      context.environment || context.delimiter || ""
    ].join(":");
  }

  function documentAnalysisForState(state) {
    const source = String(state?.value || "");
    const fileName = String(state?.fileName || "");
    if (
      documentAnalysisCache.source !== source ||
      documentAnalysisCache.fileName !== fileName
    ) {
      documentAnalysisCache = {
        fileName,
        source,
        equations: null,
        equationRenderData: new Map()
      };
    }
    return documentAnalysisCache;
  }

  function activeEquationContextForState(state) {
    const context = activePreviewContext;
    const previousState = activePreviewState;
    if (
      !state ||
      !context ||
      !previousState ||
      context.kind === "table" ||
      context.kind === "figure" ||
      String(previousState.fileName || "") !== String(state.fileName || "") ||
      String(previousState.value || "") !== String(state.value || "")
    ) {
      return null;
    }
    const cursor = Number(state.cursorIndex);
    const contentStart = Number(context.contentStart);
    const contentEnd = Number(context.contentEnd);
    if (
      !Number.isInteger(cursor) ||
      !Number.isFinite(contentStart) ||
      !Number.isFinite(contentEnd) ||
      cursor < contentStart ||
      cursor > contentEnd
    ) {
      return null;
    }
    return {
      ...context,
      cursorOffset: cursor - contentStart
    };
  }

  function cachedEquationContextForState(state) {
    if (!state || !enabledFeatures.equations) return null;
    const cache = documentAnalysisForState(state);
    if (!cache.equations) {
      cache.equations = typeof contextTools.analyzeEquations === "function"
        ? contextTools.analyzeEquations(cache.source)
        : contextTools.equationContexts(cache.source);
    }
    if (typeof contextTools.findEquationContextFromAnalysis === "function") {
      return contextTools.findEquationContextFromAnalysis(
        cache.source,
        state.cursorIndex,
        cache.equations
      );
    }
    return contextTools.findEquationContext(cache.source, state.cursorIndex);
  }

  function equationRenderDataForState(state, context) {
    const cache = documentAnalysisForState(state);
    const key = Number(context?.openStart);
    if (cache.equationRenderData.has(key)) {
      return cache.equationRenderData.get(key);
    }
    if (!cache.equations) {
      cache.equations = typeof contextTools.analyzeEquations === "function"
        ? contextTools.analyzeEquations(cache.source)
        : contextTools.equationContexts(cache.source);
    }
    const numbering = cache.equations?.numberingByOpenStart?.get?.(key) ||
      contextTools.equationPreviewNumbering(cache.source, context);
    const commandContext = typeof contextTools.prepareDocumentCommandContext === "function"
      ? contextTools.prepareDocumentCommandContext(cache.source, context.openStart)
      : null;
    const data = { numbering, commandContext };
    cache.equationRenderData.set(key, data);
    return data;
  }

  function captionContainerAtIndex(state, indexValue = state?.cursorIndex) {
    if (!state) return null;
    const source = String(state.value || "");
    const index = Math.max(0, Math.min(Number(indexValue) || 0, source.length));
    const candidates = [];

    if (enabledFeatures.figures) {
      const figure = contextTools.findFigureContext?.(source, index);
      if (figure) candidates.push({ context: figure, kind: "figure" });
    }
    if (enabledFeatures.tables) {
      const table = (
        contextTools.findTableFloatContext?.(source, index) ||
        contextTools.findTableContext?.(source, index)
      );
      if (table) candidates.push({ context: table, kind: "table" });
    }

    return candidates
      .map((candidate) => ({
        ...candidate,
        caption: contextTools.floatCaption?.(
          source,
          candidate.context,
          candidate.kind
        ) || null
      }))
      .filter((candidate) => (
        candidate.caption &&
        index >= candidate.caption.start &&
        index <= candidate.caption.end
      ))
      .sort((left, right) => (
        (left.context.closeEnd - left.context.openStart) -
        (right.context.closeEnd - right.context.openStart)
      ))[0] || null;
  }

  function captionReferenceSuppressesEnvironmentPreview(state) {
    if (!captionContainerAtIndex(state)) return false;
    if (referenceAutocompleteActive || captionInnerReferenceActive) return true;
    const interaction = editorReferenceInteractionAtIndex(
      state.value,
      state.cursorIndex
    );
    if (!interaction) return false;
    return state.smarttexHoverPreview === true
      ? referencePopupUsesHover()
      : !referencePopupUsesHover();
  }

  function findPreviewContext(state) {
    if (!state) return null;
    const equation = enabledFeatures.equations
      ? (activeEquationContextForState(state) || cachedEquationContextForState(state))
      : null;

    // Equation cursor motion is the latency-critical path. Return immediately
    // instead of scanning tables and figures that cannot be the more specific
    // context while the cursor is already inside an equation.
    if (equation) return equation;

    // A reference popup or autocomplete list inside a caption is the inner
    // interaction. Hide the enclosing figure/table preview until the cursor or
    // hover position leaves that reference.
    if (captionReferenceSuppressesEnvironmentPreview(state)) return null;

    return [
      enabledFeatures.tables
        ? (
          contextTools.findTableContext(state.value, state.cursorIndex) ||
          contextTools.findTableFloatContext?.(state.value, state.cursorIndex)
        )
        : null,
      enabledFeatures.figures
        ? contextTools.findFigureContext(state.value, state.cursorIndex)
        : null
    ]
      .filter(Boolean)
      .sort((left, right) => (
        (left.closeEnd - left.openStart) - (right.closeEnd - right.openStart)
      ))[0] || null;
  }

  function bridgeRequest(type, payload = {}, timeoutMs = 5000) {
    const requestId = `figure-preview-${Date.now()}-${++requestCounter}`;
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

  function figurePathStem(value) {
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/\.[a-z0-9]{1,8}$/i, "")
      .toLowerCase();
  }

  function directFigureFile(pathValue) {
    const path = String(pathValue || "").trim();
    const targetName = path.replace(/\\/g, "/").split("/").pop();
    const item = [...document.querySelectorAll('.file-tree-list [role="treeitem"]')]
      .find((candidate) => {
        const candidatePath = String(
          candidate.getAttribute("data-path") ||
          candidate.getAttribute("data-file-path") ||
          candidate.getAttribute("aria-label") ||
          candidate.querySelector(
            ".item-name-button span, .item-name span, .entity-name span"
          )?.textContent ||
          ""
        ).trim();
        const candidateName = candidatePath.replace(/\\/g, "/").split("/").pop();
        return (
          figurePathStem(candidatePath) === figurePathStem(path) ||
          figurePathStem(candidateName) === figurePathStem(targetName)
        );
      });
    if (!item) return null;
    const resolvedPath = String(
      item.getAttribute("data-path") ||
      item.getAttribute("data-file-path") ||
      item.getAttribute("aria-label") ||
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
        path: resolvedPath,
        url: new URL(explicit, window.location.href).href
      };
    }
    const fileId = (
      item.getAttribute("data-file-id") ||
      item.getAttribute("data-entity-id") ||
      item.getAttribute("data-id") ||
      ""
    ).trim();
    const projectId = window.location.pathname.match(/\/project\/([^/?#]+)/i)?.[1] || "";
    return fileId && projectId ? {
      path: resolvedPath,
      url: `${window.location.origin}/project/${encodeURIComponent(projectId)}/file/${encodeURIComponent(fileId)}`
    } : null;
  }

  function figurePopupPlaceholder(path, resolving = false) {
    const placeholder = document.createElement("div");
    placeholder.className = "smarttex-figure-popup-placeholder";
    if (resolving) placeholder.classList.add("smarttex-figure-popup-resolving");
    placeholder.textContent = resolving ? `Locating ${path}…` : path;
    return placeholder;
  }

  async function replaceFigurePopupMedia(placeholder, path, url) {
    const renderer = globalThis.SmartTeXFigureRenderer;
    if (!renderer?.createMedia) throw new Error("The figure renderer is unavailable.");
    const media = await renderer.createMedia(path, url, {
      imageClass: "smarttex-figure-popup-image",
      pdfClass: "smarttex-figure-popup-image smarttex-figure-popup-pdf"
    });
    if (!placeholder.parentNode) return;
    for (const attribute of [
      "data-smarttex-local-width-ratio",
      "data-smarttex-fixed-width-px",
      "data-smarttex-image-scale"
    ]) {
      if (placeholder.hasAttribute(attribute)) {
        media.setAttribute(attribute, placeholder.getAttribute(attribute));
      }
    }
    const layout = placeholder.closest(".smarttex-figure-layout");
    placeholder.replaceWith(media);
    renderer.observePopupLayout?.(layout);
    window.requestAnimationFrame(() => {
      positionPreview();
      repositionReferencePopups();
    });
  }

  function resolveFigurePopupFile(path, placeholder) {
    const direct = directFigureFile(path);
    if (direct?.url) {
      replaceFigurePopupMedia(placeholder, direct.path || path, direct.url).catch(() => {
        if (!placeholder.parentNode) return;
        placeholder.replaceWith(figurePopupPlaceholder(path));
      });
      return;
    }
    bridgeRequest("resolveProjectFile", { path }).then((response) => {
      if (!placeholder.parentNode) return;
      const file = response?.file;
      if (!file?.url) throw new Error("Figure URL is unavailable.");
      return replaceFigurePopupMedia(placeholder, file.path || path, file.url);
    }).catch(() => {
      if (!placeholder.parentNode) return;
      placeholder.classList.remove("smarttex-figure-popup-resolving");
      placeholder.textContent = path;
      placeholder.title = "The figure file could not be resolved from the CollabTeX project.";
    });
  }


  function includeGraphicsArgumentAtCursor(state) {
    if (!state || !Number.isInteger(state.cursorIndex)) return null;
    const source = String(state.value || "");
    const cursor = Math.max(0, Math.min(state.cursorIndex, source.length));

    // Autocomplete detection runs on editor-state updates. Restrict the regex
    // to the current logical line instead of scanning the complete document
    // prefix after every keystroke. An includegraphics argument cannot legally
    // cross an unescaped line break in this completion context.
    const scanStart = Math.max(
      0,
      source.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1,
      cursor - 2048
    );
    const masked = contextTools.maskIgnoredLatex(source);
    const before = masked.slice(scanStart, cursor);
    const command = before.match(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]*)$/i);
    if (!command) return null;
    const argumentStart = cursor - String(command[1] || "").length;
    const closingBrace = source.indexOf("}", cursor);
    if (closingBrace >= 0 && /[\r\n]/.test(source.slice(cursor, closingBrace))) return null;
    return {
      fragment: String(command[1] || ""),
      start: argumentStart,
      end: closingBrace >= 0 ? closingBrace : cursor
    };
  }

  function visibleNativeGraphicAutocomplete() {
    const candidates = [
      ...document.querySelectorAll(
        ".ace_autocomplete, .ace_autocomplete_popup, [role='listbox']"
      )
    ];
    return candidates.find((candidate) => {
      if (candidate.id === "smarttex-reference-autocomplete-popup" ||
          candidate.id === "smarttex-citation-autocomplete-popup") return false;
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 && rect.width > 40 && rect.height > 20 &&
        Boolean(candidate.querySelector(
          ".ace_selected, [aria-selected='true'], .selected, [class*='selected']"
        ));
    }) || null;
  }

  function nativeGraphicAutocompleteOwnerFromNode(node) {
    const owner = node?.closest?.(
      ".ace_autocomplete, .ace_autocomplete_popup, [role='listbox']"
    ) || null;
    if (!owner || owner.id === "smarttex-reference-autocomplete-popup" ||
        owner.id === "smarttex-citation-autocomplete-popup") return null;
    const style = getComputedStyle(owner);
    const rect = owner.getBoundingClientRect();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0 ||
      rect.width <= 40 ||
      rect.height <= 20
    ) return null;
    return owner;
  }

  function hoveredNativeGraphicEntry(node, owner) {
    if (!owner || !node) return null;
    const entry = node.closest?.(
      ".ace_line, [role='option'], .autocomplete-entry, " +
      "[class*='completion'][class*='item'], [class*='option']"
    ) || null;
    return entry && entry !== owner && owner.contains(entry) ? entry : null;
  }

  function selectedNativeGraphicEntry(owner) {
    if (!owner) return null;
    return owner.querySelector(
      ".ace_line.ace_selected, .ace_selected, [role='option'][aria-selected='true'], " +
      ".selected[role='option'], [class*='option'][class*='selected']"
    );
  }

  function graphicPathFromSuggestion(entry) {
    const explicitPath = String(entry?.dataset?.smarttexFigurePath || "").trim();
    if (explicitPath) return explicitPath;
    const text = String(entry?.textContent || "").replace(/\u00a0/g, " ").trim();
    if (!text) return "";
    const command = text.match(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/i);
    if (command) return String(command[1] || "").trim();
    const path = text.match(/(?:^|\s)((?:[^\s{}]+\/)*[^\s{}]+?\.(?:png|jpe?g|gif|svg|pdf|eps|webp))(?:\s|$)/i);
    if (path) return String(path[1] || "").trim();
    return "";
  }

  function positionGraphicAutocompletePreview(owner) {
    if (!owner || graphicAutocompletePreview.hidden) return;
    const ownerRect = owner.getBoundingClientRect();
    const popupRect = graphicAutocompletePreview.getBoundingClientRect();
    const margin = 10;
    const gap = 10;
    const rightSpace = window.innerWidth - ownerRect.right - gap - margin;
    const leftSpace = ownerRect.left - gap - margin;
    let left;
    if (rightSpace >= Math.min(popupRect.width, 260) || rightSpace >= leftSpace) {
      left = Math.min(window.innerWidth - popupRect.width - margin, ownerRect.right + gap);
    } else {
      left = Math.max(margin, ownerRect.left - popupRect.width - gap);
    }
    const top = Math.max(
      margin,
      Math.min(ownerRect.top, window.innerHeight - popupRect.height - margin)
    );
    graphicAutocompletePreview.style.left = `${Math.round(left)}px`;
    graphicAutocompletePreview.style.top = `${Math.round(top)}px`;
  }

  function hideGraphicAutocompletePreview() {
    graphicAutocompleteGeneration += 1;
    graphicAutocompleteActive = false;
    graphicAutocompletePath = "";
    graphicAutocompleteSpinner.hidden = true;
    graphicAutocompletePreview.removeAttribute("aria-busy");
    graphicAutocompletePreview.hidden = true;
    graphicAutocompletePreview.classList.remove("smarttex-preview-visible");
    graphicAutocompleteOutput.replaceChildren();
  }

  function graphicAutocompleteMediaAspect(media) {
    if (!media) return null;
    const width = Number(media.naturalWidth) ||
      Number(media.dataset?.smarttexPdfPreviewWidth) ||
      Number(media.width) || 0;
    const height = Number(media.naturalHeight) ||
      Number(media.dataset?.smarttexPdfPreviewHeight) ||
      Number(media.height) || 0;
    if (!(width > 0 && height > 0)) return null;
    const aspect = width / height;
    return Number.isFinite(aspect) && aspect > 0 ? aspect : null;
  }

  function fitGraphicAutocompletePreviewToMedia(media) {
    const aspect = graphicAutocompleteMediaAspect(media);
    if (!aspect || !graphicAutocompletePreview || !graphicAutocompleteOutput) return;

    // Size the preview's media box to the actual figure aspect ratio instead
    // of keeping a fixed, nearly-square preview area.  The heading remains
    // outside this box, while the figure itself receives no unused letterbox
    // space except for the normal 12 px preview padding.
    const viewportMargin = 12;
    const outputPadding = 24;
    const maxPopupWidth = Math.max(120, Math.min(520, window.innerWidth - viewportMargin * 2));
    const maxPopupHeight = Math.max(
      150,
      Math.min(560, window.innerHeight - viewportMargin * 2, window.innerHeight * 0.68)
    );
    const heading = graphicAutocompletePreview.querySelector(".smarttex-preview-heading");
    const headingHeight = Math.max(0, heading?.getBoundingClientRect?.().height || 0);
    const maxMediaWidth = Math.max(40, maxPopupWidth - outputPadding);
    const maxMediaHeight = Math.max(40, maxPopupHeight - headingHeight - outputPadding);

    let mediaWidth = maxMediaWidth;
    let mediaHeight = mediaWidth / aspect;
    if (mediaHeight > maxMediaHeight) {
      mediaHeight = maxMediaHeight;
      mediaWidth = mediaHeight * aspect;
    }

    const popupWidth = Math.max(80, Math.ceil(mediaWidth + outputPadding));
    const outputHeight = Math.max(80, Math.ceil(mediaHeight + outputPadding));
    graphicAutocompletePreview.style.width = `${popupWidth}px`;
    graphicAutocompletePreview.style.maxHeight = `${Math.ceil(maxPopupHeight)}px`;
    graphicAutocompleteOutput.style.height = `${outputHeight}px`;
  }

  function renderGraphicAutocompletePreview(path, owner) {
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath || normalizedPath === graphicAutocompletePath && !graphicAutocompletePreview.hidden) {
      positionGraphicAutocompletePreview(owner);
      return;
    }
    const generation = ++graphicAutocompleteGeneration;
    graphicAutocompletePath = normalizedPath;
    // Reset sizing while a different file is resolving; the final dimensions
    // are set from the resolved media's intrinsic aspect ratio below.
    graphicAutocompletePreview.style.width = "";
    graphicAutocompletePreview.style.maxHeight = "";
    graphicAutocompleteOutput.style.height = "";
    graphicAutocompleteMeta.textContent = normalizedPath;
    graphicAutocompleteMeta.title = normalizedPath;

    const figure = document.createElement("figure");
    figure.className = "smarttex-figure-popup smarttex-graphic-autocomplete-figure";
    const viewport = document.createElement("div");
    viewport.className = "smarttex-figure-popup-viewport smarttex-graphic-autocomplete-viewport";
    const media = document.createElement("div");
    media.className = "smarttex-figure-popup-media smarttex-graphic-autocomplete-media";
    const placeholder = figurePopupPlaceholder(normalizedPath, true);
    media.appendChild(placeholder);
    viewport.appendChild(media);
    figure.appendChild(viewport);
    graphicAutocompleteOutput.replaceChildren(figure);
    graphicAutocompleteSpinner.hidden = false;
    graphicAutocompletePreview.setAttribute("aria-busy", "true");
    graphicAutocompletePreview.hidden = false;
    graphicAutocompletePreview.classList.add("smarttex-preview-visible");
    positionGraphicAutocompletePreview(owner);

    const direct = directFigureFile(normalizedPath);
    const resolution = direct?.url
      ? Promise.resolve(direct)
      : bridgeRequest("resolveProjectFile", { path: normalizedPath }).then((response) => response?.file);
    resolution.then(async (file) => {
      if (generation !== graphicAutocompleteGeneration || !file?.url || !placeholder.isConnected) return;
      const renderer = globalThis.SmartTeXFigureRenderer;
      const resolvedMedia = await renderer?.createMedia?.(file.path || normalizedPath, file.url, {
        imageClass: "smarttex-graphic-autocomplete-image",
        pdfClass: "smarttex-graphic-autocomplete-image smarttex-figure-popup-pdf"
      });
      if (generation !== graphicAutocompleteGeneration || !resolvedMedia || !placeholder.isConnected) return;
      try {
        await resolvedMedia.decode?.();
      } catch (_error) {
        // Some browsers reject decode() for an already available/cached image;
        // natural dimensions are still usable in that case.
      }
      if (generation !== graphicAutocompleteGeneration || !placeholder.isConnected) return;
      placeholder.replaceWith(resolvedMedia);
      fitGraphicAutocompletePreviewToMedia(resolvedMedia);
      graphicAutocompleteSpinner.hidden = true;
      graphicAutocompletePreview.removeAttribute("aria-busy");
      window.requestAnimationFrame(() => {
        const baseWidth = Math.max(1, resolvedMedia.getBoundingClientRect?.().width || resolvedMedia.clientWidth || 1);
        resolvedMedia.dataset.smarttexBaseWidthPx = String(baseWidth);
        resolvedMedia.style.width = `${baseWidth}px`;
        renderer?.ensurePopupZoom?.(figure)?.refresh?.();
        positionGraphicAutocompletePreview(owner);
      });
    }).catch(() => {
      if (generation !== graphicAutocompleteGeneration || !placeholder.isConnected) return;
      graphicAutocompleteSpinner.hidden = true;
      graphicAutocompletePreview.removeAttribute("aria-busy");
      placeholder.classList.remove("smarttex-figure-popup-resolving");
      placeholder.textContent = normalizedPath;
      placeholder.title = "The selected figure could not be previewed.";
    });
  }

  function updateGraphicAutocompletePreview() {
    graphicAutocompleteUpdateFrame = null;
    if (popupsSuppressedAfterEditorScroll) {
      hideGraphicAutocompletePreview();
      return;
    }
    if (!enabledFeatures.figures) {
      hideGraphicAutocompletePreview();
      return;
    }
    const argument = includeGraphicsArgumentAtCursor(currentState);
    const hoveredOwner = argument && graphicAutocompleteHoveredOwner?.isConnected
      ? nativeGraphicAutocompleteOwnerFromNode(graphicAutocompleteHoveredOwner)
      : null;
    const customOwner = argument
      ? document.querySelector(
        "#smarttex-figure-autocomplete-popup:not([hidden]) " +
        ".smarttex-figure-autocomplete-list"
      )
      : null;
    const owner = hoveredOwner || customOwner || (argument ? visibleNativeGraphicAutocomplete() : null);
    const hoveredEntry = owner && owner === hoveredOwner &&
      graphicAutocompleteHoveredEntry?.isConnected &&
      owner.contains(graphicAutocompleteHoveredEntry)
      ? graphicAutocompleteHoveredEntry
      : null;
    const entry = hoveredEntry || (owner ? selectedNativeGraphicEntry(owner) : null);
    const path = graphicPathFromSuggestion(entry);
    if (!argument || !owner || !entry || !path) {
      const wasActive = graphicAutocompleteActive;
      hideGraphicAutocompletePreview();
      if (wasActive && stateCanShowPreview(currentState)) scheduleRender();
      return;
    }
    graphicAutocompleteActive = true;
    hidePreview();
    hideCaptionReferencePopup();
    renderGraphicAutocompletePreview(path, owner);
  }

  function scheduleGraphicAutocompletePreviewUpdate() {
    if (popupsSuppressedAfterEditorScroll) return;
    if (graphicAutocompleteUpdateFrame !== null) return;
    graphicAutocompleteUpdateFrame = window.requestAnimationFrame(
      updateGraphicAutocompletePreview
    );
  }

  function appendPopupCaption(
    container,
    labelText,
    number,
    captionText,
    macros,
    sourceOffset = null
  ) {
    const text = String(captionText || "").trim();
    if (!text) return;
    const caption = document.createElement("figcaption");
    caption.className = "smarttex-float-popup-caption";
    const label = document.createElement("strong");
    label.textContent = `${labelText} ${number ?? "?"}:`;
    caption.append(
      label,
      " ",
      tableRenderer.renderInlineLatex(text, {
        contextTools,
        document,
        katex,
        macros,
        trust: trustedKatexCommand,
        sourceOffset: Number.isFinite(Number(sourceOffset))
          ? Number(sourceOffset)
          : undefined,
        renderReference: createCaptionReferenceLink
      })
    );
    container.appendChild(caption);
  }

  function boundedPopupText(value, maximum) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
  }

  function citationCacheKey() {
    const project = window.location.pathname.match(/\/project\/([^/?#]+)/i)?.[1]
      || window.location.pathname;
    return `smarttex:citation-cache:v1:${window.location.origin}:${project}`;
  }

  function loadCitationRecords({ force = false } = {}) {
    if (force) {
      citationRecordsPromise = null;
      citationRecordsLoaded = false;
    }
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

  function requestCitationRefresh(button) {
    if (!button || button.disabled) return Promise.resolve(false);
    const requestId = `content-${Date.now()}-${++citationRefreshCounter}`;
    button.disabled = true;
    button.classList.add("smarttex-citation-popup-refreshing");
    button.innerHTML = '<span class="smarttex-citation-refresh-spinner" aria-hidden="true"></span> Refreshing…';
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingCitationRefreshes.delete(requestId);
        button.disabled = false;
        button.classList.remove("smarttex-citation-popup-refreshing");
        button.innerHTML = '<span aria-hidden="true">↻</span> Refresh';
        resolve(false);
      }, 30000);
      pendingCitationRefreshes.set(requestId, { button, resolve, timeout });
      window.dispatchEvent(new CustomEvent(CITATION_REFRESH_REQUEST_EVENT, {
        detail: JSON.stringify({ requestId, source: "editor-popup" })
      }));
    });
  }

  function appendCitationRefreshControl(container, onRefreshed) {
    const bar = document.createElement("div");
    bar.className = "smarttex-citation-popup-toolbar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "smarttex-citation-popup-refresh";
    button.title = "Re-parse bibliography files";
    button.setAttribute("aria-label", "Refresh bibliography");
    button.innerHTML = '<span aria-hidden="true">↻</span> Refresh';
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestCitationRefresh(button).then((ok) => {
        if (!ok) return;
        return loadCitationRecords({ force: true }).then(() => onRefreshed?.());
      });
    });
    bar.appendChild(button);
    container.appendChild(bar);
  }

  function localCitationTarget(sourceValue, labelValue) {
    const source = String(sourceValue || "");
    const label = String(labelValue || "").trim();
    const pattern = /\\bibitem(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;
    let match;
    while ((match = pattern.exec(source))) {
      if (match[1].trim() !== label) continue;
      const next = source.slice(pattern.lastIndex).search(
        /\\bibitem\b|\\end\s*\{thebibliography\}/
      );
      const end = next < 0 ? source.length : pattern.lastIndex + next;
      const text = source.slice(pattern.lastIndex, end)
        .replace(/%[^\r\n]*/g, " ")
        .replace(/\\(?:newblock|emph|textit|textbf|url|href)\b/g, " ")
        .replace(/[{}~]+/g, " ")
        .replace(/\\[A-Za-z@]+\*?/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        label,
        type: "citation",
        sourceIndex: match.index,
        text
      };
    }
    return {
      label,
      type: "citation",
      sourceIndex: undefined,
      text: ""
    };
  }

  function citationPublicationText(record) {
    if (!record) return "";
    const journal = String(record.journal || "").trim();
    const volumeIssue = [
      String(record.volume || "").trim(),
      String(record.number || "").trim()
    ].filter(Boolean).join("(") + (
      record.volume && record.number ? ")" : ""
    );
    const pages = String(record.pages || "").trim();
    const year = String(record.year || "").trim();
    return [journal, volumeIssue, pages, year].filter(Boolean).join(", ");
  }

  function citationPopupCard(record, target) {
    const card = document.createElement("article");
    card.className = "smarttex-reference-popup-citation";

    const heading = document.createElement("div");
    heading.className = "smarttex-reference-popup-citation-heading";
    const title = document.createElement("strong");
    title.className = "smarttex-reference-popup-citation-title";
    title.textContent = boundedPopupText(
      record?.title || target?.text || target?.label,
      280
    );
    const key = document.createElement("code");
    key.className = "smarttex-reference-popup-citation-key";
    key.textContent = String(record?.key || target?.label || "?");
    heading.append(title, key);

    const authors = document.createElement("span");
    authors.className = "smarttex-reference-popup-citation-authors";
    authors.textContent = boundedPopupText(
      (Array.isArray(record?.authors) ? record.authors : []).join(", ")
        || (record ? "Unknown author" : `Citation key: ${target?.label || "?"}`),
      700
    );

    const publication = document.createElement("span");
    publication.className = "smarttex-reference-popup-citation-publication";
    publication.textContent = boundedPopupText(
      citationPublicationText(record) || (!record ? target?.text : ""),
      520
    );

    card.append(heading, authors);
    if (publication.textContent) card.appendChild(publication);
    if (record?.doi) {
      const doi = document.createElement("span");
      doi.className = "smarttex-reference-popup-citation-doi";
      doi.textContent = `DOI: ${boundedPopupText(record.doi, 240)}`;
      card.appendChild(doi);
    }
    return card;
  }

  function elementIsHovered(element) {
    try {
      return Boolean(element?.isConnected && element.matches(":hover"));
    } catch (_error) {
      return false;
    }
  }

  function noteReferencePopupInteraction(durationMs = 500) {
    referencePopupInteractionUntil = Math.max(
      referencePopupInteractionUntil,
      Date.now() + Math.max(0, Number(durationMs) || 0)
    );
  }

  function referencePopupInteractionRemaining() {
    if (referencePopupPointerDown) return 250;
    return Math.max(0, referencePopupInteractionUntil - Date.now());
  }

  function popupDepthForElement(element) {
    const popup = element?.closest?.(".smarttex-document-reference-popup");
    if (!popup) return -1;
    const depth = Number(popup.dataset.smarttexReferencePopupDepth);
    return Number.isInteger(depth) && depth >= 0 ? depth : 0;
  }

  function referencePopupContains(element) {
    if (captionReferencePopup?.contains(element)) return true;
    return nestedCaptionReferencePopupStates.some(
      (state) => state.popup?.contains(element)
    );
  }

  function nestedPopupState(depth, create = false) {
    if (!Number.isInteger(depth) || depth < 1) return null;
    const index = depth - 1;
    if (!nestedCaptionReferencePopupStates[index] && create) {
      nestedCaptionReferencePopupStates[index] = {
        popup: null,
        timer: null,
        anchor: null,
        anchorRect: null
      };
    }
    return nestedCaptionReferencePopupStates[index] || null;
  }

  function clearReferencePopupTimer(depth) {
    if (depth === 0) {
      window.clearTimeout(captionReferencePopupTimer);
      captionReferencePopupTimer = null;
      return;
    }
    const state = nestedPopupState(depth);
    if (!state) return;
    window.clearTimeout(state.timer);
    state.timer = null;
  }

  function clearReferencePopupTimersThrough(depth) {
    for (let currentDepth = 0; currentDepth <= depth; currentDepth += 1) {
      clearReferencePopupTimer(currentDepth);
    }
  }

  function hideNestedReferencePopupsFromDepth(depth) {
    const firstIndex = Math.max(0, depth - 1);
    for (let index = firstIndex; index < nestedCaptionReferencePopupStates.length; index += 1) {
      const state = nestedCaptionReferencePopupStates[index];
      if (!state) continue;
      window.clearTimeout(state.timer);
      state.timer = null;
      state.anchor = null;
      state.anchorRect = null;
      if (state.popup) {
        state.popup.hidden = true;
        state.popup.classList.remove("smarttex-reference-popup-compact");
        state.popup.style.removeProperty("width");
        state.popup.style.removeProperty("max-width");
        state.popup.removeAttribute("data-smarttex-content-kind");
        state.popup.__smarttexTargetKeys = new Set();
      }
    }
  }

  function hideCaptionReferencePopup() {
    const restoreCaptionPreview = captionInnerReferenceActive;
    captionInnerReferenceActive = false;
    hidePopupLoadingSpinner();
    referencePopupInteractionUntil = 0;
    referencePopupPointerDown = false;
    window.clearTimeout(captionReferencePopupTimer);
    captionReferencePopupTimer = null;
    window.clearTimeout(editorReferenceHoverTimer);
    editorReferenceHoverGeneration += 1;
    activeEditorReferenceKey = "";
    activeEditorReferenceType = "";
    activeSecondaryEditorReferenceKey = "";
    captionReferencePopupAnchor = null;
    captionReferencePopupAnchorRect = null;
    autocompleteReferenceAnchorRect = null;
    autocompleteReferenceOwnerRect = null;
    hideNestedReferencePopupsFromDepth(1);
    if (captionReferencePopup) {
      captionReferencePopup.hidden = true;
      captionReferencePopup.classList.remove(
        "smarttex-editor-reference-popup",
        "smarttex-reference-popup-compact"
      );
      captionReferencePopup.style.removeProperty("width");
      captionReferencePopup.style.removeProperty("max-width");
      captionReferencePopup.removeAttribute("data-smarttex-content-kind");
      captionReferencePopup.__smarttexTargetKeys = new Set();
    }
    if (restoreCaptionPreview) {
      window.requestAnimationFrame(() => {
        const state = previewStateForRender();
        if (stateCanShowPreview(state)) scheduleRender();
      });
    }
  }

  function popupChainIsHovered() {
    if (elementIsHovered(captionReferencePopupAnchor)) return true;
    if (elementIsHovered(captionReferencePopup)) return true;
    if (captionReferencePopup?.contains(document.activeElement)) return true;
    return nestedCaptionReferencePopupStates.some((state) => (
      !state?.popup?.hidden && (
        elementIsHovered(state.anchor) ||
        elementIsHovered(state.popup) ||
        state.popup?.contains(document.activeElement)
      )
    ));
  }

  function popupChainOriginatesInPreview() {
    if (
      captionReferencePopup &&
      !captionReferencePopup.hidden &&
      captionReferencePopupAnchor?.closest?.("#smarttex-equation-preview")
    ) {
      return true;
    }
    return nestedCaptionReferencePopupStates.some((state) => (
      state?.popup &&
      !state.popup.hidden &&
      state.anchor?.closest?.("#smarttex-equation-preview")
    ));
  }

  function keepReferencePopupOpen(event) {
    const depth = Math.max(0, popupDepthForElement(event?.target));
    const interactionDuration = /^(?:wheel|scroll)$/.test(String(event?.type || ""))
      ? 900
      : 450;
    noteReferencePopupInteraction(interactionDuration);
    if (event?.type === "pointerdown" || event?.type === "mousedown") {
      referencePopupPointerDown = true;
    }
    clearReferencePopupTimersThrough(depth);
    window.clearTimeout(editorReferenceHoverTimer);
  }

  function bindReferencePopupInteractionGuards(popup) {
    popup.addEventListener("pointerenter", keepReferencePopupOpen);
    popup.addEventListener("pointermove", keepReferencePopupOpen, { passive: true });
    popup.addEventListener("pointerdown", keepReferencePopupOpen, true);
    popup.addEventListener("mousedown", keepReferencePopupOpen, true);
    popup.addEventListener("wheel", keepReferencePopupOpen, { passive: true });
    popup.addEventListener("scroll", keepReferencePopupOpen, { passive: true, capture: true });
  }

  const POPUP_SCROLL_SELECTOR = [
    ".smarttex-reference-popup-target",
    ".smarttex-reference-popup-equation",
    ".smarttex-equation-output",
    ".smarttex-figure-popup-viewport",
    ".smarttex-table-scroll"
  ].join(",");

  function capturePopupScrollState(root) {
    if (!root) return [];
    return [root, ...root.querySelectorAll(POPUP_SCROLL_SELECTOR)].map(
      (element, index) => ({
        index,
        left: Number(element.scrollLeft) || 0,
        top: Number(element.scrollTop) || 0
      })
    );
  }

  function restorePopupScrollState(root, state) {
    if (!root || !Array.isArray(state) || !state.length) return;
    const restore = () => {
      const elements = [root, ...root.querySelectorAll(POPUP_SCROLL_SELECTOR)];
      state.forEach((entry) => {
        const element = elements[entry.index];
        if (!element) return;
        element.scrollLeft = Math.max(0, Number(entry.left) || 0);
        element.scrollTop = Math.max(0, Number(entry.top) || 0);
      });
    };
    restore();
    window.requestAnimationFrame(restore);
  }

  function scheduleHideCaptionReferencePopup(delayMs = 180) {
    window.clearTimeout(captionReferencePopupTimer);
    captionReferencePopupTimer = window.setTimeout(() => {
      if (
        referenceAutocompleteActive &&
        captionReferencePopup?.dataset.smarttexAutocompleteOwner === "reference"
      ) {
        return;
      }
      const remaining = referencePopupInteractionRemaining();
      if (remaining > 0) {
        scheduleHideCaptionReferencePopup(Math.min(950, remaining + 35));
        return;
      }
      if (popupChainIsHovered()) return;
      hideCaptionReferencePopup();
    }, delayMs);
  }

  function scheduleHideNestedReferencePopup(depth, delayMs = 180) {
    const state = nestedPopupState(depth);
    if (!state) return;
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      const remaining = referencePopupInteractionRemaining();
      if (remaining > 0) {
        scheduleHideNestedReferencePopup(depth, Math.min(950, remaining + 35));
        return;
      }
      const descendantHovered = nestedCaptionReferencePopupStates
        .slice(depth - 1)
        .some((candidate) => (
          !candidate?.popup?.hidden && (
            elementIsHovered(candidate.anchor) ||
            elementIsHovered(candidate.popup)
          )
        ));
      if (descendantHovered) return;
      hideNestedReferencePopupsFromDepth(depth);
    }, delayMs);
  }

  function schedulePopupChainHideThrough(depth) {
    scheduleHideCaptionReferencePopup();
    for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
      scheduleHideNestedReferencePopup(currentDepth);
    }
  }

  function ensureCaptionReferencePopup() {
    if (captionReferencePopup?.isConnected) return captionReferencePopup;
    captionReferencePopup = document.createElement("aside");
    captionReferencePopup.className =
      "smarttex-document-reference-popup smarttex-caption-reference-popup";
    captionReferencePopup.dataset.smarttexReferencePopupDepth = "0";
    captionReferencePopup.hidden = true;
    captionReferencePopup.setAttribute("role", "tooltip");
    bindReferencePopupInteractionGuards(captionReferencePopup);
    captionReferencePopup.addEventListener("pointerleave", () => {
      scheduleHideCaptionReferencePopup();
    });
    document.body.appendChild(captionReferencePopup);
    return captionReferencePopup;
  }

  function ensureNestedCaptionReferencePopup(depth) {
    const state = nestedPopupState(depth, true);
    if (state.popup?.isConnected) return state.popup;
    const popup = document.createElement("aside");
    popup.className =
      "smarttex-document-reference-popup smarttex-caption-reference-popup smarttex-nested-reference-popup";
    popup.dataset.smarttexReferencePopupDepth = String(depth);
    popup.hidden = true;
    popup.setAttribute("role", "tooltip");
    bindReferencePopupInteractionGuards(popup);
    popup.addEventListener("pointerleave", () => {
      schedulePopupChainHideThrough(depth);
    });
    document.body.appendChild(popup);
    state.popup = popup;
    return popup;
  }

  function referenceLinkText(command, target, label) {
    const number = String(target?.number || label || "?");
    if (command === "eqref") return `(${number})`;
    if (/^(?:autoref|cref|Cref|vref|Vref)$/.test(command)) {
      const type = {
        equation: "Equation",
        figure: "Figure",
        table: "Table",
        section: "Section"
      }[target?.type] || "Reference";
      return `${type} ${number}`;
    }
    return number;
  }

  function referencePopupTitle(target, label) {
    const number = target?.number || label || "?";
    if (target?.type === "equation") return `Equation ${number}`;
    if (target?.type === "figure") return `Figure ${number}`;
    if (target?.type === "table") return `Table ${number}`;
    if (target?.type === "section") return `Section ${number}`;
    if (target?.type === "citation") return `Citation ${target.label || label || "?"}`;
    return `Reference ${number}`;
  }

  function appendReferencePopupHeading(container, target, label) {
    const heading = document.createElement("div");
    heading.className = "smarttex-reference-popup-heading";
    const titleText = referencePopupTitle(target, label);
    const sourceIndex = Number(target?.sourceIndex);
    if (Number.isFinite(sourceIndex)) {
      const link = document.createElement("a");
      link.className = "smarttex-reference-popup-title";
      link.href = "#";
      link.textContent = titleText;
      link.title = "Jump to this element in the editor";
      const consumePress = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      link.addEventListener("pointerdown", consumePress);
      link.addEventListener("mousedown", consumePress);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        announceNavigationOrigin(sourceIndex);
        hideCaptionReferencePopup();
        bridgeRequest("setCursor", {
          index: sourceIndex,
          focus: true
        }).catch((error) => {
          console.warn("SmartTeX could not navigate to the reference target:", error);
        });
      });
      heading.appendChild(link);
    } else {
      const title = document.createElement("strong");
      title.className = "smarttex-reference-popup-title";
      title.textContent = titleText;
      heading.appendChild(title);
    }
    container.appendChild(heading);
  }

  function popupAnchorRect(anchorValue) {
    if (!anchorValue) return null;
    const rect = typeof anchorValue.getBoundingClientRect === "function"
      ? anchorValue.getBoundingClientRect()
      : anchorValue;
    return {
      left: Number(rect.left) || 0,
      right: Number(rect.right ?? rect.left) || 0,
      top: Number(rect.top) || 0,
      bottom: Number(rect.bottom ?? rect.top) || 0
    };
  }

  function positionCaptionReferencePopup(anchorValue) {
    if (!captionReferencePopup || captionReferencePopup.hidden || !anchorValue) return;
    captionReferencePopupAnchorRect = popupAnchorRect(anchorValue);
    if (!captionReferencePopupAnchorRect) return;
    const popupRect = captionReferencePopup.getBoundingClientRect();
    const margin = 10;
    const left = Math.max(
      margin,
      Math.min(
        captionReferencePopupAnchorRect.left,
        window.innerWidth - popupRect.width - margin
      )
    );
    const anchorLineHeight = Math.max(16, captionReferencePopupAnchorRect.bottom - captionReferencePopupAnchorRect.top);
    const verticalGap = anchorLineHeight * 2;
    const below = captionReferencePopupAnchorRect.bottom + verticalGap;
    const top = below + popupRect.height <= window.innerHeight - margin
      ? below
      : Math.max(
        margin,
        captionReferencePopupAnchorRect.top - popupRect.height - verticalGap
      );
    captionReferencePopup.style.left = `${Math.round(left)}px`;
    captionReferencePopup.style.top = `${Math.round(top)}px`;
  }

  function positionNestedCaptionReferencePopup(depth, anchorValue) {
    const state = nestedPopupState(depth);
    if (!state?.popup || state.popup.hidden || !anchorValue) return;
    state.anchorRect = popupAnchorRect(anchorValue);
    if (!state.anchorRect) return;

    const popupRect = state.popup.getBoundingClientRect();
    const parentPopup = depth === 1
      ? captionReferencePopup
      : nestedPopupState(depth - 1)?.popup;
    const parentRect = parentPopup?.getBoundingClientRect();
    const margin = 10;
    const gap = 8;
    const maximumLeft = Math.max(margin, window.innerWidth - popupRect.width - margin);
    let left;

    if (parentRect && parentRect.right + gap + popupRect.width <= window.innerWidth - margin) {
      left = parentRect.right + gap;
    } else if (parentRect && parentRect.left - gap - popupRect.width >= margin) {
      left = parentRect.left - gap - popupRect.width;
    } else {
      left = Math.max(margin, Math.min(state.anchorRect.left, maximumLeft));
    }

    const preferredTop = state.anchorRect.top - 12;
    const top = Math.max(
      margin,
      Math.min(preferredTop, window.innerHeight - popupRect.height - margin)
    );
    state.popup.style.left = `${Math.round(left)}px`;
    state.popup.style.top = `${Math.round(top)}px`;
  }

  function repositionReferencePopups() {
    if (
      captionReferencePopup?.dataset.smarttexAutocompleteOwner === "reference" &&
      autocompleteReferenceAnchorRect &&
      autocompleteReferenceOwnerRect
    ) {
      positionAutocompleteReferencePopup(
        autocompleteReferenceAnchorRect,
        autocompleteReferenceOwnerRect
      );
    } else if (captionReferencePopupAnchorRect && captionReferencePopup && !captionReferencePopup.hidden) {
      positionCaptionReferencePopup(
        captionReferencePopupAnchor?.isConnected
          ? captionReferencePopupAnchor
          : captionReferencePopupAnchorRect
      );
    }
    nestedCaptionReferencePopupStates.forEach((state, index) => {
      if (!state?.anchorRect || !state.popup || state.popup.hidden) return;
      positionNestedCaptionReferencePopup(
        index + 1,
        state.anchor?.isConnected ? state.anchor : state.anchorRect
      );
    });
  }

  function popupTableContext(target, source) {
    const start = Math.max(0, Number(target?.context?.contentStart) || 0);
    const end = Math.max(start, Number(target?.context?.contentEnd) || source.length);
    let position = source.indexOf("\\begin", start);
    while (position >= 0 && position < end) {
      const context = contextTools.findTableContext(source, position + 1);
      if (
        context &&
        context.openStart >= start &&
        context.closeEnd <= end
      ) {
        return context;
      }
      position = source.indexOf("\\begin", position + 6);
    }
    return null;
  }

  function referenceTargetPreviewEnabled(target) {
    if (!target) return false;
    if (target.type === "equation") return enabledFeatures.equations;
    if (target.type === "table") return enabledFeatures.tables;
    if (target.type === "figure") return enabledFeatures.figures;
    return true;
  }

  function appendReferenceTargetPreview(container, target, source) {
    if (!referenceTargetPreviewEnabled(target)) return false;
    if (target.type === "equation" && target.context) {
      const body = contextTools.previewBody(
        target.context,
        null,
        target.numbering,
        false
      );
      const prepared = contextTools.prepareDocumentCommands(
        source,
        target.sourceIndex,
        body
      );
      const equation = document.createElement("div");
      equation.className =
        "smarttex-reference-popup-target smarttex-reference-popup-equation";
      try {
        katex.render(prepared.body, equation, {
          displayMode: true,
          throwOnError: true,
          strict: "ignore",
          trust: trustedKatexCommand,
          maxExpand: 1000,
          maxSize: 25,
          macros: {
            ...prepared.macros,
            "\\label": { tokens: [], numArgs: 1 },
            "\\nonumber": "",
            "\\notag": ""
          }
        });
      } catch (_error) {
        equation.textContent = `Equation ${target.number || target.label}`;
      }
      container.appendChild(equation);
      return true;
    }

    if (target.type === "figure" && target.context) {
      const prepared = contextTools.prepareDocumentCommands(
        source,
        target.sourceIndex,
        target.caption || ""
      );
      const figure = renderFigurePopup(
        target.context,
        target.number,
        prepared.body,
        prepared.macros
      );
      figure.classList.add("smarttex-reference-popup-target");
      container.appendChild(figure);
      globalThis.SmartTeXFigureRenderer?.observePopupLayout?.(
        figure.querySelector(".smarttex-figure-layout")
      );
      return true;
    }

    if (target.type === "table") {
      const card = document.createElement("figure");
      card.className = "smarttex-reference-popup-target smarttex-table-popup";
      const tableContext = popupTableContext(target, source);
      const caption = contextTools.prepareDocumentCommands(
        source,
        target.sourceIndex,
        target.caption || ""
      );
      if (tableContext) {
        const preparedTable = contextTools.prepareDocumentCommands(
          source,
          target.sourceIndex,
          tableContext.source
        );
        try {
          card.appendChild(tableRenderer.renderTable({
            ...tableContext,
            source: preparedTable.body
          }, {
            commandSide: null,
            includeCaret: false,
            contextTools,
            document,
            katex,
            macros: preparedTable.macros,
            trust: trustedKatexCommand
          }));
        } catch (_error) {
          const missing = document.createElement("div");
          missing.className = "smarttex-reference-popup-missing";
          missing.textContent = "The table body could not be rendered.";
          card.appendChild(missing);
        }
      }
      appendPopupCaption(
        card,
        "Table",
        target.number,
        caption.body,
        caption.macros
      );
      container.appendChild(card);
      return true;
    }

    const card = document.createElement("div");
    card.className = "smarttex-reference-popup-target";
    if (target.title) card.textContent = target.title;
    else card.textContent = referencePopupTitle(target, target.label);
    container.appendChild(card);
    return true;
  }

  function renderCaptionReferencePopup(anchor, target) {
    if (!popupInteractionReady()) return -1;
    const parentDepth = popupDepthForElement(anchor);
    const depth = parentDepth + 1;
    if (!target || !currentState) return depth;
    if (!referenceTargetPreviewEnabled(target)) {
      if (depth <= 0) hideCaptionReferencePopup();
      else hideNestedReferencePopupsFromDepth(depth);
      return depth;
    }
    const targetKey = referenceTargetKey(target, target.label);
    const targetKeys = new Set([targetKey]);
    const parentPopup = parentDepth < 0
      ? null
      : (parentDepth === 0
        ? captionReferencePopup
        : nestedPopupState(parentDepth)?.popup);
    if (popupSharesTarget(parentPopup, targetKeys)) {
      hideNestedReferencePopupsFromDepth(Math.max(1, depth));
      return Math.max(0, parentDepth);
    }
    const popup = depth === 0
      ? ensureCaptionReferencePopup()
      : ensureNestedCaptionReferencePopup(depth);

    if (depth === 0) {
      popup.removeAttribute("data-smarttex-autocomplete-owner");
      autocompleteReferenceAnchorRect = null;
      autocompleteReferenceOwnerRect = null;
      activeEditorReferenceKey = "";
      activeEditorReferenceType = "";
      captionReferencePopupAnchor = anchor?.isConnected ? anchor : null;
      popup.classList.remove("smarttex-editor-reference-popup");
    } else {
      const state = nestedPopupState(depth, true);
      state.anchor = anchor?.isConnected ? anchor : null;
      popup.classList.remove("smarttex-editor-reference-popup");
    }

    const popupKey = [
      target.type || "reference",
      target.label || "",
      Number(target.sourceIndex) || 0
    ].join(":");
    if (!popup.hidden && popup.__smarttexKey === popupKey) {
      if (depth === 0) positionCaptionReferencePopup(anchor);
      else positionNestedCaptionReferencePopup(depth, anchor);
      return depth;
    }

    hideNestedReferencePopupsFromDepth(depth + 1);
    clearReferencePopupTimersThrough(depth);
    const scrollState = capturePopupScrollState(popup);
    popup.replaceChildren();
    const entry = document.createElement("section");
    entry.className = "smarttex-reference-popup-entry";
    appendReferencePopupHeading(entry, target, target.label);
    appendReferenceTargetPreview(entry, target, String(currentState.value || ""));
    popup.appendChild(entry);
    globalThis.SmartTeXFigureRenderer?.observePopupLayout?.(
      entry.querySelector(".smarttex-figure-layout")
    );
    popup.__smarttexKey = popupKey;
    popup.__smarttexTargetKeys = targetKeys;
    popup.dataset.smarttexContentKind = target.type === "figure"
      ? "figure"
      : target.type || "reference";
    popup.hidden = false;
    restorePopupScrollState(popup, scrollState);

    if (depth === 0) positionCaptionReferencePopup(anchor);
    else positionNestedCaptionReferencePopup(depth, anchor);
    return depth;
  }

  function editorReferenceInteractionAtIndex(sourceValue, indexValue) {
    const source = String(sourceValue || "");
    const masked = contextTools.maskIgnoredLatex(source);
    const index = Math.max(0, Math.min(Number(indexValue) || 0, source.length));
    const pattern = /\\(eqref|ref|pageref|autoref|cref|Cref|vref|Vref|nameref|cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]+)\}/g;
    let match;
    while ((match = pattern.exec(masked))) {
      if (index < match.index || index > pattern.lastIndex) continue;
      return {
        command: match[1],
        labels: match[2].split(",").map((label) => label.trim()).filter(Boolean),
        sourceIndex: match.index,
        sourceEnd: pattern.lastIndex,
        type: /^(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)$/i
          .test(match[1])
          ? "citation"
          : "reference"
      };
    }
    return null;
  }

  function cursorIsInsideCitationCommand(state = currentState) {
    if (!state || !Number.isInteger(state.cursorIndex)) return false;
    return editorReferenceInteractionAtIndex(
      state.value,
      state.cursorIndex
    )?.type === "citation";
  }

  function autocompleteOwnerAtCursor(state = currentState) {
    if (!state || !Number.isInteger(state.cursorIndex)) return "";
    const source = String(state.value || "");
    const index = Math.max(0, Math.min(state.cursorIndex, source.length));
    const masked = contextTools.maskIgnoredLatex(source);
    const beforeCursor = masked.slice(0, index);
    const match = beforeCursor.match(
      /\\(eqref|ref|pageref|autoref|cref|Cref|vref|Vref|nameref|cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{[^{}]*$/i
    );
    if (!match) return "";
    return /^(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)$/i.test(match[1])
      ? "citation"
      : "reference";
  }

  function autocompleteListAvailableAtCursor(state = currentState) {
    const owner = autocompleteOwnerAtCursor(state);
    if (owner === "reference") {
      return Boolean(document.getElementById("smarttex-reference-autocomplete-popup"));
    }
    if (owner === "citation") {
      return Boolean(document.querySelector(
        "#smarttex-citation-popup, #ctca-popup, #ctca-bib-manager"
      ));
    }
    return false;
  }

  function editorReferenceKey(interaction, state = currentState) {
    if (!interaction) return "";
    return [
      state?.fileName || "",
      interaction.sourceIndex,
      interaction.sourceEnd,
      interaction.labels?.join(",") || ""
    ].join(":");
  }

  function referenceTargetKey(target, labelValue = "") {
    const label = String(labelValue || target?.label || "").trim();
    const type = String(target?.type || "reference").trim() || "reference";
    if (label) return `${type}:${label}`;
    return `${type}:@${Math.max(0, Number(target?.sourceIndex) || 0)}`;
  }

  function interactionTargetKeys(interaction, sourceValue = currentState?.value) {
    const source = String(sourceValue || "");
    const keys = new Set();
    for (const label of interaction?.labels || []) {
      const target = interaction?.type === "citation"
        ? localCitationTarget(source, label)
        : contextTools.referenceTarget?.(source, label);
      keys.add(referenceTargetKey(target, label));
    }
    return keys;
  }

  function popupSharesTarget(popup, keys) {
    if (!popup || popup.hidden || !(keys instanceof Set) || !keys.size) return false;
    const popupKeys = popup.__smarttexTargetKeys;
    if (!(popupKeys instanceof Set)) return false;
    return [...keys].some((key) => popupKeys.has(key));
  }

  function editorReferenceEntry(popup, target, label, source, record = null) {
    if (target && !referenceTargetPreviewEnabled(target)) return false;
    const entry = document.createElement("section");
    entry.className = "smarttex-reference-popup-entry";
    appendReferencePopupHeading(entry, target, label);
    if (target.type === "citation") {
      entry.appendChild(citationPopupCard(record, target));
    } else {
      appendReferenceTargetPreview(entry, target, source);
    }
    popup.appendChild(entry);
    globalThis.SmartTeXFigureRenderer?.observePopupLayout?.(
      entry.querySelector(".smarttex-figure-layout")
    );
    return true;
  }

  function updateReferencePopupContentKind(popup) {
    const targets = [...popup.querySelectorAll(".smarttex-reference-popup-target")];
    const figureOnly = targets.length === 1 &&
      targets[0].classList.contains("smarttex-figure-popup");
    popup.dataset.smarttexContentKind = figureOnly ? "figure" : "mixed";
  }

  function renderEditorReferencePopup(
    anchorRect,
    interaction,
    { allowCitationAtCursor = false, force = false } = {}
  ) {
    if (!popupInteractionReady() || !currentState || !interaction?.labels?.length) return;
    if (
      interaction.type === "citation" &&
      cursorIsInsideCitationCommand() &&
      !allowCitationAtCursor
    ) {
      hideCaptionReferencePopup();
      return;
    }
    const source = String(currentState.value || "");
    const key = editorReferenceKey(interaction);
    activeEditorReferenceKey = key;
    activeEditorReferenceType = interaction.type;
    captionInnerReferenceActive = Boolean(
      captionContainerAtIndex(currentState, interaction.sourceIndex)
    );
    if (captionInnerReferenceActive && !preview.hidden) {
      hidePreview({ clearDismissal: false });
    }
    captionReferencePopupAnchor = null;
    hideNestedReferencePopupsFromDepth(1);
    clearReferencePopupTimer(0);
    const popup = ensureCaptionReferencePopup();
    popup.removeAttribute("data-smarttex-autocomplete-owner");
    autocompleteReferenceAnchorRect = null;
    autocompleteReferenceOwnerRect = null;
    popup.classList.add("smarttex-editor-reference-popup");
    if (!force && !popup.hidden && popup.__smarttexKey === key) {
      positionCaptionReferencePopup(anchorRect);
      return;
    }
    const scrollState = capturePopupScrollState(popup);
    popup.replaceChildren();

    if (interaction.type === "citation") {
      appendCitationRefreshControl(popup, () => {
        if (
          activeEditorReferenceKey === key &&
          popup.isConnected &&
          !popup.hidden
        ) {
          renderEditorReferencePopup(anchorRect, interaction, {
            allowCitationAtCursor,
            force: true
          });
        }
      });
      for (const label of interaction.labels.slice(0, 8)) {
        const target = localCitationTarget(source, label);
        editorReferenceEntry(
          popup,
          target,
          label,
          source,
          citationRecords.get(label) || null
        );
      }
    } else {
      for (const label of interaction.labels.slice(0, 8)) {
        const target = contextTools.referenceTarget?.(source, label);
        if (target) {
          editorReferenceEntry(popup, target, label, source);
        } else {
          const missing = document.createElement("div");
          missing.className = "smarttex-reference-popup-missing";
          missing.textContent = `Reference target “${label}” was not found.`;
          popup.appendChild(missing);
        }
      }
    }

    if (!popup.children.length) {
      hideCaptionReferencePopup();
      return;
    }
    popup.__smarttexKey = key;
    popup.__smarttexTargetKeys = interactionTargetKeys(interaction, source);
    updateReferencePopupContentKind(popup);
    popup.hidden = false;
    restorePopupScrollState(popup, scrollState);
    positionCaptionReferencePopup(anchorRect);

    if (interaction.type === "citation" && !citationRecordsLoaded) {
      loadCitationRecords().then(() => {
        if (
          activeEditorReferenceKey !== key ||
          popup.hidden ||
          !currentState
        ) return;
        renderEditorReferencePopup(anchorRect, interaction, {
          allowCitationAtCursor,
          force: true
        });
      });
    }
  }

  function renderSecondaryEditorReferencePopup(
    anchorRect,
    interaction,
    { allowCitationAtCursor = false, force = false } = {}
  ) {
    if (!popupInteractionReady() || !currentState || !interaction?.labels?.length) return;
    if (
      interaction.type === "citation" &&
      cursorIsInsideCitationCommand() &&
      !allowCitationAtCursor
    ) {
      hideNestedReferencePopupsFromDepth(1);
      activeSecondaryEditorReferenceKey = "";
      return;
    }

    const source = String(currentState.value || "");
    const key = `secondary:${editorReferenceKey(interaction)}`;
    const popup = ensureNestedCaptionReferencePopup(1);
    const state = nestedPopupState(1, true);
    state.anchor = null;
    state.anchorRect = normalizedPopupRect(anchorRect);
    hideNestedReferencePopupsFromDepth(2);
    clearReferencePopupTimer(1);
    popup.classList.add("smarttex-editor-reference-popup");

    if (!force && !popup.hidden && popup.__smarttexKey === key) {
      positionNestedCaptionReferencePopup(1, anchorRect);
      return;
    }

    const scrollState = capturePopupScrollState(popup);
    popup.replaceChildren();
    if (interaction.type === "citation") {
      appendCitationRefreshControl(popup, () => {
        if (
          activeSecondaryEditorReferenceKey === key &&
          popup.isConnected &&
          !popup.hidden
        ) {
          renderSecondaryEditorReferencePopup(anchorRect, interaction, {
            allowCitationAtCursor,
            force: true
          });
        }
      });
      for (const label of interaction.labels.slice(0, 8)) {
        const target = localCitationTarget(source, label);
        editorReferenceEntry(
          popup,
          target,
          label,
          source,
          citationRecords.get(label) || null
        );
      }
    } else {
      for (const label of interaction.labels.slice(0, 8)) {
        const target = contextTools.referenceTarget?.(source, label);
        if (target) {
          editorReferenceEntry(popup, target, label, source);
        } else {
          const missing = document.createElement("div");
          missing.className = "smarttex-reference-popup-missing";
          missing.textContent = `Reference target “${label}” was not found.`;
          popup.appendChild(missing);
        }
      }
    }

    if (!popup.children.length) {
      hideNestedReferencePopupsFromDepth(1);
      activeSecondaryEditorReferenceKey = "";
      return;
    }
    popup.__smarttexKey = key;
    popup.__smarttexTargetKeys = interactionTargetKeys(interaction, source);
    updateReferencePopupContentKind(popup);
    popup.hidden = false;
    activeSecondaryEditorReferenceKey = key;
    restorePopupScrollState(popup, scrollState);
    positionNestedCaptionReferencePopup(1, anchorRect);

    if (interaction.type === "citation" && !citationRecordsLoaded) {
      loadCitationRecords().then(() => {
        if (
          activeSecondaryEditorReferenceKey !== key ||
          popup.hidden ||
          !currentState
        ) return;
        renderSecondaryEditorReferencePopup(anchorRect, interaction, {
          allowCitationAtCursor,
          force: true
        });
      });
    }
  }

  function editorCursorAnchorRect(state = currentState) {
    const screen = state?.screen;
    if (!screen) return null;
    const left = Number(screen.pageX) - window.scrollX;
    const top = Number(screen.pageY) - window.scrollY;
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    const lineHeight = Math.max(14, Number(screen.lineHeight) || 18);
    return {
      left,
      right: left + 2,
      top,
      bottom: top + lineHeight
    };
  }

  function updateCursorTriggeredReferencePopup(state = currentState) {
    if (referencePopupUsesHover()) return false;
    if (
      !state ||
      !state.focused ||
      !Number.isInteger(state.cursorIndex) ||
      state.selectionFrom !== state.selectionTo
    ) {
      hideCaptionReferencePopup();
      return false;
    }
    if (autocompleteListAvailableAtCursor(state)) {
      hideCaptionReferencePopup();
      return true;
    }
    const interaction = editorReferenceInteractionAtIndex(
      state.value,
      state.cursorIndex
    );
    const anchorRect = editorCursorAnchorRect(state);
    if (!interaction || !anchorRect) {
      hideCaptionReferencePopup();
      return false;
    }
    const key = editorReferenceKey(interaction, state);
    if (
      key &&
      activeEditorReferenceKey === key &&
      captionReferencePopup &&
      !captionReferencePopup.hidden
    ) {
      positionCaptionReferencePopup(anchorRect);
      return true;
    }
    const spinnerGeneration = showPopupLoadingSpinner(null, anchorRect);
    window.requestAnimationFrame(() => {
      try {
        if (
          referencePopupUsesHover() ||
          currentState !== state ||
          editorReferenceInteractionAtIndex(state.value, state.cursorIndex)?.sourceIndex !==
            interaction.sourceIndex
        ) return;
        renderEditorReferencePopup(anchorRect, interaction, {
          allowCitationAtCursor: true
        });
      } finally {
        hidePopupLoadingSpinner(spinnerGeneration);
      }
    });
    return true;
  }

  function editorSurface(element) {
    return element?.closest?.(
      ".cm-content, .cm-line, .cm-scroller, .cm-editor, " +
      ".ace_content, .ace_text-layer, .ace_scroller, .ace_editor"
    ) || null;
  }

  function autocompleteSurface(element) {
    return element?.closest?.(
      "#smarttex-reference-autocomplete-popup, #smarttex-citation-popup, #smarttex-citation-autocomplete-popup"
    ) || null;
  }

  function hideNormalReferencePopupForAutocomplete() {
    const popup = captionReferencePopup;
    if (!popup || popup.hidden) return;
    if (popup.dataset.smarttexAutocompleteOwner === "reference") return;
    hideCaptionReferencePopup();
  }

  function autocompleteOwnsInteraction(interaction) {
    if (!referenceAutocompleteActive || !interaction) return false;
    if (
      Number.isInteger(autocompleteReferenceCommandStart) &&
      interaction.sourceIndex === autocompleteReferenceCommandStart
    ) return true;
    const cursorInteraction = editorReferenceInteractionAtIndex(
      currentState?.value,
      currentState?.cursorIndex
    );
    if (
      cursorInteraction?.type === "reference" &&
      interaction.type === "reference" &&
      cursorInteraction.sourceIndex === interaction.sourceIndex
    ) return true;
    const keys = interactionTargetKeys(interaction);
    if (autocompleteReferenceTargetKey && keys.has(autocompleteReferenceTargetKey)) {
      return true;
    }
    return popupSharesTarget(
      captionReferencePopup,
      keys
    );
  }

  function scheduleEditorReferenceHover(event) {
    hidePopupLoadingSpinner();
    if (referencePopupContains(event.target)) {
      const depth = popupDepthForElement(event.target);
      clearReferencePopupTimersThrough(Math.max(0, depth));
      window.clearTimeout(editorReferenceHoverTimer);
      return;
    }
    if (autocompleteSurface(event.target)) {
      window.clearTimeout(captionReferencePopupTimer);
      window.clearTimeout(editorReferenceHoverTimer);
      clearReferencePopupTimersThrough(1);
      return;
    }
    if (!referencePopupUsesHover()) {
      window.clearTimeout(editorReferenceHoverTimer);
      return;
    }
    const surface = editorSurface(event.target);
    if (!surface || !currentState) {
      if (referenceAutocompleteActive) {
        if (activeSecondaryEditorReferenceKey) {
          scheduleHideNestedReferencePopup(1);
        }
      } else if (activeEditorReferenceKey) {
        scheduleHideCaptionReferencePopup();
      }
      return;
    }

    window.clearTimeout(captionReferencePopupTimer);
    window.clearTimeout(editorReferenceHoverTimer);
    const generation = ++editorReferenceHoverGeneration;
    const clientX = event.clientX;
    const clientY = event.clientY;
    const lineHeight = Math.max(
      14,
      parseFloat(getComputedStyle(surface).lineHeight) || 18
    );
    const anchorRect = {
      left: clientX,
      right: clientX + 1,
      top: clientY - lineHeight * 0.45,
      bottom: clientY + lineHeight * 0.55
    };

    editorReferenceHoverTimer = window.setTimeout(() => {
      const spinnerGeneration = showPopupLoadingSpinner(
        { clientX, clientY },
        anchorRect
      );
      window.requestAnimationFrame(() => {
        if (generation !== editorReferenceHoverGeneration) {
          hidePopupLoadingSpinner(spinnerGeneration);
          return;
        }
        bridgeRequest("getIndexAtCoordinates", { clientX, clientY }, 1200)
          .then((response) => {
            if (generation !== editorReferenceHoverGeneration || !currentState) return;
            const interaction = editorReferenceInteractionAtIndex(
              currentState.value,
              response.index
            );
            if (
              !interaction ||
              (interaction.type === "citation" && cursorIsInsideCitationCommand())
            ) {
              if (referenceAutocompleteActive) {
                hideNestedReferencePopupsFromDepth(1);
                activeSecondaryEditorReferenceKey = "";
              } else {
                hideCaptionReferencePopup();
              }
              return;
            }
            if (referenceAutocompleteActive) {
              if (autocompleteOwnsInteraction(interaction)) {
                hideNestedReferencePopupsFromDepth(1);
                activeSecondaryEditorReferenceKey = "";
                clearReferencePopupTimer(0);
                return;
              }
              renderSecondaryEditorReferencePopup(anchorRect, interaction);
              return;
            }
            renderEditorReferencePopup(anchorRect, interaction);
          })
          .catch(() => {
            if (generation === editorReferenceHoverGeneration) {
              if (referenceAutocompleteActive) {
                scheduleHideNestedReferencePopup(1);
              } else {
                scheduleHideCaptionReferencePopup();
              }
            }
          })
          .finally(() => {
            hidePopupLoadingSpinner(spinnerGeneration);
          });
      });
    }, 75);
  }

  function createCaptionReferenceLink(reference) {
    const label = String(reference?.label || "").trim();
    const command = String(reference?.command || "ref");
    const target = contextTools.referenceTarget?.(currentState?.value, label);
    const link = document.createElement("a");
    link.className = "smarttex-document-reference smarttex-caption-reference";
    link.href = "#";
    link.textContent = referenceLinkText(command, target, label);
    link.title = target
      ? `Show ${target.type} ${target.number || label}`
      : `Reference ${label}`;
    // Consume the press before it reaches the editor below the transient popup.
    // Otherwise the editor may update its cursor state and rebuild the popup
    // between pointerdown and click, so the link disappears before its click
    // handler can run.
    link.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    link.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideCaptionReferencePopup();
      if (target?.sourceIndex === undefined) return;
      announceNavigationOrigin(target.sourceIndex);
      bridgeRequest("setCursor", {
        index: target.sourceIndex,
        focus: true
      }).catch((error) => {
        console.warn("SmartTeX could not navigate to the caption reference:", error);
      });
    });
    let hoverPopupDepth = null;
    const show = (event) => {
      if (!referencePopupUsesHover() || !referenceTargetPreviewEnabled(target)) return;
      const spinnerGeneration = showPopupLoadingSpinner(event, link);
      window.requestAnimationFrame(() => {
        try {
          hoverPopupDepth = renderCaptionReferencePopup(link, target);
        } finally {
          hidePopupLoadingSpinner(spinnerGeneration);
        }
      });
    };
    const scheduleHide = () => {
      const depth = Number.isInteger(hoverPopupDepth)
        ? hoverPopupDepth
        : popupDepthForElement(link) + 1;
      if (depth <= 0) scheduleHideCaptionReferencePopup();
      else scheduleHideNestedReferencePopup(depth);
    };
    link.addEventListener("pointerenter", show);
    link.addEventListener("focus", show);
    link.addEventListener("pointerleave", scheduleHide);
    link.addEventListener("blur", scheduleHide);
    return link;
  }

  function normalizedPopupRect(value) {
    if (!value) return null;
    return {
      left: Number(value.left) || 0,
      right: Number(value.right ?? value.left) || 0,
      top: Number(value.top) || 0,
      bottom: Number(value.bottom ?? value.top) || 0
    };
  }

  function positionAutocompleteReferencePopup(anchorValue, ownerValue) {
    if (!captionReferencePopup || captionReferencePopup.hidden) return;
    const anchor = normalizedPopupRect(anchorValue);
    const owner = normalizedPopupRect(ownerValue);
    if (!anchor || !owner) return;
    autocompleteReferenceAnchorRect = anchor;
    autocompleteReferenceOwnerRect = owner;
    captionReferencePopupAnchorRect = anchor;

    captionReferencePopup.classList.remove("smarttex-reference-popup-compact");
    captionReferencePopup.style.removeProperty("width");
    captionReferencePopup.style.removeProperty("max-width");
    let popupRect = captionReferencePopup.getBoundingClientRect();
    const margin = 10;
    const gap = 10;
    const availableRight = Math.max(0, window.innerWidth - margin - owner.right - gap);
    const availableLeft = Math.max(0, owner.left - gap - margin);
    let left;

    if (popupRect.width <= availableRight) {
      left = owner.right + gap;
    } else if (popupRect.width <= availableLeft) {
      left = owner.left - gap - popupRect.width;
    } else {
      // Keep the selected-item preview next to the completion list rather than
      // covering it. When neither side has enough room, compact the preview and
      // use the wider side. Figures, tables, equations, and text scale down with it.
      const useRight = availableRight >= availableLeft;
      const available = Math.max(180, useRight ? availableRight : availableLeft);
      const compactWidth = Math.min(430, available);
      captionReferencePopup.classList.add("smarttex-reference-popup-compact");
      captionReferencePopup.style.width = `${Math.round(compactWidth)}px`;
      captionReferencePopup.style.maxWidth = `${Math.round(compactWidth)}px`;
      globalThis.SmartTeXFigureRenderer?.fitPopupLayout?.(
        captionReferencePopup.querySelector(".smarttex-figure-layout")
      );
      popupRect = captionReferencePopup.getBoundingClientRect();
      left = useRight
        ? Math.min(window.innerWidth - margin - popupRect.width, owner.right + gap)
        : Math.max(margin, owner.left - gap - popupRect.width);
    }

    const top = Math.max(
      margin,
      Math.min(anchor.top - 8, window.innerHeight - popupRect.height - margin)
    );
    captionReferencePopup.style.left = `${Math.round(Math.max(margin, left))}px`;
    captionReferencePopup.style.top = `${Math.round(top)}px`;
  }

  function showReferenceAutocompletePreview(detailValue) {
    let detail = detailValue;
    if (typeof detailValue === "string") {
      try {
        detail = JSON.parse(detailValue);
      } catch (_error) {
        return;
      }
    }
    const label = String(detail?.label || "").trim();
    autocompleteReferenceCommandStart = Number.isFinite(Number(detail?.sourceIndex))
      ? Number(detail.sourceIndex)
      : null;
    const anchorRect = normalizedPopupRect(detail?.anchorRect);
    const ownerRect = normalizedPopupRect(detail?.ownerRect);
    if (!currentState || !label || !anchorRect || !ownerRect) return;
    const target = contextTools.referenceTarget?.(currentState.value, label);
    if (!target || !referenceTargetPreviewEnabled(target)) {
      autocompleteReferenceTargetKey = "";
      hideCaptionReferencePopup();
      return;
    }
    autocompleteReferenceTargetKey = referenceTargetKey(target, label);
    const spinnerGeneration = showPopupLoadingSpinner({
      clientX: (anchorRect.left + anchorRect.right) / 2,
      clientY: (anchorRect.top + anchorRect.bottom) / 2
    }, anchorRect);
    window.requestAnimationFrame(() => {
      try {
        renderEditorReferencePopup(anchorRect, {
          command: String(detail?.command || "ref"),
          labels: [label],
          sourceIndex: Number(target.sourceIndex) || 0,
          sourceEnd: Number(target.sourceIndex) || 0,
          type: "reference"
        });
        const popup = ensureCaptionReferencePopup();
        popup.dataset.smarttexAutocompleteOwner = "reference";
        positionAutocompleteReferencePopup(anchorRect, ownerRect);
      } finally {
        hidePopupLoadingSpinner(spinnerGeneration);
      }
    });
  }

  function hideReferenceAutocompletePreview() {
    if (
      captionReferencePopup?.dataset.smarttexAutocompleteOwner === "reference"
    ) {
      hideCaptionReferencePopup();
    }
    autocompleteReferenceTargetKey = "";
  }

  function configureFigurePopupImage(node, imageModel) {
    const localRatio = Number(imageModel?.width?.localRatio);
    const fixedWidth = Number(imageModel?.width?.fixedPx);
    const scale = Number(imageModel?.scale);
    node.dataset.smarttexLocalWidthRatio = String(
      Number.isFinite(localRatio) && localRatio > 0 ? localRatio : 1
    );
    if (Number.isFinite(fixedWidth) && fixedWidth > 0) {
      node.dataset.smarttexFixedWidthPx = String(fixedWidth);
    }
    const imageScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    node.dataset.smarttexImageScale = String(imageScale);
    if (Number.isFinite(fixedWidth) && fixedWidth > 0) {
      node.style.width = `${fixedWidth * imageScale}px`;
    } else {
      const widthPercent = Math.max(
        5,
        (Number.isFinite(localRatio) && localRatio > 0 ? localRatio : 1) * imageScale * 100
      );
      node.style.width = `${widthPercent}%`;
    }
  }

  function renderFigurePopup(
    context,
    figureNumber,
    captionText,
    macros,
    captionSourceOffset = null
  ) {
    const figure = document.createElement("figure");
    figure.className = "smarttex-figure-popup";
    const renderer = globalThis.SmartTeXFigureRenderer;
    const layoutModel = renderer?.parseFigureLayout?.(context.source || "", { environment: context.environment }) || {
      desiredWidthPx: 520,
      rows: []
    };
    const viewport = document.createElement("div");
    viewport.className = "smarttex-figure-popup-viewport";
    const media = document.createElement("div");
    media.className = "smarttex-figure-popup-media smarttex-figure-layout";
    media.dataset.smarttexDesiredWidthPx = String(layoutModel.desiredWidthPx || 520);

    let imageCount = 0;
    for (const rowModel of layoutModel.rows || []) {
      const row = document.createElement("div");
      row.className = "smarttex-figure-layout-row";
      const rowItems = rowModel.items || [];
      const relativeTotal = Math.max(
        0,
        Number(rowModel.relativeWidthRatio) || rowItems.reduce(
          (sum, item) => sum + (
            item.fixedWidthPx ? 0 : Math.max(0, Number(item.widthRatio) || 1)
          ),
          0
        )
      );
      const normalizeRelativeWidths = Boolean(
        rowModel.normalizeRelativeWidths ?? (
          !rowItems.some((item) => Number(item.fixedWidthPx) > 0) &&
          relativeTotal > 0
        )
      );
      for (const panelModel of rowItems) {
        const panel = document.createElement("div");
        panel.className = "smarttex-figure-layout-panel";
        const widthRatio = Math.max(0.05, Number(panelModel.widthRatio) || 1);
        panel.dataset.smarttexWidthRatio = String(widthRatio);
        panel.style.setProperty("--smarttex-panel-width-ratio", String(widthRatio));
        const rowFraction = normalizeRelativeWidths
          ? widthRatio / relativeTotal
          : widthRatio;
        panel.style.flexBasis = `${Math.min(135, rowFraction * 100)}%`;
        const fixedPanelWidth = Number(panelModel.fixedWidthPx);
        if (Number.isFinite(fixedPanelWidth) && fixedPanelWidth > 0) {
          panel.dataset.smarttexFixedPanelWidthPx = String(fixedPanelWidth);
          panel.style.setProperty(
            "--smarttex-panel-fixed-width",
            `${fixedPanelWidth}px`
          );
          panel.classList.add("smarttex-figure-layout-panel-fixed");
        }
        for (const imageModel of panelModel.images || []) {
          imageCount += 1;
          const placeholder = figurePopupPlaceholder(imageModel.path, true);
          configureFigurePopupImage(placeholder, imageModel);
          panel.appendChild(placeholder);
          resolveFigurePopupFile(imageModel.path, placeholder);
        }
        row.appendChild(panel);
      }
      media.appendChild(row);
    }
    if (!imageCount) {
      const row = document.createElement("div");
      row.className = "smarttex-figure-layout-row";
      const panel = document.createElement("div");
      panel.className = "smarttex-figure-layout-panel";
      panel.dataset.smarttexWidthRatio = "1";
      panel.style.setProperty("--smarttex-panel-width-ratio", "1");
      panel.style.flexBasis = "100%";
      panel.appendChild(figurePopupPlaceholder("No image in this figure"));
      row.appendChild(panel);
      media.appendChild(row);
    }
    viewport.appendChild(media);
    figure.appendChild(viewport);
    appendPopupCaption(
      figure,
      "Fig.",
      figureNumber,
      captionText,
      macros,
      captionSourceOffset
    );
    renderer?.observePopupLayout?.(media);
    return figure;
  }

  function trustedKatexCommand(context) {
    return (
      context?.command === "\\htmlClass" &&
      [
        "smarttex-rendered-caret",
        "smarttex-rendered-operator-caret",
        "smarttex-popup-selection"
      ].includes(
        context?.class
      )
    );
  }


  function clearPopupSelectionHighlight(root = output) {
    try {
      globalThis.CSS?.highlights?.delete?.(POPUP_SELECTION_HIGHLIGHT);
    } catch (_error) {
      // CSS Highlights are optional; class-based fallbacks are removed below.
    }
    root?.querySelectorAll?.(".smarttex-popup-source-selected").forEach((node) => {
      node.classList.remove("smarttex-popup-source-selected");
    });
  }

  function sourceSelectionForContext(state, context) {
    const range = contextEnvironmentRange(context);
    return sourceSelectionForRange(state, range.openStart, range.closeEnd);
  }

  function sourceSelectionForRange(state, rangeStartValue, rangeEndValue) {
    const start = Math.min(
      Number(state?.selectionFrom ?? state?.cursorIndex) || 0,
      Number(state?.selectionTo ?? state?.cursorIndex) || 0
    );
    const end = Math.max(
      Number(state?.selectionFrom ?? state?.cursorIndex) || 0,
      Number(state?.selectionTo ?? state?.cursorIndex) || 0
    );
    if (end <= start) return null;
    const rangeStart = Math.max(0, Number(rangeStartValue) || 0);
    const rangeEnd = Math.max(rangeStart, Number(rangeEndValue) || 0);
    if (end <= rangeStart || start >= rangeEnd) return null;
    return { start, end };
  }

  function textNodeSelectionRange(node, selectionStart, selectionEnd) {
    const boundaries = node?.smarttexSourceBoundaries;
    if (!Array.isArray(boundaries) || boundaries.length !== node.length + 1) return null;
    let first = -1;
    let last = -1;
    for (let index = 0; index < node.length; index += 1) {
      const sourceStart = Math.min(boundaries[index], boundaries[index + 1]);
      const sourceEnd = Math.max(boundaries[index], boundaries[index + 1]);
      if (sourceEnd <= selectionStart || sourceStart >= selectionEnd) continue;
      if (first < 0) first = index;
      last = index + 1;
    }
    if (first < 0 || last <= first) return null;
    const range = document.createRange();
    range.setStart(node, first);
    range.setEnd(node, last);
    return range;
  }

  function applyPopupSelectionHighlight(root, state, context) {
    clearPopupSelectionHighlight(root);
    const selection = sourceSelectionForContext(state, context);
    if (!selection || !root) return;
    const ranges = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const range = textNodeSelectionRange(node, selection.start, selection.end);
      if (range) ranges.push(range);
    }
    if (ranges.length && globalThis.CSS?.highlights && globalThis.Highlight) {
      try {
        globalThis.CSS.highlights.set(
          POPUP_SELECTION_HIGHLIGHT,
          new Highlight(...ranges)
        );
      } catch (_error) {
        // Fall through to coarse element highlighting below.
      }
    }
    root.querySelectorAll("*").forEach((element) => {
      const sourceRange = element.smarttexSourceRange;
      if (!sourceRange) return;
      const overlaps = (
        Number(sourceRange.end) > selection.start &&
        Number(sourceRange.start) < selection.end
      );
      if (overlaps && ![...element.childNodes].some(
        (child) => child.nodeType === Node.TEXT_NODE && child.smarttexSourceBoundaries
      )) {
        element.classList.add("smarttex-popup-source-selected");
      }
    });
  }

  function errorMessage(error) {
    return String(error?.message || error || "The equation is temporarily incomplete.")
      .replace(/^KaTeX parse error:\s*/i, "")
      .slice(0, 500);
  }

  function positionPreviewAtCursor({ force = false, preferPointer = false } = {}) {
    const anchor = (preferPointer && lastPointerScreen) || activePreviewState?.screen || currentState?.screen;
    if (preview.hidden || !anchor) return;
    preview.dataset.anchorMode = preferPointer && lastPointerScreen
      ? "pointer"
      : "cursor";
    const margin = 12;
    const cursorLeft = Number(anchor.pageX) - window.scrollX;
    const cursorTop = Number(anchor.pageY) - window.scrollY;
    const lineHeight = Math.max(14, Number(anchor.lineHeight) || 16);
    const gap = lineHeight * 2;
    const cursorRect = {
      left: cursorLeft - 1,
      right: cursorLeft + 3,
      top: cursorTop,
      bottom: cursorTop + lineHeight
    };

    preview.classList.add("smarttex-preview-measuring");
    const rect = preview.getBoundingClientRect();
    const width = Math.min(rect.width || 360, window.innerWidth - margin * 2);
    const height = Math.min(rect.height || 100, window.innerHeight - margin * 2);
    const popupCoversCursor = (
      rect.left < cursorRect.right &&
      rect.right > cursorRect.left &&
      rect.top < cursorRect.bottom &&
      rect.bottom > cursorRect.top
    );
    const popupLeavesViewport = (
      rect.left < margin ||
      rect.right > window.innerWidth - margin ||
      rect.top < margin ||
      rect.bottom > window.innerHeight - margin
    );

    if (!force && verticalScrollRepositionPending && previewPositioned) {
      const followsAbove = preview.dataset.placement === "above";
      const top = followsAbove
        ? cursorTop - gap - height
        : cursorTop + lineHeight + gap;
      preview.style.top = `${Math.round(top)}px`;
      verticalScrollRepositionPending = false;
      preview.classList.remove("smarttex-preview-measuring");
      return;
    }

    if (!force && previewPositioned && !popupCoversCursor && !popupLeavesViewport) {
      preview.classList.remove("smarttex-preview-measuring");
      return;
    }

    const preferredLeft = previewPositioned && !force
      ? rect.left
      : cursorLeft - Math.min(48, width * 0.12);
    const left = Math.max(
      margin,
      Math.min(preferredLeft, window.innerWidth - width - margin)
    );
    const spaceAbove = cursorTop - gap - margin;
    const spaceBelow = window.innerHeight - (cursorTop + lineHeight + gap) - margin;
    const fitsAbove = spaceAbove >= height;
    const fitsBelow = spaceBelow >= height;
    let placeAbove;

    if (popupCoversCursor && preview.dataset.placement === "above") {
      placeAbove = !fitsBelow && fitsAbove;
    } else if (popupCoversCursor && preview.dataset.placement === "below") {
      placeAbove = fitsAbove || !fitsBelow;
    } else if (fitsAbove !== fitsBelow) {
      placeAbove = fitsAbove;
    } else {
      placeAbove = spaceAbove >= spaceBelow;
    }

    const top = placeAbove
      ? Math.max(margin, cursorTop - gap - height)
      : Math.min(window.innerHeight - height - margin, cursorTop + lineHeight + gap);

    preview.dataset.placement = placeAbove ? "above" : "below";
    preview.style.left = `${Math.round(left)}px`;
    preview.style.top = `${Math.round(Math.max(margin, top))}px`;
    previewPositioned = true;
    verticalScrollRepositionPending = false;
    preview.classList.remove("smarttex-preview-measuring");
  }

  function environmentPopupContext(context) {
    if (!context?.environment) return false;
    return (
      context.kind === "environment" ||
      context.kind === "table" ||
      context.kind === "figure"
    );
  }

  function environmentBoundaryIndex(context, closing = false) {
    if (!closing && Number.isFinite(Number(context?.floatOpenStart))) {
      return Math.max(0, Number(context.floatOpenStart));
    }
    if (closing && Number.isFinite(Number(context?.floatContentEnd))) {
      return Math.max(0, Number(context.floatContentEnd));
    }
    if (!closing) return Math.max(0, Number(context?.openStart) || 0);
    const contentEnd = Number(context?.contentEnd);
    if (Number.isFinite(contentEnd)) return Math.max(0, contentEnd);
    return Math.max(0, Number(context?.closeEnd) || 0);
  }

  async function editorCoordinateAt(index) {
    try {
      const response = await bridgeRequest("getCoordinates", { index }, 1200);
      return response?.screen || null;
    } catch (_error) {
      return null;
    }
  }

  function positionPreviewAtEnvironment(openingScreen, closingScreen) {
    if (preview.hidden || (!openingScreen && !closingScreen)) return false;
    const margin = 12;
    const defaultLineHeight = Math.max(
      14,
      Number(activePreviewState?.screen?.lineHeight || currentState?.screen?.lineHeight) || 16
    );
    const opening = openingScreen ? {
      left: Number(openingScreen.pageX) - window.scrollX,
      top: Number(openingScreen.pageY) - window.scrollY,
      lineHeight: Math.max(14, Number(openingScreen.lineHeight) || defaultLineHeight)
    } : null;
    const closing = closingScreen ? {
      left: Number(closingScreen.pageX) - window.scrollX,
      top: Number(closingScreen.pageY) - window.scrollY,
      lineHeight: Math.max(14, Number(closingScreen.lineHeight) || defaultLineHeight)
    } : null;

    preview.classList.add("smarttex-preview-measuring");
    const rect = preview.getBoundingClientRect();
    const width = Math.min(rect.width || 360, window.innerWidth - margin * 2);
    const height = Math.min(rect.height || 100, window.innerHeight - margin * 2);
    const openingGap = Math.max(12, Math.round((opening?.lineHeight || defaultLineHeight) * 0.75));
    const closingGap = Math.max(12, Math.round((closing?.lineHeight || defaultLineHeight) * 0.75));
    const spaceAbove = opening ? opening.top - openingGap - margin : -Infinity;
    const closingBottom = closing ? closing.top + closing.lineHeight : Infinity;
    const spaceBelow = closing
      ? window.innerHeight - closingBottom - closingGap - margin
      : -Infinity;
    const fitsAbove = Boolean(opening) && spaceAbove >= height;
    const fitsBelow = Boolean(closing) && spaceBelow >= height;

    if (!fitsAbove && !fitsBelow) {
      preview.classList.remove("smarttex-preview-measuring");
      return false;
    }

    const placeAbove = fitsAbove && (!fitsBelow || spaceAbove >= spaceBelow);
    const anchor = placeAbove ? opening : closing;
    const preferredLeft = anchor.left - Math.min(48, width * 0.12);
    const left = Math.max(
      margin,
      Math.min(preferredLeft, window.innerWidth - width - margin)
    );
    const top = placeAbove
      ? opening.top - openingGap - height
      : closingBottom + closingGap;

    preview.dataset.placement = placeAbove ? "above" : "below";
    preview.dataset.anchorMode = "environment";
    preview.style.left = `${Math.round(left)}px`;
    preview.style.top = `${Math.round(Math.max(
      margin,
      Math.min(top, window.innerHeight - height - margin)
    ))}px`;
    previewPositioned = true;
    verticalScrollRepositionPending = false;
    preview.classList.remove("smarttex-preview-measuring");
    return true;
  }

  function positionPreview() {
    if (preview.hidden) return;
    const context = activePreviewContext;
    if (!environmentPopupContext(context)) {
      previewPositionGeneration += 1;
      positionPreviewAtCursor();
      return;
    }

    const generation = ++previewPositionGeneration;
    const contextId = activeContextId;
    Promise.all([
      editorCoordinateAt(environmentBoundaryIndex(context, false)),
      editorCoordinateAt(environmentBoundaryIndex(context, true))
    ]).then(([openingScreen, closingScreen]) => {
      if (
        generation !== previewPositionGeneration ||
        preview.hidden ||
        contextId !== activeContextId
      ) return;
      // If the environment extends so far that the popup fits neither above
      // its \\begin line nor below its \\end line, the cursor is the only
      // useful visible anchor.
      if (!positionPreviewAtEnvironment(openingScreen, closingScreen)) {
        positionPreviewAtCursor({ force: true, preferPointer: true });
      }
    });
  }

  function showRenderError(contextId, context, error) {
    if (contextId !== activeContextId) return;
    preview.classList.toggle("smarttex-preview-stale", Boolean(lastSuccessfulMarkup));
    status.textContent = lastSuccessfulMarkup
      ? "Preview paused while the LaTeX source is incomplete."
      : "Waiting for valid LaTeX…";
    status.title = errorMessage(error);
    status.hidden = false;

    if (lastSuccessfulMarkup) {
      output.innerHTML = lastSuccessfulMarkup;
    } else {
      output.replaceChildren();
      const fallback = document.createElement("code");
      fallback.className = "smarttex-equation-source-fallback";
      fallback.textContent = context.source.trim() || " ";
      output.appendChild(fallback);
    }
    preview.hidden = false;
    preview.classList.add("smarttex-preview-visible");
    window.requestAnimationFrame(() => positionPreview());
  }

  async function renderPreview(generation, loadingGeneration = null) {
    const taskToken = interactionTasks?.begin?.("popup-preview-render") || null;
    try {
    renderTimer = null;
    await Promise.all([katexFontsReady, featureSettingsReady, popupSettingsReady]);
    taskCheckpoint(0, 1, taskToken);
    const state = previewStateForRender();
    if (generation !== renderGeneration || !stateCanShowPreview(state)) {
      hidePreview();
      return;
    }

    const context = findPreviewContext(state);
    taskCheckpoint(0, 1, taskToken);
    if (!context) {
      hidePreview();
      return;
    }

    const contextId = previewContextId(state, context);
    activePreviewContext = context;
    activePreviewState = state;
    if (previewContextIsDismissed(state, context)) {
      hidePreview({ clearDismissal: false });
      return;
    }
    const contextChanged = contextId !== activeContextId;
    const previewScrollState = contextChanged
      ? []
      : capturePopupScrollState(preview);
    if (contextChanged) {
      activeContextId = contextId;
      caretPlacementState = null;
      lastSuccessfulMarkup = "";
      previewPositioned = false;
      verticalScrollRepositionPending = false;
      output.replaceChildren();
    }
    const isTable = context.kind === "table";
    const isFigure = context.kind === "figure";
    const previewKind = isFigure ? "figure" : isTable ? "table" : "equation";
    preview.dataset.previewKind = previewKind;
    previewTitle.textContent = isFigure
      ? "Figure preview"
      : isTable
        ? "Table preview"
        : "Equation preview";
    preview.setAttribute(
      "aria-label",
      isFigure
        ? "Live figure preview"
        : isTable
          ? "Live table preview"
          : "Live equation preview"
    );
    const equationRenderData = !isFigure && !isTable
      ? equationRenderDataForState(state, context)
      : null;
    taskCheckpoint(0, 1, taskToken);
    const numbering = isFigure
      ? { figureNumber: contextTools.figurePreviewNumber(state.value, context) }
      : isTable
        ? { tableNumber: contextTools.tablePreviewNumber(state.value, context) }
        : equationRenderData.numbering;
    const floatCaption = isFigure || isTable
      ? contextTools.floatCaption(
        state.value,
        context,
        isTable ? "table" : "figure"
      )
      : null;
    if (isFigure && numbering.figureNumber !== null) {
      previewMeta.textContent = `Figure ${numbering.figureNumber}`;
      previewMeta.title = "Figure number inferred from this LaTeX file";
      previewMeta.hidden = false;
    } else if (isTable && numbering.tableNumber !== null) {
      previewMeta.textContent = `Table ${numbering.tableNumber}`;
      previewMeta.title = "Table number inferred from this LaTeX file";
      previewMeta.hidden = false;
    } else {
      previewMeta.textContent = "";
      previewMeta.removeAttribute("title");
      previewMeta.hidden = true;
    }

    const activeSelection = (
      sourceSelectionForContext(state, context) ||
      (floatCaption
        ? sourceSelectionForRange(state, floatCaption.start, floatCaption.end)
        : null)
    );
    const hasSelection = Boolean(activeSelection);
    caretPlacementState = (isFigure || hasSelection)
      ? null
      : contextTools.resolveCaretPlacement(
        context.source,
        context.cursorOffset,
        caretPlacementState
      );
    let equationRenderContext = context;
    if (!isTable && !isFigure && hasSelection) {
      const relativeStart = Math.max(
        0,
        Math.min(context.source.length, activeSelection.start - context.contentStart)
      );
      const relativeEnd = Math.max(
        relativeStart,
        Math.min(context.source.length, activeSelection.end - context.contentStart)
      );
      equationRenderContext = {
        ...context,
        source: (
          context.source.slice(0, relativeStart) +
          "\\htmlClass{smarttex-popup-selection}{" +
          context.source.slice(relativeStart, relativeEnd) +
          "}" +
          context.source.slice(relativeEnd)
        )
      };
    }
    const unpreparedBody = isTable || isFigure
      ? floatCaption?.text || ""
      : contextTools.previewBody(
        equationRenderContext,
        caretPlacementState?.commandSide || null,
        numbering,
        !hasSelection
      );
    let documentCommands;
    try {
      documentCommands = (
        equationRenderData?.commandContext &&
        typeof contextTools.applyPreparedDocumentCommands === "function"
      )
        ? contextTools.applyPreparedDocumentCommands(
          equationRenderData.commandContext,
          unpreparedBody
        )
        : contextTools.prepareDocumentCommands(
          state.value,
          context.openStart,
          unpreparedBody
        );
    } catch (error) {
      if (interactionTasks?.isAbortError?.(error)) throw error;
      console.warn(
        "SmartTeX could not prepare all document commands; rendering with the compatible subset:",
        error
      );
      documentCommands = {
        body: unpreparedBody,
        macros: { "\\ensuremath": "#1" },
        count: 0
      };
    }
    const staging = document.createElement("div");
    taskCheckpoint(0, 1, taskToken);
    const cursorInsideOperator = Boolean(
      !isFigure &&
      !hasSelection &&
      (
        contextTools.cursorInsideControlSequence?.(
          context.source,
          context.cursorOffset
        ) ||
        contextTools.cursorAtProtectedAtomBoundary?.(
          context.source,
          context.cursorOffset
        )
      )
    );
    const macros = {
      ...documentCommands.macros,
      "\\label": { tokens: [], numArgs: 1 },
      "\\nonumber": "",
      "\\notag": "",
      "\\SmartTeXCaret": `\\htmlClass{${
        cursorInsideOperator
          ? "smarttex-rendered-operator-caret"
          : "smarttex-rendered-caret"
      }}{\\vphantom{|}}`,
      "\\SmartTeXOperatorCaret":
        "\\htmlClass{smarttex-rendered-operator-caret}{\\vphantom{|}}"
    };

    try {
      if (isFigure) {
        staging.appendChild(renderFigurePopup(
          context,
          numbering.figureNumber,
          documentCommands.body,
          macros,
          floatCaption?.start
        ));
      } else if (isTable) {
        const tablePopup = document.createElement("figure");
        tablePopup.className = "smarttex-table-popup";
        tablePopup.appendChild(tableRenderer.renderTable(context, {
          commandSide: caretPlacementState?.commandSide || null,
          includeCaret: !hasSelection && context.cursorInsideTable !== false,
          contextTools,
          document,
          katex,
          macros,
          trust: trustedKatexCommand,
          sourceOffset: context.contentStart
        }));
        appendPopupCaption(
          tablePopup,
          "Table",
          numbering.tableNumber,
          documentCommands.body,
          macros,
          floatCaption?.start
        );
        staging.appendChild(tablePopup);
      } else {
        katex.render(documentCommands.body, staging, {
          displayMode: Boolean(context.display),
          throwOnError: true,
          strict: "ignore",
          trust: trustedKatexCommand,
          maxExpand: 1000,
          maxSize: 25,
          macros
        });
      }
    } catch (error) {
      if (interactionTasks?.isAbortError?.(error)) throw error;

      // The rendered caret is represented by an injected KaTeX macro. Most
      // syntax-sensitive regions are relocated to a safe boundary by
      // SmartTeXLatexContext, but a document-specific macro may still reject a
      // marker inside one of its arguments. The source equation itself must
      // never become unrenderable merely because of the cursor position, so
      // retry the unchanged equation without the visual caret before showing
      // an error.
      if (!isFigure && !isTable && !hasSelection) {
        try {
          const fallbackBody = contextTools.previewBody(
            equationRenderContext,
            null,
            numbering,
            false
          );
          const fallbackCommands = (
            equationRenderData?.commandContext &&
            typeof contextTools.applyPreparedDocumentCommands === "function"
          )
            ? contextTools.applyPreparedDocumentCommands(
              equationRenderData.commandContext,
              fallbackBody
            )
            : contextTools.prepareDocumentCommands(
              state.value,
              context.openStart,
              fallbackBody
            );
          const fallbackMacros = {
            ...fallbackCommands.macros,
            "\\label": { tokens: [], numArgs: 1 },
            "\\nonumber": "",
            "\\notag": "",
            "\\SmartTeXCaret": macros["\\SmartTeXCaret"],
            "\\SmartTeXOperatorCaret": macros["\\SmartTeXOperatorCaret"]
          };
          staging.replaceChildren();
          katex.render(fallbackCommands.body, staging, {
            displayMode: Boolean(context.display),
            throwOnError: true,
            strict: "ignore",
            trust: trustedKatexCommand,
            maxExpand: 1000,
            maxSize: 25,
            macros: fallbackMacros
          });
        } catch (fallbackError) {
          if (interactionTasks?.isAbortError?.(fallbackError)) throw fallbackError;
          showRenderError(contextId, context, fallbackError);
          return;
        }
      } else {
        showRenderError(contextId, context, error);
        return;
      }
    }

    taskCheckpoint(0, 1, taskToken);
    if (generation !== renderGeneration || contextId !== activeContextId) return;
    lastSuccessfulMarkup = staging.innerHTML;
    output.replaceChildren(...staging.childNodes);
    restorePopupScrollState(preview, previewScrollState);
    applyPopupSelectionHighlight(output, state, context);
    globalThis.SmartTeXFigureRenderer?.observePopupLayout?.(
      output.querySelector(".smarttex-figure-layout")
    );
    status.hidden = true;
    status.removeAttribute("title");
    preview.classList.remove("smarttex-preview-stale");
    preview.hidden = false;
    preview.classList.add("smarttex-preview-visible");
    window.requestAnimationFrame(() => positionPreview());
    } finally {
      hidePreviewLoading(loadingGeneration);
      if (taskToken) interactionTasks?.end?.(taskToken);
    }
  }

  function runScheduledRender(generation, loadingGeneration = null) {
    Promise.resolve(renderPreview(generation, loadingGeneration)).catch((error) => {
      if (interactionTasks?.isAbortError?.(error)) return;
      console.error("SmartTeX editor popup rendering failed:", error);
      const state = previewStateForRender();
      if (generation !== renderGeneration || !stateCanShowPreview(state)) {
        return;
      }
      let context = null;
      try {
        context = findPreviewContext(state);
      } catch (_contextError) {
        // Without a context there is no meaningful source fallback to display.
      }
      if (!context) {
        hidePreview();
        return;
      }
      const contextId = previewContextId(state, context);
      activeContextId = contextId;
      showRenderError(contextId, context, error);
    });
  }

  function scheduleRender({ immediate = false } = {}) {
    if (renderTimer !== null) {
      window.clearTimeout(renderTimer);
      renderTimer = null;
    }
    hidePreviewLoading();
    renderGeneration += 1;
    const generation = renderGeneration;
    const loadingGeneration = stateCanShowPreview(previewStateForRender())
      ? showPreviewLoading()
      : null;
    if (immediate) {
      // The page bridge already coalesces duplicate cursor callbacks in a
      // microtask. Do not add a timeout before moving the rendered caret.
      queueMicrotask(() => {
        if (generation === renderGeneration) {
          runScheduledRender(generation, loadingGeneration);
        } else {
          hidePreviewLoading(loadingGeneration);
        }
      });
      return;
    }
    renderTimer = window.setTimeout(
      () => runScheduledRender(generation, loadingGeneration),
      SOURCE_RENDER_DELAY_MS
    );
  }



  function clearEnvironmentHoverPreview({ hide = true } = {}) {
    window.clearTimeout(environmentHoverTimer);
    environmentHoverTimer = null;
    environmentHoverGeneration += 1;
    hoverPreviewState = null;
    for (const [contextId, range] of dismissedPreviewContexts) {
      if (range?.hover) dismissedPreviewContexts.delete(contextId);
    }
    if (hide && environmentPopupUsesHover()) hidePreview();
  }

  function pointerIsInsidePreviewSurface(element) {
    return Boolean(
      preview.contains(element) ||
      referencePopupContains(element) ||
      autocompleteSurface(element)
    );
  }

  function pointerIsInsideEditorControl(element) {
    return Boolean(element?.closest?.(
      ".ace_search, .cm-panels, .cm-panel, " +
      "[class*='search-panel'], [class*='searchPanel']"
    ));
  }

  function scheduleEnvironmentPreviewHover(event) {
    if (!environmentPopupUsesHover()) return;
    if (pointerIsInsidePreviewSurface(event.target)) {
      window.clearTimeout(environmentHoverTimer);
      environmentHoverTimer = null;
      return;
    }

    const surface = editorSurface(event.target);
    if (pointerIsInsideEditorControl(event.target) || !currentState) {
      clearEnvironmentHoverPreview();
      return;
    }
    if (!surface) {
      window.clearTimeout(environmentHoverTimer);
      const generation = ++environmentHoverGeneration;
      environmentHoverTimer = window.setTimeout(() => {
        if (
          generation !== environmentHoverGeneration ||
          previewPointerInside ||
          elementIsHovered(preview) ||
          popupChainIsHovered()
        ) return;
        clearEnvironmentHoverPreview();
      }, 180);
      return;
    }

    window.clearTimeout(environmentHoverTimer);
    const generation = ++environmentHoverGeneration;
    const clientX = Number(event.clientX);
    const clientY = Number(event.clientY);
    const lineHeight = Math.max(
      14,
      parseFloat(getComputedStyle(surface).lineHeight) ||
      Number(currentState?.screen?.lineHeight) ||
      18
    );
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;

    environmentHoverTimer = window.setTimeout(() => {
      bridgeRequest("getIndexAtCoordinates", { clientX, clientY }, 1200)
        .then((response) => {
          if (
            generation !== environmentHoverGeneration ||
            !environmentPopupUsesHover() ||
            !currentState ||
            !Number.isInteger(Number(response?.index))
          ) return;

          const index = Math.max(
            0,
            Math.min(Number(response.index), String(currentState.value || "").length)
          );
          hoverPreviewState = {
            ...currentState,
            smarttexHoverPreview: true,
            focused: true,
            cursorIndex: index,
            selectionFrom: index,
            selectionTo: index,
            selectionAnchor: index,
            selectionHead: index,
            screen: {
              pageX: clientX + window.scrollX,
              pageY: clientY + window.scrollY - lineHeight * 0.45,
              lineHeight
            }
          };
          scheduleRender();
        })
        .catch(() => {
          if (generation === environmentHoverGeneration) {
            clearEnvironmentHoverPreview();
          }
        });
    }, 65);
  }

  window.addEventListener(REFERENCE_AUTOCOMPLETE_PREVIEW_EVENT, (event) => {
    showReferenceAutocompletePreview(event.detail);
  });
  window.addEventListener(REFERENCE_AUTOCOMPLETE_PREVIEW_HIDE_EVENT, (event) => {
    let detail = null;
    try {
      detail = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      detail = null;
    }
    if (referenceAutocompleteActive && !detail?.force) return;
    hideReferenceAutocompletePreview();
  });
  window.addEventListener(REFERENCE_AUTOCOMPLETE_ACTIVE_EVENT, (event) => {
    let detail = null;
    try {
      detail = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      detail = null;
    }
    referenceAutocompleteActive = Boolean(detail?.active);
    if (referenceAutocompleteActive) {
      window.clearTimeout(editorReferenceHoverTimer);
      editorReferenceHoverGeneration += 1;
      // Opening or updating the reference list should close a pre-existing
      // editor-hover popup, but it must not close the preview that belongs to
      // the selected autocomplete entry.
      hideNormalReferencePopupForAutocomplete();
    } else {
      autocompleteReferenceCommandStart = null;
      autocompleteReferenceTargetKey = "";
      activeSecondaryEditorReferenceKey = "";
      hideNestedReferencePopupsFromDepth(1);
    }
    if (popupsSuppressedAfterEditorScroll) {
      hidePreview();
      return;
    }
    const previewState = previewStateForRender();
    if (stateCanShowPreview(previewState)) scheduleRender();
    else hidePreview();
  });

  window.addEventListener(STATE_EVENT, (event) => {
    const previousState = currentState;
    const previousSource = String(previousState?.value || "");
    const previousFileName = String(previousState?.fileName || "");
    try {
      currentState = JSON.parse(String(event.detail || "null"));
    } catch (_error) {
      hoverPreviewState = null;
      hidePreview();
      hideCaptionReferencePopup();
      return;
    }

    if (!popupInteractionReady()) {
      hoverPreviewState = null;
      hidePreview();
      hideCaptionReferencePopup();
      return;
    }

    const currentSource = String(currentState?.value || "");
    const currentFileName = String(currentState?.fileName || "");
    const sourceChanged = (
      previousSource !== currentSource ||
      previousFileName !== currentFileName
    );
    const cursorChanged = (
      Number(previousState?.cursorIndex) !== Number(currentState?.cursorIndex) ||
      Number(previousState?.selectionFrom) !== Number(currentState?.selectionFrom) ||
      Number(previousState?.selectionTo) !== Number(currentState?.selectionTo)
    );
    const focusChanged = Boolean(previousState?.focused) !== Boolean(currentState?.focused);

    if (popupsSuppressedAfterEditorScroll) {
      if (sourceChanged || cursorChanged || focusChanged) {
        popupsSuppressedAfterEditorScroll = false;
      } else {
        // A screen-coordinate-only state update is the normal consequence of
        // scrolling. Keep every popup closed instead of restoring it at the new
        // location. Source highlights and badges are handled independently.
        return;
      }
    }

    scheduleGraphicAutocompletePreviewUpdate();

    if (referencePopupUsesHover()) {
      if (
        activeEditorReferenceKey &&
        (
          sourceChanged ||
          (
            activeEditorReferenceType === "citation" &&
            cursorIsInsideCitationCommand(currentState)
          )
        )
      ) {
        hideCaptionReferencePopup();
      }
    } else {
      updateCursorTriggeredReferencePopup(currentState);
    }

    if (environmentPopupUsesHover()) {
      if (hoverPreviewState) {
        hoverPreviewState = {
          ...hoverPreviewState,
          value: currentState.value,
          fileName: currentState.fileName,
          focused: true
        };
        if (stateCanShowPreview(hoverPreviewState)) {
          scheduleRender({ immediate: !sourceChanged });
        } else {
          clearEnvironmentHoverPreview();
        }
      } else {
        hidePreview();
      }
      return;
    }

    hoverPreviewState = null;
    if (!stateCanShowPreview(currentState)) {
      hidePreview();
      return;
    }

    // A scroll/layout update can emit a new screen position without changing
    // source, cursor, or selection. Re-anchor the existing popup only; do not
    // invoke KaTeX or any document analysis for that event.
    if (
      !sourceChanged &&
      !cursorChanged &&
      !focusChanged &&
      activePreviewContext &&
      activePreviewState
    ) {
      activePreviewState = currentState;
      window.requestAnimationFrame(() => positionPreview());
      return;
    }

    scheduleRender({ immediate: !sourceChanged });
  });

  closeButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
  });
  closeButton.addEventListener("click", dismissPreview);

  document.addEventListener("keydown", (event) => {
    popupsSuppressedAfterEditorScroll = false;
    if (event.key !== "Escape") return;
    if (!preview.hidden) dismissPreview();
    if (captionReferencePopup && !captionReferencePopup.hidden) {
      hideCaptionReferencePopup();
    }
  }, true);
  document.addEventListener("pointermove", (event) => {
    popupsSuppressedAfterEditorScroll = false;
    const clientX = Number(event.clientX);
    const clientY = Number(event.clientY);
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      lastPointerScreen = {
        pageX: clientX + window.scrollX,
        pageY: clientY + window.scrollY,
        lineHeight: Math.max(14, Number(currentState?.screen?.lineHeight) || 16)
      };
    }
    scheduleEditorReferenceHover(event);
    scheduleEnvironmentPreviewHover(event);
  }, true);
  document.addEventListener("pointerdown", (event) => {
    popupsSuppressedAfterEditorScroll = false;
    if (
      referencePopupContains(event.target) ||
      autocompleteSurface(event.target) ||
      editorSurface(event.target)
    ) return;
    hideCaptionReferencePopup();
  }, true);

  window.addEventListener("pointerup", () => {
    if (!referencePopupPointerDown) return;
    referencePopupPointerDown = false;
    noteReferencePopupInteraction(400);
  }, true);
  window.addEventListener("pointercancel", () => {
    referencePopupPointerDown = false;
    noteReferencePopupInteraction(250);
  }, true);
  window.addEventListener("blur", () => {
    referencePopupPointerDown = false;
  });

  window.addEventListener(COMMENTS_INITIALIZATION_STATE_EVENT, (event) => {
    const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
    commentsInitializationActive = detail.active === true;
    if (!commentsInitializationActive) {
      window.clearTimeout(commentsInitializationFailSafe);
      commentsInitializationFailSafe = 0;
    }
    updateToolbarLoadingSpinner();
  });

  window.addEventListener(REVIEW_HYDRATION_STATE_EVENT, (event) => {
    let detail = {};
    try {
      detail = typeof event?.detail === "string"
        ? JSON.parse(event.detail)
        : (event?.detail || {});
    } catch (_error) {
      detail = {};
    }
    reviewHydrationActive = detail.active === true;
    if (!reviewHydrationActive) {
      window.clearTimeout(reviewHydrationFailSafe);
      reviewHydrationFailSafe = 0;
    }
    updateToolbarLoadingSpinner();
  });

  window.addEventListener(STRUCTURE_ANALYSIS_STATE_EVENT, (event) => {
    let detail = {};
    try {
      detail = typeof event?.detail === "string"
        ? JSON.parse(event.detail)
        : (event?.detail || {});
    } catch (_error) {
      detail = {};
    }
    setStructureSpinnerActive(detail.active === true);
  });

  const structureAnalysisStateObserver = new MutationObserver(() => {
    setStructureSpinnerActive(
      document.documentElement.dataset.smarttexStructureAnalysis === "pending"
    );
  });
  structureAnalysisStateObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-smarttex-structure-analysis"]
  });

  updateToolbarLoadingSpinner();

  optionsButton.addEventListener("click", () => {
    if (typeof extensionApi?.runtime?.sendMessage === "function") {
      Promise.resolve(
        extensionApi.runtime.sendMessage({ type: "smarttex-open-options" })
      ).catch(() => {});
      return;
    }
    extensionApi?.runtime?.openOptionsPage?.();
  });
  popupSettingsReady.then(() => {
    if (popupsSuppressedAfterEditorScroll) return;
    if (!referencePopupUsesHover()) updateCursorTriggeredReferencePopup(currentState);
    if (!environmentPopupUsesHover() && stateCanShowPreview(currentState)) {
      scheduleRender();
    }
  });
  attachOptionsButton();
  const optionsButtonObserver = new MutationObserver(attachOptionsButton);
  optionsButtonObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  // Observe only insertion/removal of autocomplete DOM. Watching class and
  // style attributes across the complete application causes the callback to
  // run for every caret repaint and editor layout update. The resulting global
  // query plus computed-style/layout reads blocked ordinary typing. Keyboard
  // and pointer selection changes are already handled by the listeners below.
  const graphicAutocompleteObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === "childList")) {
      scheduleGraphicAutocompletePreviewUpdate();
    }
  });
  graphicAutocompleteObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("keyup", scheduleGraphicAutocompletePreviewUpdate, true);
  window.addEventListener(
    "smarttex:graphic-autocomplete-selection-change",
    scheduleGraphicAutocompletePreviewUpdate
  );
  document.addEventListener("pointermove", (event) => {
    const owner = nativeGraphicAutocompleteOwnerFromNode(event.target);
    const entry = hoveredNativeGraphicEntry(event.target, owner);
    const changed = (
      graphicAutocompleteHoveredOwner !== owner ||
      graphicAutocompleteHoveredEntry !== entry
    );
    graphicAutocompleteHoveredOwner = owner;
    graphicAutocompleteHoveredEntry = entry;
    if (owner || changed) scheduleGraphicAutocompletePreviewUpdate();
  }, { capture: true, passive: true });

  window.addEventListener(RUNTIME_SETTINGS_EVENT, (event) => {
    const detail = event?.detail || {};
    runtimeSettingsOverrideActive = detail.usingPresets === false;
    const features = detail.features || {};
    enabledFeatures.equations = features.equations !== false;
    enabledFeatures.tables = features.tables !== false;
    enabledFeatures.figures = features.figures !== false;

    const popupSettings = detail.referencePopups || {};
    referencePopupTrigger = popupSettings.trigger === "hover" ? "hover" : "cursor";
    environmentPopupTrigger = popupSettings.environmentTrigger === "hover" ? "hover" : "cursor";
    dispatchStructureHighlightSettings(detail.highlights || {});

    hidePreview();
    hideCaptionReferencePopup();
    hideNestedReferencePopupsFromDepth(1);
    if (!enabledFeatures.figures) hideGraphicAutocompletePreview();
    window.clearTimeout(editorReferenceHoverTimer);
    editorReferenceHoverGeneration += 1;
    window.clearTimeout(environmentHoverTimer);
    environmentHoverTimer = null;
    environmentHoverGeneration += 1;
    hoverPreviewState = null;

    if (!referencePopupUsesHover()) updateCursorTriggeredReferencePopup(currentState);
    const previewState = previewStateForRender();
    if (!environmentPopupUsesHover() && stateCanShowPreview(previewState)) scheduleRender();
  });

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!runtimeSettingsOverrideActive && changes?.[FEATURES_KEY]) {
      const features = changes[FEATURES_KEY].newValue;
      enabledFeatures.equations = features?.equations !== false;
      enabledFeatures.tables = features?.tables !== false;
      enabledFeatures.figures = features?.figures !== false;
      hidePreview();
      hideCaptionReferencePopup();
      hideNestedReferencePopupsFromDepth(1);
      if (!enabledFeatures.figures) hideGraphicAutocompletePreview();
      const previewState = previewStateForRender();
      if (stateCanShowPreview(previewState)) scheduleRender();
    }
    if (!runtimeSettingsOverrideActive && changes?.[REFERENCE_POPUPS_KEY]) {
      const settings = changes[REFERENCE_POPUPS_KEY].newValue || {};
      referencePopupTrigger = settings.trigger === "hover" ? "hover" : "cursor";
      environmentPopupTrigger = settings.environmentTrigger === "hover"
        ? "hover"
        : "cursor";
      hideCaptionReferencePopup();
      window.clearTimeout(editorReferenceHoverTimer);
      editorReferenceHoverGeneration += 1;
      window.clearTimeout(environmentHoverTimer);
      environmentHoverTimer = null;
      environmentHoverGeneration += 1;
      hoverPreviewState = null;
      hidePreview();
      if (!referencePopupUsesHover()) {
        updateCursorTriggeredReferencePopup(currentState);
      }
      if (!environmentPopupUsesHover() && stateCanShowPreview(currentState)) {
        scheduleRender();
      }
    }
    if (!runtimeSettingsOverrideActive && changes?.[STRUCTURE_HIGHLIGHT_KEY]) {
      dispatchStructureHighlightSettings(changes[STRUCTURE_HIGHLIGHT_KEY].newValue);
    }
  });

  window.addEventListener("resize", () => {
    positionPreview();
    repositionReferencePopups();
    scheduleGraphicAutocompletePreviewUpdate();
  }, { passive: true });
  window.addEventListener("smarttex:editor-scroll-state", (event) => {
    if (event?.detail?.active === true) {
      popupsSuppressedAfterEditorScroll = true;
      window.clearTimeout(editorReferenceHoverTimer);
      editorReferenceHoverGeneration += 1;
      window.clearTimeout(environmentHoverTimer);
      environmentHoverTimer = null;
      environmentHoverGeneration += 1;
      hoverPreviewState = null;
      hidePreview();
      hideCaptionReferencePopup();
      hideNestedReferencePopupsFromDepth(1);
      hideGraphicAutocompletePreview();
      return;
    }
    // Highlights and source-number badges are repositioned by page-bridge.js.
    // Popups are intentionally not restored after scrolling. They may open again
    // only after a subsequent cursor, keyboard, pointer or hover interaction.
  });
  window.addEventListener("scroll", (event) => {
    if (referencePopupContains(event.target)) {
      keepReferencePopupOpen(event);
      return;
    }
    if (environmentPopupUsesHover() && editorSurface(event.target)) {
      clearEnvironmentHoverPreview();
    }
    if (activeEditorReferenceKey) hideCaptionReferencePopup();
    if (preview.hidden || !previewPositioned) return;
    verticalScrollRepositionPending = true;

    // A document scroll changes the viewport-relative cursor position without
    // requiring a fresh editor state. Editor scrollers dispatch an updated
    // state through the page bridge, which positions the preview afterwards.
    if (
      event.target === window ||
      event.target === document ||
      event.target === document.scrollingElement ||
      event.target === document.documentElement
    ) {
      window.requestAnimationFrame(() => positionPreview());
    }
  }, { passive: true, capture: true });
  window.addEventListener(CITATION_REFRESH_RESULT_EVENT, (event) => {
    let detail = {};
    try {
      detail = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      return;
    }
    const pending = pendingCitationRefreshes.get(String(detail.requestId || ""));
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingCitationRefreshes.delete(String(detail.requestId || ""));
    if (pending.button?.isConnected) {
      pending.button.disabled = false;
      pending.button.classList.remove("smarttex-citation-popup-refreshing");
      pending.button.innerHTML = detail.ok
        ? '<span aria-hidden="true">✓</span> Refreshed'
        : '<span aria-hidden="true">↻</span> Refresh';
      pending.button.title = detail.message || "Re-parse bibliography files";
    }
    pending.resolve(detail.ok === true);
  });

  window.addEventListener(CITATION_CACHE_UPDATED_EVENT, () => {
    citationRecordsPromise = null;
    citationRecordsLoaded = false;
  });

  window.addEventListener("pagehide", () => {
    hideCaptionReferencePopup();
    hidePreview();
    for (const pending of pendingRequests.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("SmartTeX page closed."));
    }
    pendingRequests.clear();
  }, { once: true });
  window.addEventListener("pagehide", () => {
    optionsButtonObserver.disconnect();
    graphicAutocompleteObserver.disconnect();
    structureAnalysisStateObserver.disconnect();
    window.clearTimeout(structureSpinnerHideTimer);
    if (graphicAutocompleteUpdateFrame !== null) {
      window.cancelAnimationFrame(graphicAutocompleteUpdateFrame);
    }
    hideGraphicAutocompletePreview();
  }, { once: true });
  };

  initializeWhenDependenciesAreReady().catch((error) => {
    globalThis.__smartTeXPreviewLoading = false;
    console.error(error?.message || "SmartTeX: A preview renderer could not be loaded.", error);
  });
})();
