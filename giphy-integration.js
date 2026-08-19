/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.SmartTeXGiphyIntegration) return;

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const SETTINGS_KEY = "smarttex:giphy-settings:v1";
  const CONSENT_KEY = "smarttex:giphy-consent:v1";
  const CLIENT_ID_KEY = "smarttex:giphy-customer-id:v1";
  const BUNDLED_USAGE_KEY = "smarttex:giphy-bundled-usage:v1";
  const FOCUS_PERSONAL_KEY_KEY = "smarttex:giphy-focus-personal-key:v1";
  const BUNDLED_API_KEY = "4kDYisPJ86gyWUqz7DFqYiYhk1ZBv5c2";
  const BUNDLED_INSERT_SOFT_PROMPT_AFTER = 5;
  const BUNDLED_INSERT_HOURLY_HARD_LIMIT = 10;
  const BUNDLED_API_CALL_SOFT_PROMPT_AFTER = 10;
  const BUNDLED_API_CALL_HOURLY_HARD_LIMIT = 20;
  const BUNDLED_TOTAL_INSERT_HARD_LIMIT = 50;
  const BUNDLED_USAGE_WINDOW_MS = 60 * 60 * 1000;
  // Backward-compatible aliases retained for existing SmartTeX callers/tests.
  const BUNDLED_SOFT_PROMPT_AFTER = BUNDLED_INSERT_SOFT_PROMPT_AFTER;
  const BUNDLED_HOURLY_HARD_LIMIT = BUNDLED_INSERT_HOURLY_HARD_LIMIT;
  const BUNDLED_TOTAL_HARD_LIMIT = BUNDLED_TOTAL_INSERT_HARD_LIMIT;
  const BUNDLED_INSERT_WINDOW_MS = BUNDLED_USAGE_WINDOW_MS;
  const GIPHY_PAGE_SIZE = 50;
  const GIPHY_MAX_OFFSET = 4999;
  const CONSENT_VERSION = 1;
  const PRIVACY_URL = "https://support.giphy.com/hc/en-us/articles/360032872931-GIPHY-Privacy-Policy";
  const API_TERMS_URL = "https://support.giphy.com/hc/en-us/articles/360028134111-GIPHY-API-Terms-of-Service";
  const GIPHY_URL = "https://giphy.com/";
  const API_BASE = "https://api.giphy.com/v1/gifs";
  const CONSENT_OVERLAY_ID = "smarttex-giphy-consent-overlay";
  const CONSENT_STYLE_ID = "smarttex-giphy-consent-style";
  const CONSENT_CHANGED_EVENT = "smarttex:giphy-consent-changed";
  const KEY_LIMIT_OVERLAY_ID = "smarttex-giphy-key-limit-overlay";

  let consentPromise = null;
  let keyLimitPromptPromise = null;
  let viewerPromptedThisSession = false;

  function normalizeSettings(value = {}) {
    return {
      apiKey: String(value?.apiKey || "").trim().slice(0, 300)
    };
  }

  async function readSettings() {
    if (typeof extensionApi?.storage?.local?.get !== "function") return normalizeSettings();
    const stored = await extensionApi.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(stored?.[SETTINGS_KEY]);
  }

  async function saveSettings(value = {}) {
    const settings = normalizeSettings(value);
    await extensionApi.storage.local.set({ [SETTINGS_KEY]: settings });
    return settings;
  }

  async function effectiveApiKey() {
    const settings = await readSettings();
    return {
      apiKey: settings.apiKey || BUNDLED_API_KEY,
      usesBundledKey: !settings.apiKey
    };
  }

  function normalizeUsageTimestamps(values, now, limit) {
    const cutoff = Number(now) - BUNDLED_USAGE_WINDOW_MS;
    return (Array.isArray(values) ? values : [])
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > cutoff && entry <= Number(now))
      .sort((a, b) => a - b)
      .slice(-limit);
  }

  function normalizeBundledUsage(value, now = Date.now()) {
    // Migrate the 2.1.3-2.1.6 insertion-only shape without losing existing totals.
    const legacyInsertions = Array.isArray(value?.timestamps) ? value.timestamps : [];
    const insertionTimestamps = normalizeUsageTimestamps(
      Array.isArray(value?.insertionTimestamps) ? value.insertionTimestamps : legacyInsertions,
      now,
      BUNDLED_INSERT_HOURLY_HARD_LIMIT
    );
    const apiCallTimestamps = normalizeUsageTimestamps(
      value?.apiCallTimestamps,
      now,
      BUNDLED_API_CALL_HOURLY_HARD_LIMIT
    );
    const storedTotal = Number(value?.totalInsertions ?? value?.totalCount);
    const totalInsertions = Number.isFinite(storedTotal)
      ? Math.max(0, Math.floor(storedTotal))
      : insertionTimestamps.length;
    return { insertionTimestamps, apiCallTimestamps, totalInsertions };
  }

  async function bundledUsageState(now = Date.now()) {
    const settings = await readSettings();
    if (settings.apiKey) {
      return {
        usesBundledKey: false,
        insertionCount: 0,
        apiCallCount: 0,
        totalInsertions: 0,
        count: 0,
        totalCount: 0,
        remainingInsertions: Infinity,
        remainingApiCalls: Infinity,
        remainingTotalInsertions: Infinity,
        shouldSuggestPersonalKey: false,
        requiresPersonalKey: false,
        allowed: true
      };
    }
    const stored = await extensionApi.storage.local.get(BUNDLED_USAGE_KEY);
    const normalized = normalizeBundledUsage(stored?.[BUNDLED_USAGE_KEY], now);
    const insertionCount = normalized.insertionTimestamps.length;
    const apiCallCount = normalized.apiCallTimestamps.length;
    const totalInsertions = normalized.totalInsertions;
    if (JSON.stringify(stored?.[BUNDLED_USAGE_KEY] || {}) !== JSON.stringify(normalized)) {
      await extensionApi.storage.local.set({ [BUNDLED_USAGE_KEY]: normalized });
    }
    const requiresPersonalKey = (
      insertionCount >= BUNDLED_INSERT_HOURLY_HARD_LIMIT ||
      apiCallCount >= BUNDLED_API_CALL_HOURLY_HARD_LIMIT ||
      totalInsertions >= BUNDLED_TOTAL_INSERT_HARD_LIMIT
    );
    const shouldSuggestPersonalKey = !requiresPersonalKey && (
      insertionCount >= BUNDLED_INSERT_SOFT_PROMPT_AFTER ||
      apiCallCount >= BUNDLED_API_CALL_SOFT_PROMPT_AFTER
    );
    return {
      usesBundledKey: true,
      insertionCount,
      apiCallCount,
      totalInsertions,
      // Keep the old aliases for compatibility with older UI/tests.
      count: insertionCount,
      totalCount: totalInsertions,
      remainingInsertions: Math.max(0, BUNDLED_INSERT_HOURLY_HARD_LIMIT - insertionCount),
      remainingApiCalls: Math.max(0, BUNDLED_API_CALL_HOURLY_HARD_LIMIT - apiCallCount),
      remainingTotalInsertions: Math.max(0, BUNDLED_TOTAL_INSERT_HARD_LIMIT - totalInsertions),
      shouldSuggestPersonalKey,
      requiresPersonalKey,
      allowed: !requiresPersonalKey
    };
  }

  async function recordGifInsertion(now = Date.now()) {
    const settings = await readSettings();
    if (settings.apiKey) return bundledUsageState(now);
    const stored = await extensionApi.storage.local.get(BUNDLED_USAGE_KEY);
    const normalized = normalizeBundledUsage(stored?.[BUNDLED_USAGE_KEY], now);
    normalized.insertionTimestamps.push(Number(now));
    normalized.insertionTimestamps = normalized.insertionTimestamps.slice(-BUNDLED_INSERT_HOURLY_HARD_LIMIT);
    normalized.totalInsertions += 1;
    await extensionApi.storage.local.set({ [BUNDLED_USAGE_KEY]: normalized });
    return bundledUsageState(now);
  }

  async function recordApiCall(now = Date.now()) {
    const settings = await readSettings();
    if (settings.apiKey) return bundledUsageState(now);
    const stored = await extensionApi.storage.local.get(BUNDLED_USAGE_KEY);
    const normalized = normalizeBundledUsage(stored?.[BUNDLED_USAGE_KEY], now);
    normalized.apiCallTimestamps.push(Number(now));
    normalized.apiCallTimestamps = normalized.apiCallTimestamps.slice(-BUNDLED_API_CALL_HOURLY_HARD_LIMIT);
    await extensionApi.storage.local.set({ [BUNDLED_USAGE_KEY]: normalized });
    return bundledUsageState(now);
  }

  function acceptedConsent(value) {
    return Boolean(value?.accepted === true && Number(value?.noticeVersion) === CONSENT_VERSION);
  }

  async function readConsent() {
    if (typeof extensionApi?.storage?.local?.get !== "function") return null;
    const stored = await extensionApi.storage.local.get(CONSENT_KEY);
    return stored?.[CONSENT_KEY] || null;
  }

  async function hasConsent() {
    return acceptedConsent(await readConsent());
  }

  function dispatchConsentChanged(accepted) {
    try {
      window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, {
        detail: JSON.stringify({ accepted: Boolean(accepted) })
      }));
    } catch (_error) {}
  }

  async function acceptConsent() {
    const value = {
      accepted: true,
      acceptedAt: new Date().toISOString(),
      noticeVersion: CONSENT_VERSION
    };
    await extensionApi.storage.local.set({ [CONSENT_KEY]: value });
    dispatchConsentChanged(true);
    return value;
  }

  async function withdrawConsent() {
    await extensionApi.storage.local.remove([CONSENT_KEY, CLIENT_ID_KEY]);
    viewerPromptedThisSession = false;
    dispatchConsentChanged(false);
  }

  async function openExternal(url) {
    const target = String(url || "");
    if (!/^https:\/\//i.test(target)) return;
    try {
      const response = await extensionApi.runtime.sendMessage({
        type: "smarttex-open-external-tab",
        url: target,
        active: true
      });
      if (response?.ok) return;
    } catch (_error) {}
    globalThis.open?.(target, "_blank", "noopener,noreferrer");
  }

  async function openOptions() {
    try {
      await extensionApi.runtime.openOptionsPage();
    } catch (_error) {
      try {
        await extensionApi.runtime.sendMessage({ type: "smarttex-open-options" });
      } catch (_ignored) {}
    }
  }

  function requestPersonalKeyForLimit({ required = false, state = null, reason = "usage" } = {}) {
    if (keyLimitPromptPromise) return keyLimitPromptPromise;
    keyLimitPromptPromise = new Promise((resolve) => {
      installConsentStyles();
      document.getElementById(KEY_LIMIT_OVERLAY_ID)?.remove?.();
      const overlay = document.createElement("div");
      overlay.id = KEY_LIMIT_OVERLAY_ID;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-labelledby", "smarttex-giphy-key-limit-title");

      const insertionCount = Math.max(0, Number(state?.insertionCount ?? state?.count) || 0);
      const apiCallCount = Math.max(0, Number(state?.apiCallCount) || 0);
      const totalInsertions = Math.max(0, Number(state?.totalInsertions ?? state?.totalCount) || 0);
      const reachedHourlyInsertions = insertionCount >= BUNDLED_INSERT_HOURLY_HARD_LIMIT;
      const reachedHourlyApiCalls = apiCallCount >= BUNDLED_API_CALL_HOURLY_HARD_LIMIT;
      const reachedTotalInsertions = totalInsertions >= BUNDLED_TOTAL_INSERT_HARD_LIMIT;
      const currentAction = reason === "apiCall" ? "load more GIFs or run another GIPHY search" : "insert another GIF";
      let explanation = "";
      if (required) {
        const reasons = [];
        if (reachedHourlyInsertions) reasons.push(`${BUNDLED_INSERT_HOURLY_HARD_LIMIT} GIF insertions during the last hour`);
        if (reachedHourlyApiCalls) reasons.push(`${BUNDLED_API_CALL_HOURLY_HARD_LIMIT} GIPHY API calls during the last hour`);
        if (reachedTotalInsertions) reasons.push(`${BUNDLED_TOTAL_INSERT_HARD_LIMIT} GIF insertions in total with SmartTeX's shared key`);
        explanation = reasons.length
          ? `You have reached the shared-key allowance: ${reasons.join(" and ")}.`
          : "You have reached SmartTeX's shared-key allowance.";
      }

      overlay.innerHTML = required ? `
        <div class="smarttex-giphy-consent-dialog">
          <div class="smarttex-giphy-consent-heading">
            <h2 id="smarttex-giphy-key-limit-title">Your own GIPHY API key is needed</h2>
          </div>
          <div class="smarttex-giphy-consent-body">
            <p>${explanation}</p>
            <p class="smarttex-giphy-consent-note">
              To ${currentAction}, please add your own GIPHY API key in SmartTeX Options.
              The Options page includes a short step-by-step guide next to the key field.
            </p>
          </div>
          <div class="smarttex-giphy-consent-actions">
            <button type="button" class="smarttex-giphy-consent-later">Not now</button>
            <button type="button" class="smarttex-giphy-consent-accept">Open Options</button>
          </div>
        </div>
      ` : `
        <div class="smarttex-giphy-consent-dialog">
          <div class="smarttex-giphy-consent-heading">
            <h2 id="smarttex-giphy-key-limit-title">Would you like to add your own GIPHY API key?</h2>
          </div>
          <div class="smarttex-giphy-consent-body">
            <p>SmartTeX's shared GIPHY key has been used for ${insertionCount} GIF insertion${insertionCount === 1 ? "" : "s"} and ${apiCallCount} API call${apiCallCount === 1 ? "" : "s"} during the last hour.</p>
            <p class="smarttex-giphy-consent-note">
              You can continue with the shared key for now. A personal key is required only after
              ${BUNDLED_INSERT_HOURLY_HARD_LIMIT} GIF insertions or ${BUNDLED_API_CALL_HOURLY_HARD_LIMIT} GIPHY API calls in a rolling hour,
              or after ${BUNDLED_TOTAL_INSERT_HARD_LIMIT} total shared-key GIF insertions.
              Using your own key also enables automatic infinite scrolling in the GIF chooser.
            </p>
          </div>
          <div class="smarttex-giphy-consent-actions">
            <button type="button" class="smarttex-giphy-consent-later">Continue with shared key</button>
            <button type="button" class="smarttex-giphy-consent-accept">Add my own key</button>
          </div>
        </div>
      `;
      document.documentElement.appendChild(overlay);
      const finish = (allowAction) => {
        overlay.remove();
        keyLimitPromptPromise = null;
        resolve(Boolean(allowAction));
      };
      overlay.querySelector(".smarttex-giphy-consent-later")?.addEventListener("click", () => finish(!required));
      overlay.querySelector(".smarttex-giphy-consent-accept")?.addEventListener("click", async () => {
        await extensionApi.storage.local.set({ [FOCUS_PERSONAL_KEY_KEY]: Date.now() });
        await openOptions();
        finish(false);
      });
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") finish(!required);
      });
      queueMicrotask(() => {
        const preferred = required ? ".smarttex-giphy-consent-accept" : ".smarttex-giphy-consent-later";
        overlay.querySelector(preferred)?.focus?.();
      });
    });
    return keyLimitPromptPromise;
  }

  async function ensureSharedUsageAllowed({ prompt = true, now = Date.now(), reason = "usage" } = {}) {
    const state = await bundledUsageState(now);
    if (!state.usesBundledKey) return true;
    if (state.requiresPersonalKey) {
      if (prompt) await requestPersonalKeyForLimit({ required: true, state, reason });
      return false;
    }
    const shouldPromptForThisAction = reason === "apiCall"
      ? state.apiCallCount >= BUNDLED_API_CALL_SOFT_PROMPT_AFTER
      : reason === "insertion"
        ? state.insertionCount >= BUNDLED_INSERT_SOFT_PROMPT_AFTER
        : state.shouldSuggestPersonalKey;
    if (shouldPromptForThisAction && prompt) {
      return requestPersonalKeyForLimit({ required: false, state, reason });
    }
    return true;
  }

  async function ensureGifInsertionAllowed(options = {}) {
    return ensureSharedUsageAllowed({ ...options, reason: "insertion" });
  }

  async function ensureApiCallAllowed(options = {}) {
    return ensureSharedUsageAllowed({ ...options, reason: "apiCall" });
  }

  function attributionAssetUrl() {
    try {
      return extensionApi.runtime.getURL("icons/giphy-powered-by.png");
    } catch (_error) {
      return "";
    }
  }

  function installConsentStyles() {
    if (document.getElementById(CONSENT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = CONSENT_STYLE_ID;
    style.textContent = `
      #${CONSENT_OVERLAY_ID},
      #${KEY_LIMIT_OVERLAY_ID} {
        position: fixed;
        z-index: 2147483647;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        color-scheme: light dark;
        background: rgb(15 23 42 / 58%);
        backdrop-filter: blur(2px);
        font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-dialog {
        width: min(590px, calc(100vw - 32px));
        overflow: hidden;
        border: 1px solid #cbd5e1;
        border-radius: 16px;
        color: #1e293b;
        background: #fff;
        box-shadow: 0 24px 80px rgb(15 23 42 / 38%);
      }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 22px 24px 14px;
      }
      #${CONSENT_OVERLAY_ID} h2 { margin: 0; font-size: 21px; line-height: 1.2; }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-brand {
        display: inline-flex;
        align-items: center;
        padding: 5px 7px;
        border-radius: 5px;
        background: #4b5563;
      }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-brand img {
        display: block;
        width: 160px;
        max-width: 34vw;
        height: auto;
      }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-body { padding: 0 24px 22px; }
      #${CONSENT_OVERLAY_ID} p { margin: 0 0 13px; }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-note {
        padding: 10px 12px;
        border-radius: 8px;
        background: #f1f5f9;
      }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 18px;
        margin-top: 15px;
      }
      #${CONSENT_OVERLAY_ID} a { color: #0969da; font-weight: 650; }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 16px 24px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
      }
      #${CONSENT_OVERLAY_ID} button {
        min-height: 40px;
        padding: 9px 16px;
        border: 1px solid #b8c5d4;
        border-radius: 9px;
        color: #334155;
        background: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      #${CONSENT_OVERLAY_ID} button:hover { background: #f1f5f9; }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-accept {
        border-color: #1674d1;
        color: #fff;
        background: #1674d1;
      }
      #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-accept:hover { background: #0d63b8; }
      #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-dialog {
        width: min(590px, calc(100vw - 32px)); overflow: hidden; border: 1px solid #cbd5e1;
        border-radius: 16px; color: #1e293b; background: #fff; box-shadow: 0 24px 80px rgb(15 23 42 / 38%);
      }
      #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:22px 24px 14px; }
      #${KEY_LIMIT_OVERLAY_ID} h2 { margin:0; font-size:21px; line-height:1.2; }
      #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-body { padding:0 24px 22px; }
      #${KEY_LIMIT_OVERLAY_ID} p { margin:0 0 13px; }
      #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-note { padding:10px 12px; border-radius:8px; background:#f1f5f9; }
      #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-actions { display:flex; justify-content:flex-end; gap:10px; padding:16px 24px; border-top:1px solid #e2e8f0; background:#f8fafc; }
      #${KEY_LIMIT_OVERLAY_ID} button { min-height:40px; padding:9px 16px; border:1px solid #b8c5d4; border-radius:9px; color:#334155; background:#fff; font:inherit; font-weight:700; cursor:pointer; }
      #${KEY_LIMIT_OVERLAY_ID} button:hover { background:#f1f5f9; }
      #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-accept { border-color:#1674d1; color:#fff; background:#1674d1; }

      @media (prefers-color-scheme: dark) {
        #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-dialog {
          border-color: #475569;
          color: #e5edf7;
          background: #1d2736;
        }
        #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-note { background: #162130; }
        #${CONSENT_OVERLAY_ID} a { color: #78b9ff; }
        #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-actions {
          border-color: #475569;
          background: #162130;
        }
        #${CONSENT_OVERLAY_ID} button {
          border-color: #52657a;
          color: #dce7f3;
          background: #243446;
        }
        #${CONSENT_OVERLAY_ID} button:hover { background: #2d4056; }
        #${CONSENT_OVERLAY_ID} .smarttex-giphy-consent-accept { color: #fff; background: #1674d1; }
        #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-dialog { border-color:#475569; color:#e5edf7; background:#1d2736; }
        #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-note { background:#162130; }
        #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-actions { border-color:#475569; background:#162130; }
        #${KEY_LIMIT_OVERLAY_ID} button { border-color:#52657a; color:#dce7f3; background:#243446; }
        #${KEY_LIMIT_OVERLAY_ID} button:hover { background:#2d4056; }
        #${KEY_LIMIT_OVERLAY_ID} .smarttex-giphy-consent-accept { color:#fff; background:#1674d1; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function requestConsent({ reason = "add" } = {}) {
    if (consentPromise) return consentPromise;
    consentPromise = (async () => {
      if (await hasConsent()) return true;
      installConsentStyles();
      document.getElementById(CONSENT_OVERLAY_ID)?.remove?.();

      const overlay = document.createElement("div");
      overlay.id = CONSENT_OVERLAY_ID;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-labelledby", "smarttex-giphy-consent-title");

      const brandUrl = attributionAssetUrl();
      const actionText = reason === "view"
        ? "To display this GIPHY GIF, SmartTeX must connect your browser directly to GIPHY."
        : "To search for and insert GIFs, SmartTeX must connect your browser directly to GIPHY.";

      overlay.innerHTML = `
        <div class="smarttex-giphy-consent-dialog">
          <div class="smarttex-giphy-consent-heading">
            <h2 id="smarttex-giphy-consent-title">Allow GIPHY content?</h2>
            <a class="smarttex-giphy-consent-brand" href="${GIPHY_URL}" data-smarttex-giphy-external>
              ${brandUrl ? `<img src="${brandUrl}" alt="Powered by GIPHY">` : "Powered by GIPHY"}
            </a>
          </div>
          <div class="smarttex-giphy-consent-body">
            <p>${actionText}</p>
            <p class="smarttex-giphy-consent-note">
              According to GIPHY's Privacy Policy, GIPHY may receive information such as your IP address,
              device/browser identifiers, query data, and cookie information when you interact with its services.
              When you search, the search terms you enter and a GIPHY-generated random customer identifier are
              sent to GIPHY for API analytics. SmartTeX does not request GIPHY API results, analytics, or media
              before you consent.
            </p>
            <p>Your choice is stored locally in this browser and can be withdrawn in SmartTeX options.</p>
            <div class="smarttex-giphy-consent-links">
              <a href="${PRIVACY_URL}" data-smarttex-giphy-external>GIPHY Privacy Policy</a>
              <a href="${API_TERMS_URL}" data-smarttex-giphy-external>GIPHY API Terms</a>
            </div>
          </div>
          <div class="smarttex-giphy-consent-actions">
            <button type="button" class="smarttex-giphy-consent-later">Not now</button>
            <button type="button" class="smarttex-giphy-consent-accept">Allow GIPHY</button>
          </div>
        </div>
      `;

      document.documentElement.appendChild(overlay);
      overlay.querySelectorAll("a[data-smarttex-giphy-external]").forEach((link) => {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          openExternal(link.href);
        });
      });

      return new Promise((resolve) => {
        const finish = (accepted) => {
          overlay.remove();
          resolve(Boolean(accepted));
        };
        overlay.querySelector(".smarttex-giphy-consent-later")?.addEventListener("click", () => finish(false));
        overlay.querySelector(".smarttex-giphy-consent-accept")?.addEventListener("click", async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await acceptConsent();
            finish(true);
          } catch (error) {
            console.error("SmartTeX could not save GIPHY consent:", error);
            button.disabled = false;
          }
        });
        queueMicrotask(() => overlay.querySelector(".smarttex-giphy-consent-accept")?.focus?.());
      });
    })().finally(() => {
      consentPromise = null;
    });
    return consentPromise;
  }

  async function maybeRequestViewingConsent() {
    if (await hasConsent()) return true;
    if (viewerPromptedThisSession) return false;
    viewerPromptedThisSession = true;
    return requestConsent({ reason: "view" });
  }

  function isGiphyHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "giphy.com" || host.endsWith(".giphy.com");
  }

  function safeHttpsUrl(value, { giphyOnly = false } = {}) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:") return "";
      if (giphyOnly && !isGiphyHost(url.hostname)) return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function cleanAttachment(value = {}) {
    if (!value || typeof value !== "object") return null;
    const id = String(value.id || "").trim().slice(0, 120);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    const url = safeHttpsUrl(value.url, { giphyOnly: true });
    const embedUrl = safeHttpsUrl(value.embedUrl, { giphyOnly: true });
    if (!url || !embedUrl) return null;
    const rawSourcePostUrl = String(value.sourcePostUrl || "").trim();
    const sourcePostUrl = safeHttpsUrl(rawSourcePostUrl);
    let sourceTld = String(value.sourceTld || "").trim().slice(0, 160);
    if (!sourceTld && rawSourcePostUrl) {
      try { sourceTld = new URL(rawSourcePostUrl).hostname.slice(0, 160); } catch (_error) {}
    }
    return {
      id,
      title: String(value.title || "GIPHY GIF").trim().slice(0, 240) || "GIPHY GIF",
      url,
      embedUrl,
      username: String(value.username || "").trim().slice(0, 120),
      userUrl: safeHttpsUrl(value.userUrl, { giphyOnly: true }),
      sourceTld,
      sourcePostUrl,
      width: Math.max(0, Math.min(4096, Number(value.width) || 0)),
      height: Math.max(0, Math.min(4096, Number(value.height) || 0))
    };
  }

  function validCustomerId(value) {
    const id = String(value || "").trim().slice(0, 160);
    return /^[A-Za-z0-9_-]{8,160}$/.test(id) ? id : "";
  }

  async function ensureCustomerId(apiKey, { signal } = {}) {
    if (typeof extensionApi?.storage?.local?.get !== "function") return "";
    const stored = await extensionApi.storage.local.get(CLIENT_ID_KEY);
    const existing = validCustomerId(stored?.[CLIENT_ID_KEY]);
    if (existing) return existing;

    const params = new URLSearchParams({ api_key: String(apiKey || "") });
    const response = await fetch(`https://api.giphy.com/v1/randomid?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal
    });
    if (!response.ok) throw new Error(`GIPHY random ID request failed (${response.status}).`);
    const payload = await response.json();
    const customerId = validCustomerId(payload?.data?.random_id);
    if (!customerId) throw new Error("GIPHY did not return a valid random customer ID.");
    await extensionApi.storage.local.set({ [CLIENT_ID_KEY]: customerId });
    return customerId;
  }

  function transientResult(item = {}) {
    const images = item.images || {};
    const preview = images.fixed_width || images.fixed_height || images.downsized || images.original || {};
    const original = images.original || images.downsized || preview;
    const attachment = cleanAttachment({
      id: item.id,
      title: item.title,
      url: item.url,
      embedUrl: item.embed_url,
      username: item.user?.display_name || item.user?.username || item.username,
      userUrl: item.user?.profile_url,
      sourceTld: item.source_tld,
      sourcePostUrl: item.source_post_url,
      width: original.width,
      height: original.height
    });
    if (!attachment) return null;
    const previewUrl = safeHttpsUrl(preview.url, { giphyOnly: true });
    if (!previewUrl) return null;
    return {
      attachment,
      previewUrl,
      previewWidth: Math.max(0, Math.min(2048, Number(preview.width) || 0)),
      previewHeight: Math.max(0, Math.min(2048, Number(preview.height) || 0)),
      analytics: {
        onload: safeHttpsUrl(item.analytics?.onload?.url, { giphyOnly: true }),
        onclick: safeHttpsUrl(item.analytics?.onclick?.url, { giphyOnly: true }),
        onsent: safeHttpsUrl(item.analytics?.onsent?.url, { giphyOnly: true })
      }
    };
  }

  async function search(query = "", { signal, offset = 0 } = {}) {
    if (!(await hasConsent())) throw new Error("GIPHY consent is required.");
    const { apiKey, usesBundledKey } = await effectiveApiKey();

    if (usesBundledKey && !(await ensureApiCallAllowed({ prompt: true }))) {
      const error = new Error("A personal GIPHY API key is required to make another GIPHY API call.");
      error.code = "PERSONAL_API_KEY_REQUIRED";
      throw error;
    }

    const customerId = await ensureCustomerId(apiKey, { signal });
    const term = String(query || "");
    const endpoint = term.trim() ? `${API_BASE}/search` : `${API_BASE}/trending`;
    const pageOffset = Math.max(0, Math.min(GIPHY_MAX_OFFSET, Math.floor(Number(offset) || 0)));
    const params = new URLSearchParams({
      api_key: apiKey,
      customer_id: customerId,
      limit: String(GIPHY_PAGE_SIZE),
      offset: String(pageOffset),
      rating: "pg-13",
      bundle: "messaging_non_clips"
    });
    if (term.trim()) params.set("q", term);

    // Count the shared-key content request immediately before dispatching it.
    // Random-ID bootstrap and analytics pingbacks are not part of this SmartTeX
    // content-call allowance; each Search/Trending page request counts once.
    if (usesBundledKey) await recordApiCall();
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal
    });
    if (!response.ok) {
      throw new Error(`GIPHY request failed (${response.status}).`);
    }
    const payload = await response.json();
    if (payload?.meta?.status && Number(payload.meta.status) >= 400) {
      throw new Error(payload.meta.msg || `GIPHY request failed (${payload.meta.status}).`);
    }

    const results = (Array.isArray(payload?.data) ? payload.data : []).map(transientResult).filter(Boolean);
    const rawPagination = payload?.pagination || {};
    const rawCount = Math.max(0, Number(rawPagination.count) || (Array.isArray(payload?.data) ? payload.data.length : 0));
    const rawTotal = Number(rawPagination.total_count);
    const totalCount = Number.isFinite(rawTotal) ? Math.max(0, Math.floor(rawTotal)) : null;
    const responseOffset = Number.isFinite(Number(rawPagination.offset))
      ? Math.max(0, Math.floor(Number(rawPagination.offset)))
      : pageOffset;
    const nextOffset = responseOffset + rawCount;
    const hasMore = rawCount > 0 && rawCount >= GIPHY_PAGE_SIZE && nextOffset <= GIPHY_MAX_OFFSET && (
      totalCount === null || nextOffset < totalCount
    );

    // Preserve the historic array return value while exposing pagination metadata
    // to the picker. This avoids breaking older callers/tests.
    results.pagination = Object.freeze({
      offset: responseOffset,
      count: rawCount,
      totalCount,
      nextOffset,
      hasMore
    });
    results.usesBundledKey = usesBundledKey;
    results.pageSize = GIPHY_PAGE_SIZE;
    return results;
  }

  function pingAnalytics(url) {
    const target = safeHttpsUrl(url, { giphyOnly: true });
    if (!target) return;
    hasConsent().then(async (allowed) => {
      if (!allowed) return;
      const { apiKey } = await effectiveApiKey();
      const customerId = await ensureCustomerId(apiKey);
      const ping = new URL(target);
      ping.searchParams.set("customer_id", customerId);
      ping.searchParams.set("ts", String(Date.now()));
      fetch(ping.href, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        keepalive: true
      }).catch(() => {});
    }).catch(() => {});
  }

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[CONSENT_KEY]) return;
    const accepted = acceptedConsent(changes[CONSENT_KEY].newValue);
    if (!accepted) viewerPromptedThisSession = false;
    dispatchConsentChanged(accepted);
  });

  globalThis.SmartTeXGiphyIntegration = Object.freeze({
    SETTINGS_KEY,
    CONSENT_KEY,
    CLIENT_ID_KEY,
    BUNDLED_USAGE_KEY,
    FOCUS_PERSONAL_KEY_KEY,
    BUNDLED_SOFT_PROMPT_AFTER,
    BUNDLED_HOURLY_HARD_LIMIT,
    BUNDLED_TOTAL_HARD_LIMIT,
    BUNDLED_INSERT_WINDOW_MS,
    BUNDLED_INSERT_SOFT_PROMPT_AFTER,
    BUNDLED_INSERT_HOURLY_HARD_LIMIT,
    BUNDLED_API_CALL_SOFT_PROMPT_AFTER,
    BUNDLED_API_CALL_HOURLY_HARD_LIMIT,
    BUNDLED_TOTAL_INSERT_HARD_LIMIT,
    BUNDLED_USAGE_WINDOW_MS,
    GIPHY_PAGE_SIZE,
    GIPHY_MAX_OFFSET,
    CONSENT_VERSION,
    CONSENT_CHANGED_EVENT,
    PRIVACY_URL,
    API_TERMS_URL,
    GIPHY_URL,
    normalizeSettings,
    readSettings,
    saveSettings,
    effectiveApiKey,
    bundledUsageState,
    recordGifInsertion,
    recordApiCall,
    ensureGifInsertionAllowed,
    ensureApiCallAllowed,
    requestPersonalKeyForLimit,
    readConsent,
    hasConsent,
    acceptConsent,
    withdrawConsent,
    requestConsent,
    maybeRequestViewingConsent,
    openExternal,
    openOptions,
    attributionAssetUrl,
    cleanAttachment,
    ensureCustomerId,
    search,
    pingAnalytics
  });
})();
