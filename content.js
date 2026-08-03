/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.__smartTeXPreviewLoaded) return;
  globalThis.__smartTeXPreviewLoaded = true;

  const STATE_EVENT = "smarttex:editor-state";
  const REQUEST_EVENT = "smarttex:citation-editor-request";
  const RESPONSE_EVENT = "smarttex:citation-editor-response";
  const FEATURES_KEY = "smarttex:features:v1";
  const RENDER_DELAY_MS = 24;
  const LATEX_FILE = /\.(?:tex|ltx|sty|cls)$/i;
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const contextTools = globalThis.SmartTeXLatexContext;
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

  if (!contextTools || !tableRenderer || !katex?.render) {
    console.error("SmartTeX: A preview renderer could not be loaded.");
    return;
  }

  const preview = document.createElement("aside");
  preview.id = "smarttex-equation-preview";
  preview.hidden = true;
  preview.setAttribute("role", "tooltip");
  preview.setAttribute("aria-label", "Live LaTeX preview");
  preview.innerHTML = `
    <div class="smarttex-preview-heading">
      <span class="smarttex-preview-title">Equation preview</span>
      <span class="smarttex-preview-heading-actions">
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
  const closeButton = preview.querySelector(".smarttex-preview-close");
  const optionsButton = document.createElement("button");
  optionsButton.id = "smarttex-options-button";
  optionsButton.type = "button";
  optionsButton.innerHTML = `
    <span class="smarttex-options-mark" aria-hidden="true">S</span>
    <span class="smarttex-options-menu-icon" aria-hidden="true">
      <span></span><span></span><span></span>
    </span>`;
  optionsButton.title = "Open SmartTeX options";
  optionsButton.setAttribute("aria-label", "Open SmartTeX options");
  let optionsButtonSlot = null;

  function attachOptionsButton() {
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
    if (optionsButton.parentElement !== optionsButtonSlot) {
      optionsButtonSlot.appendChild(optionsButton);
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
  let renderTimer = null;
  let renderGeneration = 0;
  let activeContextId = "";
  let dismissedContextId = "";
  let caretPlacementState = null;
  let lastSuccessfulMarkup = "";
  let previewPositioned = false;
  let verticalScrollRepositionPending = false;
  let requestCounter = 0;
  let captionReferencePopup = null;
  let captionReferencePopupTimer = null;
  let captionReferencePopupAnchor = null;
  let captionReferencePopupAnchorRect = null;
  const nestedCaptionReferencePopupStates = [];
  let editorReferenceHoverTimer = null;
  let editorReferenceHoverGeneration = 0;
  let activeEditorReferenceKey = "";
  let activeEditorReferenceType = "";
  let popupLoadingSpinner = null;
  let popupLoadingSpinnerGeneration = 0;
  let citationRecords = new Map();
  let citationRecordsPromise = null;
  let citationRecordsLoaded = false;
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

  function popupPointerPosition(event, anchor = null) {
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    if (Number.isFinite(clientX) && Number.isFinite(clientY) && (clientX || clientY)) {
      return { clientX, clientY };
    }
    const rect = anchor?.getBoundingClientRect?.() || anchor;
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

  function hidePreview({ clearDismissal = true } = {}) {
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
    verticalScrollRepositionPending = false;
    if (!activeEditorReferenceKey) hideCaptionReferencePopup();
    status.hidden = true;
    if (clearDismissal) dismissedContextId = "";
  }

  function dismissPreview() {
    if (preview.hidden) return;
    dismissedContextId = activeContextId;
    hidePreview({ clearDismissal: false });
  }

  function stateCanShowPreview(state) {
    if (
      !state ||
      !state.focused ||
      !Number.isInteger(state.cursorIndex) ||
      !state.screen ||
      state.selectionFrom !== state.selectionTo
    ) {
      return false;
    }
    const fileName = String(state.fileName || "").trim();
    return !fileName || LATEX_FILE.test(fileName);
  }

  function previewContextId(state, context) {
    return [
      state.fileName || "",
      context.openStart,
      context.kind,
      context.environment || context.delimiter || ""
    ].join(":");
  }

  function findPreviewContext(state) {
    return [
      enabledFeatures.equations
        ? contextTools.findEquationContext(state.value, state.cursorIndex)
        : null,
      enabledFeatures.tables
        ? contextTools.findTableContext(state.value, state.cursorIndex)
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
    placeholder.replaceWith(media);
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

  function appendPopupCaption(
    container,
    labelText,
    number,
    captionText,
    macros
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
      if (state.popup) state.popup.hidden = true;
    }
  }

  function hideCaptionReferencePopup() {
    hidePopupLoadingSpinner();
    window.clearTimeout(captionReferencePopupTimer);
    captionReferencePopupTimer = null;
    window.clearTimeout(editorReferenceHoverTimer);
    editorReferenceHoverGeneration += 1;
    activeEditorReferenceKey = "";
    activeEditorReferenceType = "";
    captionReferencePopupAnchor = null;
    captionReferencePopupAnchorRect = null;
    hideNestedReferencePopupsFromDepth(1);
    if (captionReferencePopup) {
      captionReferencePopup.hidden = true;
      captionReferencePopup.classList.remove("smarttex-editor-reference-popup");
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

  function keepReferencePopupOpen(event) {
    const depth = Math.max(0, popupDepthForElement(event?.target));
    clearReferencePopupTimersThrough(depth);
    window.clearTimeout(editorReferenceHoverTimer);
  }

  function bindReferencePopupInteractionGuards(popup) {
    popup.addEventListener("pointerenter", keepReferencePopupOpen);
    popup.addEventListener("pointerdown", keepReferencePopupOpen, true);
    popup.addEventListener("wheel", keepReferencePopupOpen, { passive: true });
    popup.addEventListener("scroll", keepReferencePopupOpen, { passive: true });
  }

  function scheduleHideCaptionReferencePopup() {
    window.clearTimeout(captionReferencePopupTimer);
    captionReferencePopupTimer = window.setTimeout(() => {
      if (popupChainIsHovered()) return;
      hideCaptionReferencePopup();
    }, 180);
  }

  function scheduleHideNestedReferencePopup(depth) {
    const state = nestedPopupState(depth);
    if (!state) return;
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
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
    }, 180);
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
    const below = captionReferencePopupAnchorRect.bottom + 8;
    const top = below + popupRect.height <= window.innerHeight - margin
      ? below
      : Math.max(
        margin,
        captionReferencePopupAnchorRect.top - popupRect.height - 8
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
    if (captionReferencePopupAnchorRect && captionReferencePopup && !captionReferencePopup.hidden) {
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

  function appendReferenceTargetPreview(container, target, source) {
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
      equation.className = "smarttex-reference-popup-target";
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
      return;
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
      return;
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
      return;
    }

    const card = document.createElement("div");
    card.className = "smarttex-reference-popup-target";
    if (target.title) card.textContent = target.title;
    else card.textContent = referencePopupTitle(target, target.label);
    container.appendChild(card);
  }

  function renderCaptionReferencePopup(anchor, target) {
    const parentDepth = popupDepthForElement(anchor);
    const depth = parentDepth + 1;
    if (!target || !currentState) return depth;
    const popup = depth === 0
      ? ensureCaptionReferencePopup()
      : ensureNestedCaptionReferencePopup(depth);

    if (depth === 0) {
      activeEditorReferenceKey = "";
      activeEditorReferenceType = "";
      captionReferencePopupAnchor = anchor?.isConnected ? anchor : null;
      popup.classList.remove("smarttex-editor-reference-popup");
    } else {
      const state = nestedPopupState(depth, true);
      state.anchor = anchor?.isConnected ? anchor : null;
      popup.classList.remove("smarttex-editor-reference-popup");
    }

    hideNestedReferencePopupsFromDepth(depth + 1);
    clearReferencePopupTimersThrough(depth);
    popup.replaceChildren();
    const entry = document.createElement("section");
    entry.className = "smarttex-reference-popup-entry";
    appendReferencePopupHeading(entry, target, target.label);
    appendReferenceTargetPreview(entry, target, String(currentState.value || ""));
    popup.appendChild(entry);
    popup.hidden = false;

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

  function editorReferenceEntry(popup, target, label, source, record = null) {
    const entry = document.createElement("section");
    entry.className = "smarttex-reference-popup-entry";
    appendReferencePopupHeading(entry, target, label);
    if (target.type === "citation") {
      entry.appendChild(citationPopupCard(record, target));
    } else {
      appendReferenceTargetPreview(entry, target, source);
    }
    popup.appendChild(entry);
  }

  function renderEditorReferencePopup(anchorRect, interaction) {
    if (!currentState || !interaction?.labels?.length) return;
    if (interaction.type === "citation" && cursorIsInsideCitationCommand()) {
      hideCaptionReferencePopup();
      return;
    }
    const source = String(currentState.value || "");
    const key = [
      currentState.fileName || "",
      interaction.sourceIndex,
      interaction.sourceEnd,
      interaction.labels.join(",")
    ].join(":");
    activeEditorReferenceKey = key;
    activeEditorReferenceType = interaction.type;
    captionReferencePopupAnchor = null;
    hideNestedReferencePopupsFromDepth(1);
    clearReferencePopupTimer(0);
    const popup = ensureCaptionReferencePopup();
    popup.classList.add("smarttex-editor-reference-popup");
    popup.replaceChildren();

    if (interaction.type === "citation") {
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

    popup.hidden = false;
    positionCaptionReferencePopup(anchorRect);

    if (interaction.type === "citation" && !citationRecordsLoaded) {
      loadCitationRecords().then(() => {
        if (
          activeEditorReferenceKey !== key ||
          popup.hidden ||
          !currentState
        ) return;
        renderEditorReferencePopup(anchorRect, interaction);
      });
    }
  }

  function editorSurface(element) {
    return element?.closest?.(
      ".cm-content, .cm-line, .cm-scroller, .cm-editor, " +
      ".ace_content, .ace_text-layer, .ace_scroller, .ace_editor"
    ) || null;
  }

  function scheduleEditorReferenceHover(event) {
    hidePopupLoadingSpinner();
    if (referencePopupContains(event.target)) {
      const depth = popupDepthForElement(event.target);
      clearReferencePopupTimersThrough(Math.max(0, depth));
      window.clearTimeout(editorReferenceHoverTimer);
      return;
    }
    const surface = editorSurface(event.target);
    if (!surface || !currentState) {
      if (activeEditorReferenceKey) scheduleHideCaptionReferencePopup();
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
              hideCaptionReferencePopup();
              return;
            }
            renderEditorReferencePopup(anchorRect, interaction);
          })
          .catch(() => {
            if (generation === editorReferenceHoverGeneration) {
              scheduleHideCaptionReferencePopup();
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
      bridgeRequest("setCursor", {
        index: target.sourceIndex,
        focus: true
      }).catch((error) => {
        console.warn("SmartTeX could not navigate to the caption reference:", error);
      });
    });
    let hoverPopupDepth = null;
    const show = (event) => {
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

  function renderFigurePopup(context, figureNumber, captionText, macros) {
    const figure = document.createElement("figure");
    figure.className = "smarttex-figure-popup";
    const paths = [...String(context.source || "").matchAll(
      /\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g
    )].map((match) => match[1].trim());
    const media = document.createElement("div");
    media.className = "smarttex-figure-popup-media";
    for (const path of paths) {
      const placeholder = figurePopupPlaceholder(path, true);
      media.appendChild(placeholder);
      resolveFigurePopupFile(path, placeholder);
    }
    if (!paths.length) media.appendChild(figurePopupPlaceholder("No image in this figure"));
    figure.appendChild(media);
    appendPopupCaption(figure, "Fig.", figureNumber, captionText, macros);
    return figure;
  }

  function trustedKatexCommand(context) {
    return (
      context?.command === "\\htmlClass" &&
      context?.class === "smarttex-rendered-caret"
    );
  }

  function errorMessage(error) {
    return String(error?.message || error || "The equation is temporarily incomplete.")
      .replace(/^KaTeX parse error:\s*/i, "")
      .slice(0, 500);
  }

  function positionPreview() {
    if (preview.hidden || !currentState?.screen) return;
    const anchor = currentState.screen;
    const margin = 12;
    const cursorLeft = Number(anchor.pageX) - window.scrollX;
    const cursorTop = Number(anchor.pageY) - window.scrollY;
    const lineHeight = Math.max(14, Number(anchor.lineHeight) || 16);
    const gap = Math.max(24, Math.round(lineHeight * 1.6));
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

    if (verticalScrollRepositionPending && previewPositioned) {
      const followsAbove = preview.dataset.placement === "above";
      const top = followsAbove
        ? cursorTop - gap - height
        : cursorTop + lineHeight + gap;
      preview.style.top = `${Math.round(top)}px`;
      verticalScrollRepositionPending = false;
      preview.classList.remove("smarttex-preview-measuring");
      return;
    }

    if (previewPositioned && !popupCoversCursor && !popupLeavesViewport) {
      preview.classList.remove("smarttex-preview-measuring");
      return;
    }

    const preferredLeft = previewPositioned
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
    window.requestAnimationFrame(positionPreview);
  }

  async function renderPreview(generation) {
    renderTimer = null;
    await Promise.all([katexFontsReady, featureSettingsReady]);
    if (generation !== renderGeneration || !stateCanShowPreview(currentState)) {
      hidePreview();
      return;
    }

    const state = currentState;
    const context = findPreviewContext(state);
    if (!context) {
      hidePreview();
      return;
    }

    const contextId = previewContextId(state, context);
    if (dismissedContextId === contextId) {
      preview.hidden = true;
      return;
    }
    if (dismissedContextId && dismissedContextId !== contextId) {
      dismissedContextId = "";
    }
    const contextChanged = contextId !== activeContextId;
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
    const numbering = isFigure
      ? { figureNumber: contextTools.figurePreviewNumber(state.value, context) }
      : isTable
        ? { tableNumber: contextTools.tablePreviewNumber(state.value, context) }
        : contextTools.equationPreviewNumbering(state.value, context);
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

    caretPlacementState = isFigure ? null : contextTools.resolveCaretPlacement(
      context.source,
      context.cursorOffset,
      caretPlacementState
    );
    const unpreparedBody = isTable || isFigure
      ? floatCaption?.text || ""
      : contextTools.previewBody(
        context,
        caretPlacementState.commandSide,
        numbering
      );
    let documentCommands;
    try {
      documentCommands = contextTools.prepareDocumentCommands(
        state.value,
        context.openStart,
        unpreparedBody
      );
    } catch (error) {
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
    const macros = {
      ...documentCommands.macros,
      "\\label": { tokens: [], numArgs: 1 },
      "\\nonumber": "",
      "\\notag": "",
      "\\SmartTeXCaret": "\\htmlClass{smarttex-rendered-caret}{\\vphantom{|}}"
    };

    try {
      if (isFigure) {
        staging.appendChild(renderFigurePopup(
          context,
          numbering.figureNumber,
          documentCommands.body,
          macros
        ));
      } else if (isTable) {
        const tablePopup = document.createElement("figure");
        tablePopup.className = "smarttex-table-popup";
        tablePopup.appendChild(tableRenderer.renderTable(context, {
          commandSide: caretPlacementState.commandSide,
          contextTools,
          document,
          katex,
          macros,
          trust: trustedKatexCommand
        }));
        appendPopupCaption(
          tablePopup,
          "Table",
          numbering.tableNumber,
          documentCommands.body,
          macros
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
      showRenderError(contextId, context, error);
      return;
    }

    if (generation !== renderGeneration || contextId !== activeContextId) return;
    lastSuccessfulMarkup = staging.innerHTML;
    output.replaceChildren(...staging.childNodes);
    status.hidden = true;
    status.removeAttribute("title");
    preview.classList.remove("smarttex-preview-stale");
    preview.hidden = false;
    preview.classList.add("smarttex-preview-visible");
    window.requestAnimationFrame(positionPreview);
  }

  function scheduleRender() {
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    renderGeneration += 1;
    const generation = renderGeneration;
    renderTimer = window.setTimeout(() => {
      Promise.resolve(renderPreview(generation)).catch((error) => {
        console.error("SmartTeX editor popup rendering failed:", error);
        if (generation !== renderGeneration || !stateCanShowPreview(currentState)) {
          return;
        }
        let context = null;
        try {
          context = findPreviewContext(currentState);
        } catch (_contextError) {
          // Without a context there is no meaningful source fallback to display.
        }
        if (!context) {
          hidePreview();
          return;
        }
        const contextId = previewContextId(currentState, context);
        activeContextId = contextId;
        showRenderError(contextId, context, error);
      });
    }, RENDER_DELAY_MS);
  }

  window.addEventListener(STATE_EVENT, (event) => {
    const previousSource = String(currentState?.value || "");
    try {
      currentState = JSON.parse(String(event.detail || "null"));
    } catch (_error) {
      hidePreview();
      hideCaptionReferencePopup();
      return;
    }
    if (
      activeEditorReferenceKey &&
      (
        previousSource !== String(currentState?.value || "") ||
        (
          activeEditorReferenceType === "citation" &&
          cursorIsInsideCitationCommand(currentState)
        )
      )
    ) {
      hideCaptionReferencePopup();
    }
    if (!stateCanShowPreview(currentState)) {
      hidePreview();
      return;
    }
    scheduleRender();
  });

  closeButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
  });
  closeButton.addEventListener("click", dismissPreview);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!preview.hidden) dismissPreview();
    if (captionReferencePopup && !captionReferencePopup.hidden) {
      hideCaptionReferencePopup();
    }
  }, true);
  document.addEventListener("pointermove", scheduleEditorReferenceHover, true);
  document.addEventListener("pointerdown", (event) => {
    if (
      referencePopupContains(event.target) ||
      editorSurface(event.target)
    ) return;
    hideCaptionReferencePopup();
  }, true);

  optionsButton.addEventListener("click", () => {
    if (typeof extensionApi?.runtime?.sendMessage === "function") {
      Promise.resolve(
        extensionApi.runtime.sendMessage({ type: "smarttex-open-options" })
      ).catch(() => {});
      return;
    }
    extensionApi?.runtime?.openOptionsPage?.();
  });
  attachOptionsButton();
  const optionsButtonObserver = new MutationObserver(attachOptionsButton);
  optionsButtonObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[FEATURES_KEY]) return;
    const features = changes[FEATURES_KEY].newValue;
    enabledFeatures.equations = features?.equations !== false;
    enabledFeatures.tables = features?.tables !== false;
    enabledFeatures.figures = features?.figures !== false;
    hidePreview();
    if (stateCanShowPreview(currentState)) scheduleRender();
  });

  window.addEventListener("resize", () => {
    positionPreview();
    repositionReferencePopups();
  }, { passive: true });
  window.addEventListener("scroll", (event) => {
    if (referencePopupContains(event.target)) {
      keepReferencePopupOpen(event);
      return;
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
      window.requestAnimationFrame(positionPreview);
    }
  }, { passive: true, capture: true });
  window.addEventListener("pagehide", () => {
    hideCaptionReferencePopup();
    hidePreview();
    for (const pending of pendingRequests.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("SmartTeX page closed."));
    }
    pendingRequests.clear();
  }, { once: true });
  window.addEventListener("pagehide", () => optionsButtonObserver.disconnect(), {
    once: true
  });
})();
