/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const blobPromises = new Map();
  const objectUrlPromises = new Map();
  const pdfPreviewPromises = new Map();
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

  globalThis.SmartTeXFigureRenderer = Object.freeze({
    createMedia,
    isPdf
  });
})();
