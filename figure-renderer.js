/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const blobPromises = new Map();
  const objectUrlPromises = new Map();
  const pdfPreviewPromises = new Map();
  const NOMINAL_TEXT_WIDTH_PX = 520;
  let pdfModulePromise = null;

  function isPdf(pathValue, blob = null) {
    return (
      /\.pdf(?:$|[?#])/i.test(String(pathValue || "")) ||
      String(blob?.type || "").toLowerCase() === "application/pdf"
    );
  }

  function fetchedBlob(urlValue) {
    const url = String(urlValue || "");
    if (!blobPromises.has(url)) {
      blobPromises.set(url, fetch(url, {
        cache: "force-cache",
        credentials: "include"
      }).then((response) => {
        if (!response.ok) {
          throw new Error(`Figure request failed (${response.status}).`);
        }
        return response.blob();
      }).catch((error) => {
        blobPromises.delete(url);
        throw error;
      }));
    }
    return blobPromises.get(url);
  }

  function cachedObjectUrl(url) {
    if (!objectUrlPromises.has(url)) {
      objectUrlPromises.set(url, fetchedBlob(url).then((blob) => URL.createObjectURL(blob)));
    }
    return objectUrlPromises.get(url);
  }

  function pdfModule() {
    if (!pdfModulePromise) {
      const moduleUrl = extensionApi?.runtime?.getURL?.("vendor/pdfjs/pdf.mjs");
      if (!moduleUrl) {
        return Promise.reject(new Error("The bundled PDF renderer is unavailable."));
      }
      pdfModulePromise = import(moduleUrl).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = extensionApi.runtime.getURL(
          "vendor/pdfjs/pdf.worker.mjs"
        );
        return pdfjs;
      }).catch((error) => {
        pdfModulePromise = null;
        throw error;
      });
    }
    return pdfModulePromise;
  }

  function pdfPreviewDataUrl(url) {
    if (!pdfPreviewPromises.has(url)) {
      pdfPreviewPromises.set(url, Promise.all([fetchedBlob(url), pdfModule()])
        .then(async ([blob, pdfjs]) => {
          const data = new Uint8Array(await blob.arrayBuffer());
          const pdf = await pdfjs.getDocument({ data }).promise;
          try {
            const page = await pdf.getPage(1);
            const original = page.getViewport({ scale: 1 });
            const scale = Math.min(2, 1200 / original.width, 1000 / original.height);
            const viewport = page.getViewport({ scale: Math.max(0.35, scale) });
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            await page.render({
              canvasContext: canvas.getContext("2d", { alpha: false }),
              viewport
            }).promise;
            return canvas.toDataURL("image/png");
          } finally {
            pdf.destroy();
          }
        }).catch((error) => {
          pdfPreviewPromises.delete(url);
          throw error;
        }));
    }
    return pdfPreviewPromises.get(url);
  }

  async function createMedia(pathValue, urlValue, options = {}) {
    const path = String(pathValue || "Figure");
    const url = String(urlValue || "");
    const blob = await fetchedBlob(url);
    const pdf = isPdf(path, blob);
    const image = document.createElement("img");
    image.className = pdf
      ? String(options.pdfClass || options.imageClass || "")
      : String(options.imageClass || "");
    image.alt = path;
    image.decoding = "async";
    image.dataset.smarttexFigureSource = url;
    if (pdf) {
      image.src = await pdfPreviewDataUrl(url);
      image.dataset.smarttexPdfPreview = "true";
    } else {
      image.src = await cachedObjectUrl(url);
    }
    return image;
  }

  function stripComments(value) {
    return String(value || "").replace(/(^|[^\\])%[^\r\n]*/g, "$1");
  }

  function balancedGroup(source, openIndex, openChar = "{", closeChar = "}") {
    if (source[openIndex] !== openChar) return null;
    let depth = 1;
    for (let index = openIndex + 1; index < source.length; index += 1) {
      if (source[index] === "\\") {
        index += 1;
        continue;
      }
      if (source[index] === openChar) depth += 1;
      else if (source[index] === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return {
            start: openIndex,
            contentStart: openIndex + 1,
            contentEnd: index,
            end: index + 1,
            content: source.slice(openIndex + 1, index)
          };
        }
      }
    }
    return null;
  }

  function dimensionModel(value, lineWidthRatio = 1) {
    const text = String(value || "").replace(/\s+/g, "").trim();
    if (!text) return null;
    const relative = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))?\\(linewidth|textwidth|columnwidth)$/i);
    if (relative) {
      const factor = relative[1] === undefined || relative[1] === ""
        ? 1
        : Number(relative[1]);
      if (!Number.isFinite(factor)) return null;
      const unit = relative[2].toLowerCase();
      const totalRatio = factor * (unit === "linewidth" ? lineWidthRatio : 1);
      return {
        source: text,
        unit,
        factor,
        totalRatio,
        localRatio: lineWidthRatio > 0 ? totalRatio / lineWidthRatio : factor,
        fixedPx: null
      };
    }
    const fixed = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(pt|pc|in|cm|mm|px)$/i);
    if (!fixed) return null;
    const number = Number(fixed[1]);
    if (!Number.isFinite(number)) return null;
    const unit = fixed[2].toLowerCase();
    const pxPerUnit = {
      pt: 96 / 72.27,
      pc: 16,
      in: 96,
      cm: 96 / 2.54,
      mm: 96 / 25.4,
      px: 1
    }[unit];
    return {
      source: text,
      unit,
      factor: number,
      totalRatio: null,
      localRatio: null,
      fixedPx: number * pxPerUnit
    };
  }

  function includeGraphicsModels(sourceValue, lineWidthRatio = 1, sourceOffset = 0) {
    const source = String(sourceValue || "");
    const images = [];
    const pattern = /\\includegraphics(?:\s*\[([^\]]*)\])?\s*\{([^{}]+)\}/g;
    let match;
    while ((match = pattern.exec(source))) {
      const options = String(match[1] || "");
      const widthMatch = options.match(/(?:^|,)\s*width\s*=\s*([^,]+)(?:,|$)/i);
      const scaleMatch = options.match(/(?:^|,)\s*scale\s*=\s*([^,]+)(?:,|$)/i);
      const width = widthMatch
        ? dimensionModel(widthMatch[1], lineWidthRatio)
        : null;
      const scale = scaleMatch ? Number(scaleMatch[1]) : 1;
      images.push({
        path: String(match[2] || "").trim(),
        options,
        start: sourceOffset + match.index,
        end: sourceOffset + pattern.lastIndex,
        width,
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1
      });
    }
    return images;
  }

  function minipageModels(sourceValue) {
    const source = String(sourceValue || "");
    const tokenPattern = /\\(begin|end)\s*\{\s*minipage\s*\}/g;
    const stack = [];
    const models = [];
    let match;
    while ((match = tokenPattern.exec(source))) {
      if (match[1] === "begin") {
        let cursor = tokenPattern.lastIndex;
        while (/\s/.test(source[cursor] || "")) cursor += 1;
        if (source[cursor] === "[") {
          const optional = balancedGroup(source, cursor, "[", "]");
          if (optional) cursor = optional.end;
        }
        while (/\s/.test(source[cursor] || "")) cursor += 1;
        const widthGroup = balancedGroup(source, cursor);
        stack.push({
          beginStart: match.index,
          beginEnd: widthGroup?.end || tokenPattern.lastIndex,
          contentStart: widthGroup?.end || tokenPattern.lastIndex,
          widthSource: widthGroup?.content || ""
        });
        if (widthGroup) tokenPattern.lastIndex = widthGroup.end;
      } else if (stack.length) {
        const opened = stack.pop();
        if (stack.length === 0) {
          models.push({
            ...opened,
            contentEnd: match.index,
            end: tokenPattern.lastIndex,
            source: source.slice(opened.contentStart, match.index)
          });
        }
      }
    }
    return models.sort((left, right) => left.beginStart - right.beginStart);
  }

  function inlineGapOnly(value) {
    let text = stripComments(value);
    text = text
      .replace(/\\hspace\*?\s*\{[^{}]*\}/g, "")
      .replace(/\\(?:hfill|fill|quad|qquad|enspace|thinspace|medspace|thickspace)\b/g, "")
      .replace(/[~\s]/g, "");
    return text.length === 0;
  }

  function panelModel(source, widthRatio, fixedWidthPx, sourceOffset = 0) {
    const images = includeGraphicsModels(source, widthRatio || 1, sourceOffset);
    let inferredRatio = widthRatio;
    if (!(inferredRatio > 0)) {
      inferredRatio = Math.max(
        0,
        ...images.map((image) => image.width?.totalRatio || 0)
      ) || 1;
    }
    return {
      widthRatio: inferredRatio,
      fixedWidthPx: Number.isFinite(fixedWidthPx) ? fixedWidthPx : null,
      images
    };
  }

  function parseFigureLayout(sourceValue) {
    const source = String(sourceValue || "");
    const minipages = minipageModels(source);
    const panels = [];
    if (minipages.length) {
      for (const minipage of minipages) {
        const width = dimensionModel(minipage.widthSource, 1);
        panels.push({
          ...panelModel(
            minipage.source,
            width?.totalRatio || null,
            width?.fixedPx || null,
            minipage.contentStart
          ),
          start: minipage.beginStart,
          end: minipage.end
        });
      }
    } else {
      const images = includeGraphicsModels(source, 1, 0);
      for (const image of images) {
        panels.push({
          widthRatio: image.width?.totalRatio || 1,
          fixedWidthPx: image.width?.fixedPx || null,
          images: [image],
          start: image.start,
          end: image.end
        });
      }
    }

    const rows = [];
    let row = null;
    for (const panel of panels) {
      const previous = row?.items?.at(-1) || null;
      const currentRatio = row?.items?.reduce(
        (sum, item) => sum + Math.max(0, Number(item.widthRatio) || 0),
        0
      ) || 0;
      const nextRatio = Math.max(0, Number(panel.widthRatio) || 0);
      const gap = previous ? source.slice(previous.end, panel.start) : "";
      const canShareRow = Boolean(
        row &&
        previous &&
        inlineGapOnly(gap) &&
        currentRatio + nextRatio <= 1.08
      );
      if (!canShareRow) {
        row = { items: [] };
        rows.push(row);
      }
      row.items.push(panel);
    }

    if (!rows.length) {
      rows.push({ items: [{ widthRatio: 1, fixedWidthPx: null, images: [] }] });
    }

    const desiredWidthPx = Math.max(
      220,
      ...rows.map((candidate) => {
        const fixed = candidate.items.reduce(
          (sum, item) => sum + (Number(item.fixedWidthPx) || 0),
          0
        );
        const relative = candidate.items.reduce(
          (sum, item) => sum + (
            item.fixedWidthPx ? 0 : Math.max(0, Number(item.widthRatio) || 1)
          ),
          0
        );
        return fixed + NOMINAL_TEXT_WIDTH_PX * Math.min(1.35, Math.max(relative, 0));
      })
    );

    return {
      source,
      rows,
      desiredWidthPx: Math.min(1600, desiredWidthPx),
      nominalTextWidthPx: NOMINAL_TEXT_WIDTH_PX
    };
  }

  function popupAvailableWidth(root) {
    const owner = root.closest?.(".smarttex-document-reference-popup");
    if (owner) {
      const style = globalThis.getComputedStyle?.(owner);
      const horizontalPadding = (parseFloat(style?.paddingLeft) || 0) +
        (parseFloat(style?.paddingRight) || 0);
      const measured = owner.getBoundingClientRect?.().width || owner.clientWidth || 430;
      return Math.max(180, measured - horizontalPadding - 10);
    }
    return Math.max(220, Math.min(
      globalThis.innerWidth * 0.4 - 36,
      520,
      globalThis.innerWidth - 48
    ));
  }

  function popupAvailableHeight(root) {
    if (root.closest?.(".smarttex-document-reference-popup")) {
      return Math.max(150, Math.min(300, globalThis.innerHeight - 100));
    }
    return Math.max(180, Math.min(globalThis.innerHeight * 0.5, 520));
  }

  function imageDesiredHeight(image, displayWidth) {
    const naturalWidth = Number(image?.naturalWidth) || 0;
    const naturalHeight = Number(image?.naturalHeight) || 0;
    if (!(naturalWidth > 0 && naturalHeight > 0)) return displayWidth * 0.62;
    return displayWidth * naturalHeight / naturalWidth;
  }

  function layoutDesiredHeight(root, desiredWidth) {
    let total = 0;
    const rows = [...root.querySelectorAll(":scope > .smarttex-figure-layout-row")];
    for (const row of rows) {
      let rowHeight = 0;
      for (const panel of row.children) {
        const ratio = Math.max(0.05, Number(panel.dataset.smarttexWidthRatio) || 1);
        const panelWidth = desiredWidth * ratio;
        let panelHeight = 0;
        const images = [...panel.querySelectorAll("img")];
        if (!images.length) panelHeight = 110;
        for (const image of images) {
          const localRatio = Math.max(
            0.05,
            Number(image.dataset.smarttexLocalWidthRatio) || 1
          );
          const fixed = Number(image.dataset.smarttexFixedWidthPx) || 0;
          const scale = Number(image.dataset.smarttexImageScale) || 1;
          const imageWidth = (fixed > 0 ? fixed : panelWidth * localRatio) * scale;
          panelHeight += imageDesiredHeight(image, imageWidth) + 8;
        }
        rowHeight = Math.max(rowHeight, panelHeight);
      }
      total += Math.max(110, rowHeight) + 10;
    }
    return Math.max(110, total);
  }

  function fitPopupLayout(root) {
    if (!root?.isConnected) return;
    const desiredWidth = Math.max(
      220,
      Number(root.dataset.smarttexDesiredWidthPx) || NOMINAL_TEXT_WIDTH_PX
    );
    const availableWidth = popupAvailableWidth(root);
    const appliedWidth = Math.max(220, Math.min(desiredWidth, availableWidth));
    root.style.setProperty("--smarttex-figure-popup-scale", "1");
    root.style.width = `${Math.round(appliedWidth)}px`;
    for (const panel of root.querySelectorAll(".smarttex-figure-layout-panel")) {
      const fixedPanelWidth = Number(panel.dataset.smarttexFixedPanelWidthPx) || 0;
      if (fixedPanelWidth > 0) panel.style.flexBasis = `${fixedPanelWidth}px`;
    }
    for (const image of root.querySelectorAll("[data-smarttex-local-width-ratio]")) {
      const fixedWidth = Number(image.dataset.smarttexFixedWidthPx) || 0;
      const imageScale = Number(image.dataset.smarttexImageScale) || 1;
      if (fixedWidth > 0) {
        image.style.width = `${fixedWidth * imageScale}px`;
      } else {
        const localRatio = Math.max(
          0.05,
          Number(image.dataset.smarttexLocalWidthRatio) || 1
        );
        image.style.width = `${localRatio * imageScale * 100}%`;
      }
    }
    const viewport = root.closest?.(".smarttex-figure-popup-viewport");
    if (viewport) {
      viewport.classList.add("smarttex-figure-popup-scrollable");
    }
  }

  function observePopupLayout(root) {
    if (!root) return;
    const update = () => globalThis.requestAnimationFrame?.(() => fitPopupLayout(root));
    for (const image of root.querySelectorAll("img")) {
      if (!image.complete) image.addEventListener("load", update, { once: true });
    }
    update();
  }

  globalThis.SmartTeXFigureRenderer = Object.freeze({
    createMedia,
    fitPopupLayout,
    isPdf,
    observePopupLayout,
    parseFigureLayout
  });
})();
