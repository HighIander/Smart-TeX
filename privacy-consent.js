/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.SmartTeXPrivacyConsent) return;

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const CONSENT_KEY = "smarttex:privacy-consent:v1";
  const DATA_PROTECTION_URL = "https://smartioz.com/smartTex/dataprotection.php";
  const IMPRINT_URL = "https://smartioz.com/smartTex/impressum.php";
  const OVERLAY_ID = "smarttex-privacy-consent-overlay";
  const STYLE_ID = "smarttex-privacy-consent-style";

  function manifestVersion() {
    try {
      return extensionApi?.runtime?.getManifest?.().version || "";
    } catch {
      return "";
    }
  }

  function acceptedConsent(value) {
    return Boolean(value && value.accepted === true);
  }

  async function readConsent() {
    if (typeof extensionApi?.storage?.local?.get !== "function") return null;
    const stored = await extensionApi.storage.local.get(CONSENT_KEY);
    return stored?.[CONSENT_KEY] || null;
  }

  async function acceptConsent() {
    const consent = {
      accepted: true,
      acceptedAt: new Date().toISOString(),
      extensionVersion: manifestVersion()
    };
    await extensionApi.storage.local.set({ [CONSENT_KEY]: consent });
    return consent;
  }

  async function openExternal(url) {
    try {
      const response = await extensionApi.runtime.sendMessage({
        type: "smarttex-open-external-tab",
        url,
        active: true
      });
      if (response?.ok) return;
    } catch {
      // Fall through to a normal browser tab when runtime messaging is not
      // available, for example in a standalone options-page test.
    }
    globalThis.open?.(url, "_blank", "noopener,noreferrer");
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
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
      #${OVERLAY_ID}[hidden] { display: none !important; }
      #${OVERLAY_ID} .smarttex-privacy-dialog {
        width: min(560px, calc(100vw - 32px));
        overflow: hidden;
        border: 1px solid #cbd5e1;
        border-radius: 16px;
        color: #1e293b;
        background: #fff;
        box-shadow: 0 24px 80px rgb(15 23 42 / 38%);
      }
      #${OVERLAY_ID} .smarttex-privacy-heading {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 22px 24px 14px;
      }
      #${OVERLAY_ID} .smarttex-privacy-heading img {
        width: 48px;
        height: 48px;
        border-radius: 12px;
      }
      #${OVERLAY_ID} h2 {
        margin: 0;
        font-size: 22px;
        line-height: 1.2;
      }
      #${OVERLAY_ID} .smarttex-privacy-body {
        padding: 0 24px 22px;
      }
      #${OVERLAY_ID} p {
        margin: 0 0 13px;
      }
      #${OVERLAY_ID} a {
        color: #0969da;
        font-weight: 650;
      }
      #${OVERLAY_ID} .smarttex-privacy-links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 18px;
        margin: 16px 0 4px;
      }
      #${OVERLAY_ID} .smarttex-privacy-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 16px 24px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
      }
      #${OVERLAY_ID} button {
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
      #${OVERLAY_ID} button:hover { background: #f1f5f9; }
      #${OVERLAY_ID} .smarttex-privacy-accept {
        border-color: #1674d1;
        color: #fff;
        background: #1674d1;
      }
      #${OVERLAY_ID} .smarttex-privacy-accept:hover { background: #0d63b8; }
      @media (prefers-color-scheme: dark) {
        #${OVERLAY_ID} .smarttex-privacy-dialog {
          border-color: #475569;
          color: #e5edf7;
          background: #1d2736;
        }
        #${OVERLAY_ID} a { color: #78b9ff; }
        #${OVERLAY_ID} .smarttex-privacy-actions {
          border-color: #475569;
          background: #162130;
        }
        #${OVERLAY_ID} button {
          border-color: #52657a;
          color: #dce7f3;
          background: #243446;
        }
        #${OVERLAY_ID} button:hover { background: #2d4056; }
        #${OVERLAY_ID} .smarttex-privacy-accept {
          border-color: #3389d9;
          color: #fff;
          background: #1674d1;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function removeDialog() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function buildDialog() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) return existing;

    installStyles();
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "smarttex-privacy-title");
    overlay.innerHTML = `
      <div class="smarttex-privacy-dialog">
        <div class="smarttex-privacy-heading">
          <img src="${extensionApi.runtime.getURL("icons/icon128.png")}" alt="">
          <h2 id="smarttex-privacy-title">Welcome to SmartTeX</h2>
        </div>
        <div class="smarttex-privacy-body">
          <p>
            Before using SmartTeX, please review and accept the data protection
            information. SmartTeX's legal notice is available in the imprint.
          </p>
          <div class="smarttex-privacy-links">
            <a href="${DATA_PROTECTION_URL}" data-smarttex-privacy-link="data-protection">Data protection</a>
            <a href="${IMPRINT_URL}" data-smarttex-privacy-link="imprint">Imprint</a>
          </div>
        </div>
        <div class="smarttex-privacy-actions">
          <button type="button" class="smarttex-privacy-later">Not now</button>
          <button type="button" class="smarttex-privacy-accept">Accept and continue</button>
        </div>
      </div>
    `;

    overlay.querySelectorAll("a[data-smarttex-privacy-link]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openExternal(link.href);
      });
    });
    overlay.querySelector(".smarttex-privacy-later")?.addEventListener("click", removeDialog);
    overlay.querySelector(".smarttex-privacy-accept")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await acceptConsent();
        removeDialog();
      } catch (error) {
        console.error("SmartTeX could not save privacy consent:", error);
        button.disabled = false;
      }
    });

    document.documentElement.appendChild(overlay);
    queueMicrotask(() => overlay.querySelector(".smarttex-privacy-accept")?.focus());
    return overlay;
  }

  async function showIfNeeded({ force = false } = {}) {
    try {
      const consent = await readConsent();
      if (!force && acceptedConsent(consent)) {
        removeDialog();
        return false;
      }
      buildDialog();
      return true;
    } catch (error) {
      console.error("SmartTeX could not read privacy consent:", error);
      buildDialog();
      return true;
    }
  }

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[CONSENT_KEY]) return;
    if (acceptedConsent(changes[CONSENT_KEY].newValue)) removeDialog();
  });

  globalThis.SmartTeXPrivacyConsent = Object.freeze({
    CONSENT_KEY,
    DATA_PROTECTION_URL,
    IMPRINT_URL,
    readConsent,
    acceptConsent,
    showIfNeeded,
    removeDialog
  });
})();
