/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const SITES_KEY = "smarttex:editor-sites:v1";
  const FEATURES_KEY = "smarttex:features:v1";
  const AUTOCOMPLETE_KEY = "smarttex:autocomplete:v1";
  const REFERENCE_POPUPS_KEY = "smarttex:reference-popups:v1";
  const STRUCTURE_HIGHLIGHT_KEY = "smarttex:structure-highlight:v1";
  const DEFAULT_HIGHLIGHTS = Object.freeze({
    environmentEnabled: true,
    environmentColor: "#8ec5ff",
    captionEnabled: true,
    captionColor: "#70afea",
    labelEnabled: true,
    labelColor: "#8fd19e",
    referenceEnabled: true,
    referenceColor: "#8fd19e",
    nonumberEnabled: true,
    nonumberColor: "#ffe69a",
    inlineMathEnabled: true,
    inlineMathColor: "#8ec5ff"
  });
  const DEFAULT_SITES = ["collabtex.helmholtz.cloud"];
  const DEFAULT_FEATURES = Object.freeze({
    equations: true,
    tables: true,
    figures: true,
    liveDocumentPreview: false
  });
  const BUILT_IN_SITES = new Set(DEFAULT_SITES);

  const form = document.querySelector("#smarttex-options-form");
  const sitesInput = document.querySelector("#smarttex-editor-sites");
  const equationsInput = document.querySelector("#smarttex-feature-equations");
  const tablesInput = document.querySelector("#smarttex-feature-tables");
  const figuresInput = document.querySelector("#smarttex-feature-figures");
  const liveDocumentPreviewInput = document.querySelector(
    "#smarttex-feature-live-document-preview"
  );
  const referenceOrderInput = document.querySelector("#smarttex-reference-order");
  const referencePopupTriggerInput = document.querySelector(
    "#smarttex-reference-popup-trigger"
  );
  const environmentPopupTriggerInput = document.querySelector(
    "#smarttex-environment-popup-trigger"
  );
  const highlightControls = {
    environmentEnabled: document.querySelector("#smarttex-highlight-environment-enabled"),
    environmentColor: document.querySelector("#smarttex-highlight-environment-color"),
    captionEnabled: document.querySelector("#smarttex-highlight-caption-enabled"),
    captionColor: document.querySelector("#smarttex-highlight-caption-color"),
    labelEnabled: document.querySelector("#smarttex-highlight-label-enabled"),
    labelColor: document.querySelector("#smarttex-highlight-label-color"),
    referenceEnabled: document.querySelector("#smarttex-highlight-reference-enabled"),
    referenceColor: document.querySelector("#smarttex-highlight-reference-color"),
    nonumberEnabled: document.querySelector("#smarttex-highlight-nonumber-enabled"),
    nonumberColor: document.querySelector("#smarttex-highlight-nonumber-color"),
    inlineMathEnabled: document.querySelector("#smarttex-highlight-inline-math-enabled"),
    inlineMathColor: document.querySelector("#smarttex-highlight-inline-math-color")
  };
  const highlightReset = document.querySelector("#smarttex-highlight-reset");
  const status = document.querySelector("#smarttex-options-status");

  let loading = true;
  let saveTimer = 0;
  let saveRevision = 0;
  let saveQueue = Promise.resolve();
  let lastSiteFingerprint = "";

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

  function sitesFromForm() {
    return [...new Set(
      sitesInput.value
        .split(/\r?\n/)
        .map(normalizeDomain)
        .filter(Boolean)
    )];
  }

  function highlightSettingsFromForm() {
    return Object.fromEntries(
      Object.entries(highlightControls).map(([key, control]) => [
        key,
        control.type === "checkbox"
          ? control.checked
          : (/^#[0-9a-f]{6}$/i.test(control.value)
            ? control.value.toLowerCase()
            : DEFAULT_HIGHLIGHTS[key])
      ])
    );
  }

  function settingsFromForm() {
    const sites = sitesFromForm();
    return {
      sites,
      storage: {
        [SITES_KEY]: { sites },
        [FEATURES_KEY]: {
          equations: equationsInput.checked,
          tables: tablesInput.checked,
          figures: figuresInput.checked,
          liveDocumentPreview: liveDocumentPreviewInput.checked
        },
        [AUTOCOMPLETE_KEY]: {
          referenceOrder: referenceOrderInput.value === "alphabetical"
            ? "alphabetical"
            : "document"
        },
        [REFERENCE_POPUPS_KEY]: {
          trigger: referencePopupTriggerInput.value === "hover"
            ? "hover"
            : "cursor",
          environmentTrigger: environmentPopupTriggerInput.value === "hover"
            ? "hover"
            : "cursor"
        },
        [STRUCTURE_HIGHLIGHT_KEY]: highlightSettingsFromForm()
      }
    };
  }

  async function requestSitePermissions(sites) {
    const optionalOrigins = sites
      .filter((domain) => !BUILT_IN_SITES.has(domain))
      .map((domain) => `https://${domain}/*`);
    if (!optionalOrigins.length || !extensionApi.permissions?.request) return true;

    const missingOrigins = [];
    for (const origin of optionalOrigins) {
      const granted = await extensionApi.permissions.contains({ origins: [origin] });
      if (!granted) missingOrigins.push(origin);
    }
    if (!missingOrigins.length) return true;
    return extensionApi.permissions.request({ origins: missingOrigins });
  }

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("options-status-error", Boolean(isError));
  }

  function save({ requestPermissions = false, synchronizeSites = false } = {}) {
    if (loading) return Promise.resolve();
    const revision = ++saveRevision;
    const settings = settingsFromForm();
    const permissionResult = requestPermissions
      ? requestSitePermissions(settings.sites)
      : Promise.resolve(true);
    showStatus("Saving…");

    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const granted = await permissionResult;
      if (!granted) {
        throw new Error("Access to one or more configured editor sites was not granted.");
      }

      await extensionApi.storage.local.set(settings.storage);

      if (synchronizeSites) {
        const response = await extensionApi.runtime.sendMessage({
          type: "smarttex-sync-editor-sites"
        });
        if (response?.ok === false) {
          throw new Error(response.error || "SmartTeX could not activate the configured sites.");
        }
        lastSiteFingerprint = settings.sites.join("\n");
        if (revision === saveRevision) sitesInput.value = lastSiteFingerprint;
      }

      if (revision === saveRevision) showStatus("Saved.");
    }).catch((error) => {
      if (revision === saveRevision) {
        showStatus(error?.message || String(error), true);
      }
    });

    return saveQueue;
  }

  function scheduleSave(delay = 0, options = {}) {
    if (loading) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      save(options);
    }, Math.max(0, Number(delay) || 0));
  }

  async function load() {
    const stored = await extensionApi.storage.local.get([
      SITES_KEY,
      FEATURES_KEY,
      AUTOCOMPLETE_KEY,
      REFERENCE_POPUPS_KEY,
      STRUCTURE_HIGHLIGHT_KEY
    ]);
    const sites = Array.isArray(stored?.[SITES_KEY]?.sites)
      ? stored[SITES_KEY].sites
      : DEFAULT_SITES;
    const normalizedSites = sites.map(normalizeDomain).filter(Boolean);
    sitesInput.value = normalizedSites.join("\n");
    lastSiteFingerprint = normalizedSites.join("\n");

    const features = stored?.[FEATURES_KEY] || DEFAULT_FEATURES;
    equationsInput.checked = features.equations !== false;
    tablesInput.checked = features.tables !== false;
    figuresInput.checked = features.figures !== false;
    liveDocumentPreviewInput.checked = features.liveDocumentPreview === true;
    referenceOrderInput.value = stored?.[AUTOCOMPLETE_KEY]?.referenceOrder === "alphabetical"
      ? "alphabetical"
      : "document";

    const popupSettings = stored?.[REFERENCE_POPUPS_KEY] || {};
    referencePopupTriggerInput.value = popupSettings.trigger === "hover"
      ? "hover"
      : "cursor";
    environmentPopupTriggerInput.value = popupSettings.environmentTrigger === "hover"
      ? "hover"
      : "cursor";

    const storedHighlights = stored?.[STRUCTURE_HIGHLIGHT_KEY] || {};
    const merged = { ...DEFAULT_HIGHLIGHTS, ...storedHighlights };
    if (storedHighlights.color && !storedHighlights.environmentColor) {
      merged.environmentColor = storedHighlights.color;
    }
    // Migrate the former global `enabled` flag to the environment/section
    // category. Other annotation categories, including inline equations,
    // remain independently configurable.
    if (
      storedHighlights.environmentEnabled === undefined &&
      storedHighlights.enabled !== undefined
    ) {
      merged.environmentEnabled = storedHighlights.enabled !== false;
    }
    for (const [key, control] of Object.entries(highlightControls)) {
      if (!control) continue;
      if (control.type === "checkbox") control.checked = merged[key] !== false;
      else control.value = /^#[0-9a-f]{6}$/i.test(String(merged[key] || ""))
        ? String(merged[key]).toLowerCase()
        : DEFAULT_HIGHLIGHTS[key];
    }

    loading = false;
    showStatus("Saved.");
  }

  highlightReset.addEventListener("click", () => {
    for (const [key, control] of Object.entries(highlightControls)) {
      if (!control) continue;
      if (control.type === "checkbox") control.checked = DEFAULT_HIGHLIGHTS[key] !== false;
      else control.value = DEFAULT_HIGHLIGHTS[key];
    }
    scheduleSave(0);
  });

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", (event) => {
    if (event.target === sitesInput) {
      // Domain permission prompts require a completed edit and are therefore
      // handled by the change event below rather than on every keystroke.
      scheduleSave(350);
      return;
    }
    scheduleSave(event.target?.type === "color" ? 40 : 0);
  });
  form.addEventListener("change", (event) => {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    if (event.target === sitesInput) {
      save({ requestPermissions: true, synchronizeSites: true });
      return;
    }
    save();
  });

  load().catch((error) => {
    loading = false;
    showStatus(error?.message || String(error), true);
  });
})();
