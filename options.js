/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const SITES_KEY = "smarttex:editor-sites:v1";
  const FEATURES_KEY = "smarttex:features:v1";
  const AUTOCOMPLETE_KEY = "smarttex:autocomplete:v1";
  const REFERENCE_POPUPS_KEY = "smarttex:reference-popups:v1";
  const STRUCTURE_HIGHLIGHT_KEY = "smarttex:structure-highlight:v1";
  const LABEL_REFERENCE_GUARD_KEY = "smarttex:label-reference-guard:v1";
  const COMMENT_PROFILE_KEY = globalThis.SmartTeXCommentProfile?.KEY || "smarttex:comment-profile:v1";
  const GIPHY_SETTINGS_KEY = globalThis.SmartTeXGiphyIntegration?.SETTINGS_KEY || "smarttex:giphy-settings:v1";
  const GIPHY_CONSENT_KEY = globalThis.SmartTeXGiphyIntegration?.CONSENT_KEY || "smarttex:giphy-consent:v1";
  const GIPHY_FOCUS_PERSONAL_KEY_KEY = globalThis.SmartTeXGiphyIntegration?.FOCUS_PERSONAL_KEY_KEY || "smarttex:giphy-focus-personal-key:v1";

  const DEFAULT_SITES = ["collabtex.helmholtz.cloud"];
  const DEFAULT_FEATURES = Object.freeze({ equations: true, tables: true, figures: true });
  const DEFAULT_AUTOCOMPLETE = Object.freeze({ referenceOrder: "document" });
  const DEFAULT_POPUPS = Object.freeze({ trigger: "cursor", environmentTrigger: "cursor" });
  const DEFAULT_LABEL_GUARD = Object.freeze({ enabled: true });
  const DEFAULT_HIGHLIGHTS = Object.freeze({
    environmentEnabled: true,
    environmentColor: "#dfedfb",
    environmentFirstLineEnabled: true,
    environmentFirstLineColor: "#c7e4ff",
    sectionEnabled: true,
    sectionColor: "#c4a7ff",
    captionEnabled: false,
    captionColor: "#70afea",
    labelEnabled: false,
    labelColor: "#8fd19e",
    referenceEnabled: true,
    referenceColor: "#bcf0c8",
    nonumberEnabled: false,
    nonumberColor: "#ffe69a",
    inlineMathEnabled: true,
    inlineMathColor: "#cce5ff",
    activeEnabled: true,
    activeStrength: 55
  });
  const BUILT_IN_SITES = new Set(DEFAULT_SITES);

  const form = document.querySelector("#smarttex-options-form");
  const sitesInput = document.querySelector("#smarttex-editor-sites");
  const equationsInput = document.querySelector("#smarttex-feature-equations");
  const tablesInput = document.querySelector("#smarttex-feature-tables");
  const figuresInput = document.querySelector("#smarttex-feature-figures");
  const referenceOrderInput = document.querySelector("#smarttex-reference-order");
  const referencePopupTriggerInput = document.querySelector("#smarttex-reference-popup-trigger");
  const environmentPopupTriggerInput = document.querySelector("#smarttex-environment-popup-trigger");
  const labelReferenceGuardInput = document.querySelector("#smarttex-label-reference-guard-enabled");
  const commentNameInput = document.querySelector("#smarttex-comment-user-name");
  const commentColorInput = document.querySelector("#smarttex-comment-user-color");
  const giphyApiKeyInput = document.querySelector("#smarttex-giphy-api-key");
  const giphyToggleKeyButton = document.querySelector("#smarttex-giphy-toggle-key");
  const giphyKeyHelpButton = document.querySelector("#smarttex-giphy-key-help");
  const giphyKeyHelpOverlay = document.querySelector("#smarttex-giphy-key-help-overlay");
  const giphyKeyHelpClose = document.querySelector("#smarttex-giphy-key-help-close");
  const giphyKeyHelpDone = document.querySelector("#smarttex-giphy-key-help-done");
  const giphyConsentStatus = document.querySelector("#smarttex-giphy-consent-status");
  const giphyWithdrawConsentButton = document.querySelector("#smarttex-giphy-withdraw-consent");
  const status = document.querySelector("#smarttex-options-status");
  const activeStrengthOutput = document.querySelector("#smarttex-highlight-active-strength-output");

  const highlightControls = {
    environmentEnabled: document.querySelector("#smarttex-highlight-environment-enabled"),
    environmentColor: document.querySelector("#smarttex-highlight-environment-color"),
    environmentFirstLineEnabled: document.querySelector("#smarttex-highlight-environment-first-line-enabled"),
    environmentFirstLineColor: document.querySelector("#smarttex-highlight-environment-first-line-color"),
    sectionEnabled: document.querySelector("#smarttex-highlight-section-enabled"),
    sectionColor: document.querySelector("#smarttex-highlight-section-color"),
    captionEnabled: document.querySelector("#smarttex-highlight-caption-enabled"),
    captionColor: document.querySelector("#smarttex-highlight-caption-color"),
    labelEnabled: document.querySelector("#smarttex-highlight-label-enabled"),
    labelColor: document.querySelector("#smarttex-highlight-label-color"),
    referenceEnabled: document.querySelector("#smarttex-highlight-reference-enabled"),
    referenceColor: document.querySelector("#smarttex-highlight-reference-color"),
    nonumberEnabled: document.querySelector("#smarttex-highlight-nonumber-enabled"),
    nonumberColor: document.querySelector("#smarttex-highlight-nonumber-color"),
    inlineMathEnabled: document.querySelector("#smarttex-highlight-inline-math-enabled"),
    inlineMathColor: document.querySelector("#smarttex-highlight-inline-math-color"),
    activeEnabled: document.querySelector("#smarttex-highlight-active-enabled"),
    activeStrength: document.querySelector("#smarttex-highlight-active-strength")
  };

  let loading = true;
  let saveTimer = 0;
  let saveRevision = 0;
  let saveQueue = Promise.resolve();
  let lastSiteFingerprint = "";
  let commentProfileState = null;
  let commentNameEdited = false;

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
      sitesInput.value.split(/\r?\n/).map(normalizeDomain).filter(Boolean)
    )];
  }

  function validColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""))
      ? String(value).toLowerCase()
      : fallback;
  }

  function highlightSettingsFromForm() {
    return Object.fromEntries(
      Object.entries(highlightControls).map(([key, control]) => {
        if (control.type === "checkbox") return [key, control.checked];
        if (control.type === "range") {
          return [key, Math.max(0, Math.min(100, Number(control.value) || 0))];
        }
        return [key, validColor(control.value, DEFAULT_HIGHLIGHTS[key])];
      })
    );
  }

  function updateActiveStrengthOutput() {
    const control = highlightControls.activeStrength;
    if (!activeStrengthOutput || !control) return;
    activeStrengthOutput.value = `${Math.round(Number(control.value) || 0)}%`;
    activeStrengthOutput.textContent = activeStrengthOutput.value;
    control.disabled = highlightControls.activeEnabled?.checked === false;
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
          figures: figuresInput.checked
        },
        [AUTOCOMPLETE_KEY]: {
          referenceOrder: referenceOrderInput.value === "alphabetical"
            ? "alphabetical"
            : "document"
        },
        [REFERENCE_POPUPS_KEY]: {
          trigger: referencePopupTriggerInput.value === "hover" ? "hover" : "cursor",
          environmentTrigger: environmentPopupTriggerInput.value === "hover" ? "hover" : "cursor"
        },
        [LABEL_REFERENCE_GUARD_KEY]: {
          enabled: labelReferenceGuardInput.checked
        },
        [COMMENT_PROFILE_KEY]: globalThis.SmartTeXCommentProfile?.normalize?.({
          name: commentNameInput?.value,
          color: commentColorInput?.value,
          nameSource: commentNameEdited ? "manual" : commentProfileState?.nameSource
        }, commentProfileState) || {
          name: String(commentNameInput?.value || "Anonymous").trim().slice(0, 80) || "Anonymous",
          color: validColor(commentColorInput?.value, "#268bd2"),
          nameSource: commentNameEdited ? "manual" : (commentProfileState?.nameSource || "manual")
        },
        [GIPHY_SETTINGS_KEY]: globalThis.SmartTeXGiphyIntegration?.normalizeSettings?.({
          apiKey: giphyApiKeyInput?.value
        }) || { apiKey: String(giphyApiKeyInput?.value || "").trim().slice(0, 300) },
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
      if (!granted) throw new Error("Access to one or more configured editor sites was not granted.");
      await extensionApi.storage.local.set(settings.storage);

      if (synchronizeSites) {
        const response = await extensionApi.runtime.sendMessage({ type: "smarttex-sync-editor-sites" });
        if (response?.ok === false) {
          throw new Error(response.error || "SmartTeX could not activate the configured sites.");
        }
        lastSiteFingerprint = settings.sites.join("\n");
        if (revision === saveRevision) sitesInput.value = lastSiteFingerprint;
      }
      if (revision === saveRevision) showStatus("Saved.");
    }).catch((error) => {
      if (revision === saveRevision) showStatus(error?.message || String(error), true);
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

  function setHighlightControl(key, value) {
    const control = highlightControls[key];
    if (!control) return;
    if (control.type === "checkbox") control.checked = value !== false;
    else control.value = String(value);
  }

  const resetActions = {
    sites() {
      sitesInput.value = DEFAULT_SITES.join("\n");
      save({ requestPermissions: true, synchronizeSites: true });
    },
    equations() { equationsInput.checked = DEFAULT_FEATURES.equations; scheduleSave(); },
    tables() { tablesInput.checked = DEFAULT_FEATURES.tables; scheduleSave(); },
    figures() { figuresInput.checked = DEFAULT_FEATURES.figures; scheduleSave(); },
    referencePopupTrigger() { referencePopupTriggerInput.value = DEFAULT_POPUPS.trigger; scheduleSave(); },
    environmentPopupTrigger() { environmentPopupTriggerInput.value = DEFAULT_POPUPS.environmentTrigger; scheduleSave(); },
    labelReferenceGuard() { labelReferenceGuardInput.checked = DEFAULT_LABEL_GUARD.enabled; scheduleSave(); },
    referenceOrder() { referenceOrderInput.value = DEFAULT_AUTOCOMPLETE.referenceOrder; scheduleSave(); },
    environmentHighlight() {
      setHighlightControl("environmentEnabled", DEFAULT_HIGHLIGHTS.environmentEnabled);
      setHighlightControl("environmentColor", DEFAULT_HIGHLIGHTS.environmentColor);
      scheduleSave();
    },
    environmentFirstLineHighlight() {
      setHighlightControl("environmentFirstLineEnabled", DEFAULT_HIGHLIGHTS.environmentFirstLineEnabled);
      setHighlightControl("environmentFirstLineColor", DEFAULT_HIGHLIGHTS.environmentFirstLineColor);
      scheduleSave();
    },
    sectionHighlight() {
      setHighlightControl("sectionEnabled", DEFAULT_HIGHLIGHTS.sectionEnabled);
      setHighlightControl("sectionColor", DEFAULT_HIGHLIGHTS.sectionColor);
      scheduleSave();
    },
    captionHighlight() {
      setHighlightControl("captionEnabled", DEFAULT_HIGHLIGHTS.captionEnabled);
      setHighlightControl("captionColor", DEFAULT_HIGHLIGHTS.captionColor);
      scheduleSave();
    },
    labelHighlight() {
      setHighlightControl("labelEnabled", DEFAULT_HIGHLIGHTS.labelEnabled);
      setHighlightControl("labelColor", DEFAULT_HIGHLIGHTS.labelColor);
      scheduleSave();
    },
    referenceHighlight() {
      setHighlightControl("referenceEnabled", DEFAULT_HIGHLIGHTS.referenceEnabled);
      setHighlightControl("referenceColor", DEFAULT_HIGHLIGHTS.referenceColor);
      scheduleSave();
    },
    nonumberHighlight() {
      setHighlightControl("nonumberEnabled", DEFAULT_HIGHLIGHTS.nonumberEnabled);
      setHighlightControl("nonumberColor", DEFAULT_HIGHLIGHTS.nonumberColor);
      scheduleSave();
    },
    inlineMathHighlight() {
      setHighlightControl("inlineMathEnabled", DEFAULT_HIGHLIGHTS.inlineMathEnabled);
      setHighlightControl("inlineMathColor", DEFAULT_HIGHLIGHTS.inlineMathColor);
      scheduleSave();
    },
    activeEnabled() {
      setHighlightControl("activeEnabled", DEFAULT_HIGHLIGHTS.activeEnabled);
      updateActiveStrengthOutput();
      scheduleSave();
    },
    activeStrength() {
      setHighlightControl("activeStrength", DEFAULT_HIGHLIGHTS.activeStrength);
      updateActiveStrengthOutput();
      scheduleSave();
    }
  };

  async function load() {
    const ensuredProfile = await globalThis.SmartTeXCommentProfile?.ensure?.(extensionApi.storage.local);
    const stored = await extensionApi.storage.local.get([
      SITES_KEY,
      FEATURES_KEY,
      AUTOCOMPLETE_KEY,
      REFERENCE_POPUPS_KEY,
      LABEL_REFERENCE_GUARD_KEY,
      COMMENT_PROFILE_KEY,
      GIPHY_SETTINGS_KEY,
      GIPHY_CONSENT_KEY,
      GIPHY_FOCUS_PERSONAL_KEY_KEY,
      STRUCTURE_HIGHLIGHT_KEY
    ]);

    const sites = Array.isArray(stored?.[SITES_KEY]?.sites)
      ? stored[SITES_KEY].sites
      : DEFAULT_SITES;
    const normalizedSites = sites.map(normalizeDomain).filter(Boolean);
    sitesInput.value = normalizedSites.join("\n");
    lastSiteFingerprint = normalizedSites.join("\n");

    const features = { ...DEFAULT_FEATURES, ...(stored?.[FEATURES_KEY] || {}) };
    equationsInput.checked = features.equations !== false;
    tablesInput.checked = features.tables !== false;
    figuresInput.checked = features.figures !== false;

    const autocomplete = stored?.[AUTOCOMPLETE_KEY] || DEFAULT_AUTOCOMPLETE;
    referenceOrderInput.value = autocomplete.referenceOrder === "alphabetical"
      ? "alphabetical"
      : "document";

    const popupSettings = stored?.[REFERENCE_POPUPS_KEY] || DEFAULT_POPUPS;
    referencePopupTriggerInput.value = popupSettings.trigger === "hover" ? "hover" : "cursor";
    environmentPopupTriggerInput.value = popupSettings.environmentTrigger === "hover" ? "hover" : "cursor";
    labelReferenceGuardInput.checked = stored?.[LABEL_REFERENCE_GUARD_KEY]?.enabled !== false;

    const commentProfile = globalThis.SmartTeXCommentProfile?.normalize?.(stored?.[COMMENT_PROFILE_KEY], ensuredProfile)
      || stored?.[COMMENT_PROFILE_KEY]
      || ensuredProfile
      || { name: "Anonymous", color: "#268bd2", nameSource: "manual" };
    commentProfileState = commentProfile;
    commentNameEdited = false;
    if (commentNameInput) commentNameInput.value = commentProfile.name || "Anonymous";
    if (commentColorInput) commentColorInput.value = validColor(commentProfile.color, "#268bd2");

    const giphySettings = globalThis.SmartTeXGiphyIntegration?.normalizeSettings?.(stored?.[GIPHY_SETTINGS_KEY])
      || { apiKey: String(stored?.[GIPHY_SETTINGS_KEY]?.apiKey || "") };
    if (giphyApiKeyInput) giphyApiKeyInput.value = giphySettings.apiKey || "";
    const consent = stored?.[GIPHY_CONSENT_KEY];
    const consentAccepted = Boolean(consent?.accepted === true && Number(consent?.noticeVersion) === (globalThis.SmartTeXGiphyIntegration?.CONSENT_VERSION || 1));
    if (giphyConsentStatus) giphyConsentStatus.textContent = consentAccepted ? "Granted" : "Not granted";
    if (giphyWithdrawConsentButton) giphyWithdrawConsentButton.disabled = !consentAccepted;
    if (stored?.[GIPHY_FOCUS_PERSONAL_KEY_KEY]) {
      await extensionApi.storage.local.remove(GIPHY_FOCUS_PERSONAL_KEY_KEY);
      window.setTimeout(() => {
        giphyApiKeyInput?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        giphyApiKeyInput?.focus?.();
      }, 80);
    }

    const storedHighlights = stored?.[STRUCTURE_HIGHLIGHT_KEY] || {};
    const merged = { ...DEFAULT_HIGHLIGHTS, ...storedHighlights };
    const hasLegacyCombinedHighlight = storedHighlights.enabled !== undefined || storedHighlights.color !== undefined;
    const legacyEnvironmentEnabled = storedHighlights.environmentEnabled !== undefined
      ? storedHighlights.environmentEnabled !== false
      : storedHighlights.enabled !== false;
    const legacyEnvironmentColor = validColor(
      storedHighlights.environmentColor || storedHighlights.color,
      DEFAULT_HIGHLIGHTS.environmentColor
    );
    merged.environmentEnabled = legacyEnvironmentEnabled;
    merged.environmentColor = legacyEnvironmentColor;
    if (hasLegacyCombinedHighlight && storedHighlights.environmentFirstLineEnabled === undefined) {
      merged.environmentFirstLineEnabled = legacyEnvironmentEnabled;
    }
    if (hasLegacyCombinedHighlight && storedHighlights.environmentFirstLineColor === undefined) {
      merged.environmentFirstLineColor = legacyEnvironmentColor;
    }
    if (hasLegacyCombinedHighlight && storedHighlights.sectionEnabled === undefined) merged.sectionEnabled = legacyEnvironmentEnabled;
    if (hasLegacyCombinedHighlight && storedHighlights.sectionColor === undefined) merged.sectionColor = legacyEnvironmentColor;

    for (const [key, control] of Object.entries(highlightControls)) {
      if (control.type === "checkbox") control.checked = merged[key] !== false;
      else if (control.type === "range") {
        const numeric = Number(merged[key]);
        control.value = String(Math.max(0, Math.min(100,
          Number.isFinite(numeric) ? numeric : DEFAULT_HIGHLIGHTS[key]
        )));
      } else {
        control.value = validColor(merged[key], DEFAULT_HIGHLIGHTS[key]);
      }
    }
    updateActiveStrengthOutput();

    loading = false;
    showStatus("Saved.");
  }

  document.querySelector("#smarttex-highlight-reset")?.addEventListener("click", () => {
    for (const [key, value] of Object.entries(DEFAULT_HIGHLIGHTS)) setHighlightControl(key, value);
    updateActiveStrengthOutput();
    scheduleSave();
  });

  for (const button of document.querySelectorAll("[data-reset-setting]")) {
    button.addEventListener("click", () => resetActions[button.dataset.resetSetting]?.());
  }

  function setGiphyKeyHelpOpen(open) {
    if (!giphyKeyHelpOverlay) return;
    giphyKeyHelpOverlay.hidden = !open;
    document.documentElement.classList.toggle("smarttex-options-overlay-open", Boolean(open));
    if (open) {
      window.setTimeout(() => giphyKeyHelpClose?.focus?.(), 0);
    } else {
      giphyKeyHelpButton?.focus?.();
    }
  }

  giphyKeyHelpButton?.addEventListener("click", () => setGiphyKeyHelpOpen(true));
  giphyKeyHelpClose?.addEventListener("click", () => setGiphyKeyHelpOpen(false));
  giphyKeyHelpDone?.addEventListener("click", () => setGiphyKeyHelpOpen(false));
  giphyKeyHelpOverlay?.addEventListener("click", (event) => {
    if (event.target === giphyKeyHelpOverlay) setGiphyKeyHelpOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && giphyKeyHelpOverlay && !giphyKeyHelpOverlay.hidden) {
      event.preventDefault();
      setGiphyKeyHelpOpen(false);
    }
  });

  giphyToggleKeyButton?.addEventListener("click", () => {
    if (!giphyApiKeyInput) return;
    const showing = giphyApiKeyInput.type === "text";
    giphyApiKeyInput.type = showing ? "password" : "text";
    giphyToggleKeyButton.textContent = showing ? "Show key" : "Hide key";
    giphyApiKeyInput.focus();
  });

  giphyWithdrawConsentButton?.addEventListener("click", async () => {
    try {
      await globalThis.SmartTeXGiphyIntegration?.withdrawConsent?.();
      if (giphyConsentStatus) giphyConsentStatus.textContent = "Not granted";
      giphyWithdrawConsentButton.disabled = true;
      showStatus("GIPHY consent withdrawn.");
    } catch (error) {
      showStatus(error?.message || String(error), true);
    }
  });

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes?.[COMMENT_PROFILE_KEY]?.newValue) {
      const nextProfile = globalThis.SmartTeXCommentProfile?.normalize?.(
        changes[COMMENT_PROFILE_KEY].newValue,
        commentProfileState
      ) || changes[COMMENT_PROFILE_KEY].newValue;
      commentProfileState = nextProfile;
      // Reflect an automatically discovered CollabTeX name while the options
      // page is open, but never disturb a name field the user is editing.
      if (!commentNameEdited && document.activeElement !== commentNameInput && commentNameInput) {
        commentNameInput.value = nextProfile.name || "Anonymous";
      }
      if (document.activeElement !== commentColorInput && commentColorInput) {
        commentColorInput.value = validColor(nextProfile.color, "#268bd2");
      }
    }
    if (changes?.[GIPHY_CONSENT_KEY]) {
      const value = changes[GIPHY_CONSENT_KEY].newValue;
      const accepted = Boolean(value?.accepted === true && Number(value?.noticeVersion) === (globalThis.SmartTeXGiphyIntegration?.CONSENT_VERSION || 1));
      if (giphyConsentStatus) giphyConsentStatus.textContent = accepted ? "Granted" : "Not granted";
      if (giphyWithdrawConsentButton) giphyWithdrawConsentButton.disabled = !accepted;
    }
  });

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", (event) => {
    if (event.target === commentNameInput) commentNameEdited = true;
    if (event.target === highlightControls.activeStrength || event.target === highlightControls.activeEnabled) {
      updateActiveStrengthOutput();
    }
    if (event.target === sitesInput) {
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

  globalThis.SmartTeXPrivacyConsent?.showIfNeeded();
})();
