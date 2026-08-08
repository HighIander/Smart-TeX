/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const SITES_KEY = "smarttex:editor-sites:v1";
  const FEATURES_KEY = "smarttex:features:v1";
  const LEGACY_DOCUMENT_PREVIEW_SETTINGS_KEY = "smarttex:document-preview-settings:v1";
  const DEFAULT_SITES = ["collabtex.helmholtz.cloud"];
  const BRIDGE_SCRIPT_ID = "smarttex-editor-bridge-v1";
  const DEPENDENCY_SCRIPT_ID = "smarttex-preview-dependencies-v1";
  const CONTENT_SCRIPT_ID = "smarttex-equation-preview-v1";
  const LEGACY_BOOTSTRAP_SCRIPT_ID = "smarttex-editor-bootstrap-v1";
  let registrationQueue = Promise.resolve();
  const dependencyRepairByTarget = new Map();


  async function removeLegacyDocumentPreviewSettings() {
    const stored = await extensionApi.storage.local.get(FEATURES_KEY);
    const features = stored?.[FEATURES_KEY];
    if (features && Object.prototype.hasOwnProperty.call(features, "liveDocumentPreview")) {
      const { liveDocumentPreview: _removed, ...remainingFeatures } = features;
      await extensionApi.storage.local.set({ [FEATURES_KEY]: remainingFeatures });
    }
    await extensionApi.storage.local.remove(LEGACY_DOCUMENT_PREVIEW_SETTINGS_KEY);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function nextcloudFetchResponse(message) {
    const url = new URL(String(message.url || ""));
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("Only HTTP or HTTPS Nextcloud requests are allowed.");
    }
    const headers = new Headers(message.headers || {});
    let body;
    if (typeof message.bodyBase64 === "string") {
      const binary = atob(message.bodyBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      body = bytes;
    } else if (typeof message.bodyText === "string") {
      body = message.bodyText;
    }
    const response = await fetch(url.href, {
      method: message.method || "GET",
      headers,
      body,
      cache: "no-store",
      credentials: "omit"
    });
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyBase64: bytesToBase64(new Uint8Array(await response.arrayBuffer()))
    };
  }

  async function requestOriginPermission(serverValue) {
    const origin = new URL(String(serverValue || "")).origin;
    const pattern = `${origin}/*`;
    const contains = await extensionApi.permissions.contains({ origins: [pattern] });
    return contains || extensionApi.permissions.request({ origins: [pattern] });
  }

  function normalizeDomain(value) {
    let domain = String(value || "").trim().replace(/\/+$/, "");
    if (!domain || domain.startsWith("#")) return "";
    domain = domain.replace(/^[a-z][a-z\d+.-]*:\/\//i, "");
    domain = domain.split(/[/?#]/, 1)[0].replace(/\.$/, "").toLowerCase();
    if (domain.startsWith("*.")) {
      const suffix = domain.slice(2);
      return /^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(suffix) ? `*.${suffix}` : "";
    }
    return /^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(domain) ? domain : "";
  }

  async function configuredSites() {
    const stored = await extensionApi.storage.local.get(SITES_KEY);
    const values = Array.isArray(stored?.[SITES_KEY]?.sites)
      ? stored[SITES_KEY].sites
      : DEFAULT_SITES;
    return [...new Set(values.map(normalizeDomain).filter(Boolean))];
  }

  function matchPattern(domain) {
    return `https://${domain}/*`;
  }

  async function synchronizeContentScripts() {
    if (
      !extensionApi.scripting?.registerContentScripts ||
      !extensionApi.scripting?.unregisterContentScripts
    ) {
      return { supported: false, matches: [] };
    }

    const matches = (await configuredSites()).map(matchPattern);
    const ids = [BRIDGE_SCRIPT_ID, DEPENDENCY_SCRIPT_ID, CONTENT_SCRIPT_ID, LEGACY_BOOTSTRAP_SCRIPT_ID];
    for (const id of ids) {
      await extensionApi.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
    }
    if (!matches.length) return { supported: true, matches };

    await extensionApi.scripting.registerContentScripts([
      {
        id: BRIDGE_SCRIPT_ID,
        matches,
        js: ["interaction-tasks.js", "latex-context.js", "page-bridge.js"],
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: true,
        world: "MAIN"
      },
      {
        id: DEPENDENCY_SCRIPT_ID,
        matches,
        js: [
          "interaction-tasks.js",
          "font-loader.js",
          "vendor/katex/katex.min.js",
          "latex-context.js",
          "table-renderer.js",
          "table-editor.js",
          "figure-renderer.js",
          "bibtex-parser.js",
          "nextcloud-client.js"
        ],
        runAt: "document_start",
        allFrames: false,
        persistAcrossSessions: true,
        world: "ISOLATED"
      },
      {
        id: CONTENT_SCRIPT_ID,
        matches,
        css: [
          "vendor/katex/katex.min.css",
          "content.css"
        ],
        js: [
          "privacy-consent.js",
          "privacy-consent-content.js",
          "popup-gate.js",
          "comment-profile.js",
          "content.js",
          "settings-menu.js",
          "figure-autocomplete.js",
          "editor-toolbar.js",
          "label-reference-guard.js",
          "project-files.js",
          "comments.js",
          "review.js",
          "citation-autocomplete.js",
          "reference-autocomplete.js"
        ],
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: true,
        world: "ISOLATED"
      }
    ]);
    return { supported: true, matches };
  }

  function queueContentScriptSync() {
    registrationQueue = registrationQueue
      .catch(() => {})
      .then(() => synchronizeContentScripts());
    return registrationQueue;
  }

  extensionApi.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      extensionApi.storage.local.get(SITES_KEY).then((stored) => {
        if (!stored?.[SITES_KEY]) {
          return extensionApi.storage.local.set({
            [SITES_KEY]: { sites: DEFAULT_SITES }
          });
        }
        return undefined;
      }).then(queueContentScriptSync).then(() => {
        return extensionApi.runtime.openOptionsPage();
      }).catch((error) => {
        console.error("SmartTeX installation initialization failed:", error);
      });
      return;
    }
    queueContentScriptSync().catch((error) => {
      console.error("SmartTeX content-script registration failed:", error);
    });
  });

  extensionApi.runtime.onStartup?.addListener(() => {
    queueContentScriptSync().catch((error) => {
      console.error("SmartTeX content-script registration failed:", error);
    });
  });

  extensionApi.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "smarttex-reinject-preview-dependencies") {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId) || !extensionApi.scripting?.executeScript) {
        return Promise.resolve({ ok: false, error: "The active editor tab could not be resolved." });
      }
      const target = { tabId };
      if (Number.isInteger(sender?.frameId) && sender.frameId >= 0) {
        target.frameIds = [sender.frameId];
      }
      const repairKey = `${tabId}:${Number.isInteger(sender?.frameId) ? sender.frameId : 0}`;
      if (dependencyRepairByTarget.has(repairKey)) {
        return dependencyRepairByTarget.get(repairKey);
      }
      const repair = extensionApi.scripting.executeScript({
        target,
        files: [
          "interaction-tasks.js",
          "vendor/katex/katex.min.js",
          "latex-context.js",
          "table-renderer.js",
          "table-editor.js",
          "figure-renderer.js",
          "bibtex-parser.js",
          "nextcloud-client.js"
        ],
        world: "ISOLATED"
      }).then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error: error?.message || String(error) }))
        .finally(() => dependencyRepairByTarget.delete(repairKey));
      dependencyRepairByTarget.set(repairKey, repair);
      return repair;
    }
    if (message?.type === "smarttex-open-options") {
      return extensionApi.runtime.openOptionsPage()
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    }
    if (message?.type === "smarttex-sync-editor-sites") {
      return queueContentScriptSync()
        .then((result) => ({ ok: true, ...result }))
        .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    }
    if (message?.type === "smarttex-nextcloud-fetch") {
      return nextcloudFetchResponse(message)
        .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    }
    if (message?.type === "smarttex-request-origin-permission") {
      return requestOriginPermission(message.server)
        .then((granted) => ({ ok: true, granted: Boolean(granted) }))
        .catch((error) => ({ ok: false, error: error?.message || String(error) }));
    }
    if (message?.type === "smarttex-open-external-tab") {
      try {
        const url = new URL(String(message.url || ""));
        if (!/^https?:$/.test(url.protocol)) {
          throw new Error("Only HTTP or HTTPS URLs can be opened.");
        }
        return extensionApi.tabs.create({
          url: url.href,
          active: message.active !== false
        }).then((tab) => ({ ok: true, tabId: tab?.id ?? null }))
          .catch((error) => ({ ok: false, error: error?.message || String(error) }));
      } catch (error) {
        return Promise.resolve({ ok: false, error: error?.message || String(error) });
      }
    }
    return undefined;
  });

  extensionApi.action?.onClicked.addListener(() => {
    extensionApi.runtime.openOptionsPage();
  });

  removeLegacyDocumentPreviewSettings()
    .then(queueContentScriptSync)
    .catch((error) => {
      console.error("SmartTeX initialization failed:", error);
    });
})();
