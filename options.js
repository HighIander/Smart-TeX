/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const SITES_KEY = "smarttex:editor-sites:v1";
  const FEATURES_KEY = "smarttex:features:v1";
  const DEFAULT_SITES = ["collabtex.helmholtz.cloud"];
  const DEFAULT_FEATURES = Object.freeze({
    equations: true,
    tables: true,
    figures: true
  });
  const BUILT_IN_SITES = new Set(DEFAULT_SITES);
  const form = document.querySelector("#smarttex-options-form");
  const sitesInput = document.querySelector("#smarttex-editor-sites");
  const equationsInput = document.querySelector("#smarttex-feature-equations");
  const tablesInput = document.querySelector("#smarttex-feature-tables");
  const figuresInput = document.querySelector("#smarttex-feature-figures");
  const status = document.querySelector("#smarttex-options-status");

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

  async function load() {
    const stored = await extensionApi.storage.local.get([SITES_KEY, FEATURES_KEY]);
    const sites = Array.isArray(stored?.[SITES_KEY]?.sites)
      ? stored[SITES_KEY].sites
      : DEFAULT_SITES;
    sitesInput.value = sites.map(normalizeDomain).filter(Boolean).join("\n");
    const features = stored?.[FEATURES_KEY] || DEFAULT_FEATURES;
    equationsInput.checked = features.equations !== false;
    tablesInput.checked = features.tables !== false;
    figuresInput.checked = features.figures !== false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    try {
      const sites = sitesFromForm();
      const optionalOrigins = sites
        .filter((domain) => !BUILT_IN_SITES.has(domain))
        .map((domain) => `https://${domain}/*`);
      if (optionalOrigins.length && extensionApi.permissions?.request) {
        const granted = await extensionApi.permissions.request({ origins: optionalOrigins });
        if (!granted) {
          throw new Error("Access to the configured editor sites was not granted.");
        }
      }
      await extensionApi.storage.local.set({
        [SITES_KEY]: { sites },
        [FEATURES_KEY]: {
          equations: equationsInput.checked,
          tables: tablesInput.checked,
          figures: figuresInput.checked
        }
      });
      const response = await extensionApi.runtime.sendMessage({
        type: "smarttex-sync-editor-sites"
      });
      if (response?.ok === false) {
        throw new Error(response.error || "SmartTeX could not activate the configured sites.");
      }
      sitesInput.value = sites.join("\n");
      status.textContent = "Options saved. Reload open editor tabs to activate changes.";
    } catch (error) {
      status.textContent = error?.message || String(error);
    }
  });

  load().catch((error) => {
    status.textContent = error?.message || String(error);
  });
})();
