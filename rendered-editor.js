/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.__smartTeXRenderedEditorLoaded) return;
  globalThis.__smartTeXRenderedEditorLoaded = true;

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const SETTINGS_KEY = "smarttex:rendered-editor:v1";
  const SETTINGS_EVENT = "smarttex:rendered-editor-settings";
  const ITEMS_EVENT = "smarttex:rendered-editor-items";
  const MEASURE_EVENT = "smarttex:rendered-editor-measure";
  const REQUEST_EVENT = "smarttex:citation-editor-request";
  const RESPONSE_EVENT = "smarttex:citation-editor-response";
  const pendingRequests = new Map();
  let requestCounter = 0;
  let latestSource = "";
  let latestItems = new Map();
  let renderGeneration = 0;
  const resizeObservers = new Map();
  const lazyItems = new Map();
  const lazyRenderObserver = globalThis.IntersectionObserver
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const item = lazyItems.get(entry.target);
        if (!item) continue;
        lazyItems.delete(entry.target);
        lazyRenderObserver.unobserve(entry.target);
        renderItem(item, latestSource);
      }
    }, { rootMargin: "240px 0px" })
    : null;

  let contextTools = globalThis.SmartTeXLatexContext;
  let tableRenderer = globalThis.SmartTeXTableRenderer;
  let figureRenderer = globalThis.SmartTeXFigureRenderer;
  let katex = globalThis.katex;

  const dependenciesReady = (async () => {
    const startedAt = Date.now();
    let repairRequested = false;
    while (!(
      globalThis.SmartTeXLatexContext &&
      globalThis.SmartTeXTableRenderer &&
      globalThis.SmartTeXFigureRenderer &&
      globalThis.katex?.render
    )) {
      if (!repairRequested) {
        repairRequested = true;
        try {
          await extensionApi?.runtime?.sendMessage?.({
            type: "smarttex-reinject-preview-dependencies"
          });
        } catch (_error) {
          // The registered dependency script can still complete normally.
        }
      }
      if (Date.now() - startedAt > 10000) {
        throw new Error("SmartTeX rendered-editor dependencies could not be loaded.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    contextTools = globalThis.SmartTeXLatexContext;
    tableRenderer = globalThis.SmartTeXTableRenderer;
    figureRenderer = globalThis.SmartTeXFigureRenderer;
    katex = globalThis.katex;
  })();

  function dispatchSettings(value) {
    const settings = value || {};
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, {
      detail: JSON.stringify({
        enabled: settings.enabled !== false,
        hideComments: settings.hideComments !== false
      })
    }));
  }

  if (typeof extensionApi?.storage?.local?.get === "function") {
    extensionApi.storage.local.get(SETTINGS_KEY)
      .then((stored) => dispatchSettings(stored?.[SETTINGS_KEY]))
      .catch(() => dispatchSettings(null));
    extensionApi.storage.onChanged?.addListener((changes, areaName) => {
      if (areaName === "local" && changes?.[SETTINGS_KEY]) {
        dispatchSettings(changes[SETTINGS_KEY].newValue);
      }
    });
  } else {
    dispatchSettings(null);
  }

  function bridgeRequest(type, payload = {}, timeout = 4000) {
    const requestId = `rendered-editor-${Date.now()}-${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`SmartTeX editor request timed out: ${type}`));
      }, timeout);
      pendingRequests.set(requestId, { resolve, reject, timer });
      window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: JSON.stringify({ requestId, type, ...payload })
      }));
    });
  }

  window.addEventListener(RESPONSE_EVENT, (event) => {
    let response = null;
    try {
      response = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      return;
    }
    const pending = pendingRequests.get(response.requestId);
    if (!pending) return;
    pendingRequests.delete(response.requestId);
    window.clearTimeout(pending.timer);
    if (response.ok === false) pending.reject(new Error(response.error || "Editor request failed."));
    else pending.resolve(response);
  });

  function trustedKatexCommand(context) {
    return context?.command === "\\htmlClass" && /^smarttex-/.test(String(context?.class || ""));
  }

  function documentPreparation(source, start, body) {
    try {
      return contextTools.prepareDocumentCommands(source, start, body);
    } catch (_error) {
      return { body, macros: { "\\ensuremath": "#1" } };
    }
  }

  function renderMath(container, body, displayMode, source, start) {
    const prepared = documentPreparation(source, start, body);
    const macros = {
      ...prepared.macros,
      "\\label": { tokens: [], numArgs: 1 },
      "\\nonumber": "",
      "\\notag": ""
    };
    katex.render(prepared.body, container, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: trustedKatexCommand,
      maxExpand: 1000,
      maxSize: 25,
      macros
    });
    return macros;
  }

  function renderInlineCaption(text, source, start, macros) {
    return tableRenderer.renderInlineLatex(String(text || ""), {
      contextTools,
      document,
      katex,
      macros,
      trust: trustedKatexCommand,
      sourceOffset: Number.isFinite(Number(start)) ? Number(start) : undefined
    });
  }

  function appendCaption(container, label, number, caption, source, start, macros) {
    const text = String(caption?.text || "").trim();
    if (!text) return;
    const element = document.createElement("figcaption");
    element.className = "smarttex-rendered-editor-caption";
    const renderedCaption = renderInlineCaption(text, source, start, macros);
    if (!caption?.starred && number !== null && number !== undefined && String(number).trim()) {
      const strong = document.createElement("strong");
      strong.textContent = `${label} ${number}:`;
      element.append(strong, " ", renderedCaption);
    } else {
      element.appendChild(renderedCaption);
    }
    container.appendChild(element);
  }

  function normalizedProjectPath(value) {
    return String(value || "").trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  }

  function figurePathStem(value) {
    return normalizedProjectPath(value).replace(/\.[a-z0-9]{1,8}$/i, "").toLowerCase();
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
          candidate.querySelector(".item-name-button span, .item-name span, .entity-name span")?.textContent ||
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
    if (explicit) return { path: resolvedPath, url: new URL(explicit, window.location.href).href };
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

  function figurePlaceholder(path, resolving = false) {
    const element = document.createElement("div");
    element.className = "smarttex-rendered-editor-figure-placeholder";
    element.textContent = resolving ? `Locating ${path}…` : path;
    return element;
  }

  async function resolveFigure(path, placeholder, itemId) {
    let file = directFigureFile(path);
    if (!file?.url) {
      const response = await bridgeRequest("resolveProjectFile", { path }, 5000);
      file = response?.file || null;
    }
    if (!file?.url || !placeholder.isConnected) throw new Error("Figure file unavailable.");
    const media = await figureRenderer.createMedia(file.path || path, file.url, {
      imageClass: "smarttex-rendered-editor-image",
      pdfClass: "smarttex-rendered-editor-image smarttex-rendered-editor-pdf"
    });
    if (!placeholder.isConnected) return;
    for (const attribute of [
      "data-smarttex-local-width-ratio",
      "data-smarttex-fixed-width-px",
      "data-smarttex-image-scale"
    ]) {
      if (placeholder.hasAttribute(attribute)) {
        media.setAttribute(attribute, placeholder.getAttribute(attribute));
      }
    }
    placeholder.replaceWith(media);
    media.addEventListener("load", () => measureItem(itemId), { once: true });
    measureItem(itemId);
  }

  function configureFigureNode(node, imageModel) {
    const width = imageModel?.width || {};
    const ratio = Number(width.totalRatio);
    const fixed = Number(width.fixedPx);
    const scale = Number(imageModel?.scale);
    node.dataset.smarttexLocalWidthRatio = String(Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
    if (Number.isFinite(fixed) && fixed > 0) node.dataset.smarttexFixedWidthPx = String(fixed);
    node.dataset.smarttexImageScale = String(Number.isFinite(scale) && scale > 0 ? scale : 1);
  }

  function renderFigure(container, item, source) {
    const figure = document.createElement("figure");
    figure.className = "smarttex-rendered-editor-figure-content";
    const model = figureRenderer.parseFigureLayout(item.context?.source || "");
    const media = document.createElement("div");
    media.className = "smarttex-rendered-editor-figure-media";
    let imageCount = 0;
    for (const rowModel of model.rows || []) {
      const row = document.createElement("div");
      row.className = "smarttex-rendered-editor-figure-row";
      for (const panelModel of rowModel.items || []) {
        const panel = document.createElement("div");
        panel.className = "smarttex-rendered-editor-figure-panel";
        const ratio = Math.max(0.05, Number(panelModel.widthRatio) || 1);
        panel.style.flexBasis = `${Math.min(100, ratio * 100)}%`;
        for (const imageModel of panelModel.images || []) {
          imageCount += 1;
          const placeholder = figurePlaceholder(imageModel.path, true);
          configureFigureNode(placeholder, imageModel);
          panel.appendChild(placeholder);
          resolveFigure(imageModel.path, placeholder, item.id).catch(() => {
            if (!placeholder.isConnected) return;
            placeholder.textContent = imageModel.path;
            placeholder.title = "The figure file could not be resolved from the project.";
            measureItem(item.id);
          });
        }
        row.appendChild(panel);
      }
      media.appendChild(row);
    }
    if (!imageCount) media.appendChild(figurePlaceholder("No image in this figure"));
    figure.appendChild(media);
    const prepared = documentPreparation(source, item.start, item.caption?.text || "");
    appendCaption(figure, "Fig.", item.number, item.caption, source, item.caption?.start, prepared.macros);
    container.appendChild(figure);
  }

  function renderTable(container, item, source) {
    const figure = document.createElement("figure");
    figure.className = "smarttex-rendered-editor-table-content";
    const prepared = documentPreparation(source, item.start, item.caption?.text || "");
    const macros = {
      ...prepared.macros,
      "\\label": { tokens: [], numArgs: 1 },
      "\\nonumber": "",
      "\\notag": ""
    };
    figure.appendChild(tableRenderer.renderTable(item.context, {
      commandSide: null,
      includeCaret: false,
      contextTools,
      document,
      katex,
      macros,
      trust: trustedKatexCommand,
      sourceOffset: item.context?.contentStart
    }));
    appendCaption(figure, "Tab.", item.number, item.caption, source, item.caption?.start, macros);
    container.appendChild(figure);
  }

  function renderEquation(container, item, source) {
    const context = item.context;
    const numbering = contextTools.equationPreviewNumbering(source, context);
    const body = contextTools.previewBody(context, null, numbering, false);
    renderMath(container, body, Boolean(context.display), source, item.start);
  }

  function queueItemRender(item, source) {
    const container = document.getElementById(item.containerId);
    if (!container) return;
    if (!item.kind || !["display-equation", "table", "figure"].includes(item.kind)) {
      renderItem(item, source);
      return;
    }
    if (!lazyRenderObserver) {
      renderItem(item, source);
      return;
    }
    container.replaceChildren();
    const placeholder = document.createElement("span");
    placeholder.className = "smarttex-rendered-editor-lazy-placeholder";
    placeholder.textContent = item.kind === "figure"
      ? "Figure"
      : item.kind === "table"
        ? "Table"
        : "Equation";
    container.appendChild(placeholder);
    lazyItems.set(container, item);
    lazyRenderObserver.observe(container);
    observeAndMeasure(item.id, container);
  }

  function renderItem(item, source) {
    const container = document.getElementById(item.containerId);
    if (!container) return;
    container.replaceChildren();
    container.title = "Click to edit the LaTeX source";
    container.setAttribute("role", "button");
    container.setAttribute("tabindex", "0");

    try {
      if (item.kind === "reference") {
        container.textContent = item.renderedText || "?";
      } else if (item.kind === "inline-comment") {
        container.textContent = "[c]";
        container.title = "Show inline comment";
      } else if (item.kind === "inline-math") {
        renderMath(container, item.context?.source || "", false, source, item.start);
      } else if (item.kind === "display-equation") {
        renderEquation(container, item, source);
      } else if (item.kind === "table") {
        renderTable(container, item, source);
      } else if (item.kind === "figure") {
        renderFigure(container, item, source);
      }
    } catch (error) {
      container.replaceChildren();
      const fallback = document.createElement("code");
      fallback.textContent = item.kind === "reference"
        ? (item.renderedText || "?")
        : String(item.source || "").replace(/\s+/g, " ").trim();
      fallback.title = error?.message || String(error);
      container.appendChild(fallback);
    }

    observeAndMeasure(item.id, container);
  }

  function measureItem(id) {
    const item = latestItems.get(id);
    if (!item) return;
    const container = document.getElementById(item.containerId);
    if (!container?.isConnected) return;
    const rect = container.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent(MEASURE_EVENT, {
      detail: JSON.stringify({
        id,
        width: rect.width,
        height: rect.height
      })
    }));
  }

  function observeAndMeasure(id, container) {
    resizeObservers.get(id)?.disconnect?.();
    if (globalThis.ResizeObserver) {
      const observer = new ResizeObserver(() => measureItem(id));
      observer.observe(container);
      resizeObservers.set(id, observer);
    }
    window.requestAnimationFrame(() => measureItem(id));
  }

  window.addEventListener(ITEMS_EVENT, (event) => {
    let detail = null;
    try {
      detail = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      return;
    }
    const generation = ++renderGeneration;
    latestSource = String(detail.source || "");
    const items = Array.isArray(detail.items) ? detail.items : [];
    latestItems = new Map(items.map((item) => [item.id, item]));
    for (const [element] of lazyItems) {
      lazyRenderObserver?.unobserve?.(element);
    }
    lazyItems.clear();
    for (const [id, observer] of resizeObservers) {
      if (!latestItems.has(id)) {
        observer.disconnect?.();
        resizeObservers.delete(id);
      }
    }
    const isBasicItem = (item) => (
      item.kind === "reference" || item.kind === "inline-comment"
    );
    const basicItems = items.filter(isBasicItem);
    for (const item of basicItems) queueItemRender(item, latestSource);

    const richItems = items.filter((item) => !isBasicItem(item));
    if (!richItems.length) return;
    Promise.all([
      dependenciesReady,
      Promise.resolve(globalThis.SmartTeXKatexFonts?.ready).catch(() => {})
    ]).then(() => {
      if (generation !== renderGeneration) return;
      for (const item of richItems) queueItemRender(item, latestSource);
    }).catch((error) => {
      console.warn("SmartTeX rendered editor could not initialize:", error);
    });
  });
})();
