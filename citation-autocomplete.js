/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.__smartTeXCitationAutocompleteLoaded || window.top !== window) return;
  globalThis.__smartTeXCitationAutocompleteLoaded = true;

  const STATE_EVENT = "smarttex:editor-state";
  const REQUEST_EVENT = "smarttex:citation-editor-request";
  const RESPONSE_EVENT = "smarttex:citation-editor-response";
  const CACHE_PREFIX = "smarttex:citation-cache:v1:";
  const OPEN_DELAY_MS = 220;
  const MAX_RESULTS = 8;
  const FILE_OPEN_TIMEOUT_MS = 12000;
  const CITE_COMMAND = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/i;
  const SMART_CITATIONS_SELECTOR = "#ctca-popup, #ctca-bib-manager";
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const parser = globalThis.SmartTeXBibTeX;

  if (!parser?.parseBibTeX) {
    console.error("SmartTeX citation autocomplete could not load its BibTeX parser.");
    return;
  }

  let currentState = null;
  let currentContext = null;
  let records = [];
  let renderedRecords = [];
  let selectedIndex = 0;
  let parseState = "unparsed";
  let parseMessage = "";
  let cachedFiles = [];
  let cacheKey = "";
  let cacheGeneration = 0;
  let parsing = false;
  let popupTimer = null;
  let dismissedContextId = "";
  let requestCounter = 0;
  let smartCitationsPresent = false;
  const pendingRequests = new Map();

  const popup = document.createElement("aside");
  popup.id = "smarttex-citation-popup";
  popup.hidden = true;
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "SmartTeX citation suggestions");
  popup.innerHTML = `
    <header class="smarttex-citation-header">
      <span class="smarttex-citation-query">Citation</span>
      <button type="button" class="smarttex-citation-close" title="Close (Esc)" aria-label="Close citation suggestions">&times;</button>
    </header>
    <div class="smarttex-citation-status" hidden role="status" aria-live="polite"></div>
    <div class="smarttex-citation-list" role="listbox" aria-label="Citation suggestions"></div>
    <footer class="smarttex-citation-promotion">
      <span>Want a full reference manager, PDF tools, and synchronization?</span>
      <a href="https://github.com/HighIander/Smart-Citations" target="_blank" rel="noopener noreferrer">Try Smart Citations</a>
    </footer>`;
  document.documentElement.appendChild(popup);

  const queryLabel = popup.querySelector(".smarttex-citation-query");
  const status = popup.querySelector(".smarttex-citation-status");
  const list = popup.querySelector(".smarttex-citation-list");
  const closeButton = popup.querySelector(".smarttex-citation-close");

  function smartCitationsIsPresent() {
    return Boolean(document.querySelector(SMART_CITATIONS_SELECTOR));
  }

  function projectIdentity() {
    const projectMatch = window.location.pathname.match(/\/project\/([^/?#]+)/i);
    return `${window.location.origin}:${projectMatch?.[1] || window.location.pathname}`;
  }

  function projectCacheKey() {
    return `${CACHE_PREFIX}${projectIdentity()}`;
  }

  function contextId(context = currentContext) {
    if (!context) return "";
    return [
      currentState?.fileName || "",
      context.anchorIndex,
      context.fragmentStart
    ].join(":");
  }

  function clearPopupTimer() {
    window.clearTimeout(popupTimer);
    popupTimer = null;
  }

  function bridgeRequest(type, payload = {}, timeoutMs = 3000) {
    const requestId = `${Date.now()}-${++requestCounter}`;
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

  function setBridgeActive(active) {
    bridgeRequest("setCitationAutocompleteActive", {
      active: Boolean(active) && !smartCitationsPresent
    }, 1200).catch(() => {});
  }

  function hidePopup({ dismiss = false } = {}) {
    clearPopupTimer();
    if (dismiss && currentContext) dismissedContextId = contextId();
    popup.hidden = true;
    popup.classList.remove("smarttex-citation-visible");
    setBridgeActive(false);
  }

  function showPopup() {
    if (smartCitationsPresent || !currentContext) return;
    popup.hidden = false;
    popup.classList.add("smarttex-citation-visible");
    setBridgeActive(true);
    positionPopup();
  }

  function findCitationContext(state) {
    if (
      !state?.value ||
      !Number.isInteger(state.cursorIndex) ||
      !/\.(?:tex|ltx)$/i.test(String(state.fileName || "main.tex"))
    ) {
      return null;
    }
    const beforeCursor = state.value.slice(0, state.cursorIndex);
    const match = beforeCursor.match(CITE_COMMAND);
    if (!match) return null;
    const completeMatch = match[0];
    const argument = match[1];
    const lastComma = argument.lastIndexOf(",");
    const beforeFragment = argument.slice(lastComma + 1);
    const leadingWhitespace = beforeFragment.match(/^\s*/)?.[0] || "";
    const fragmentStart =
      state.cursorIndex - beforeFragment.length + leadingWhitespace.length;
    const afterFragment = state.value
      .slice(state.cursorIndex)
      .match(/^[^,{}\s]*/)?.[0] || "";
    return {
      fragment: beforeFragment.slice(leadingWhitespace.length) + afterFragment,
      fragmentStart,
      fragmentEnd: state.cursorIndex + afterFragment.length,
      anchorIndex: beforeCursor.length - completeMatch.length + completeMatch.lastIndexOf("{")
    };
  }

  async function loadProjectCache() {
    const nextKey = projectCacheKey();
    if (nextKey === cacheKey) return;
    cacheKey = nextKey;
    records = [];
    cachedFiles = [];
    parseState = "loading";
    parseMessage = "";
    const generation = ++cacheGeneration;
    try {
      const stored = await extensionApi?.storage?.local?.get?.(cacheKey);
      if (generation !== cacheGeneration || nextKey !== cacheKey) return;
      const cached = stored?.[cacheKey];
      if (Array.isArray(cached?.records) && cached.parsedAt) {
        records = cached.records;
        cachedFiles = Array.isArray(cached.files) ? cached.files : [];
        parseState = records.length ? "ready" : "empty";
      } else {
        parseState = "unparsed";
      }
    } catch (error) {
      if (generation !== cacheGeneration) return;
      parseState = "unparsed";
      console.warn("SmartTeX could not load its citation cache:", error);
    }
    if (!popup.hidden) {
      renderPopup();
      positionPopup();
    }
  }

  async function saveProjectCache() {
    if (!cacheKey || !extensionApi?.storage?.local?.set) return;
    await extensionApi.storage.local.set({
      [cacheKey]: {
        records,
        files: cachedFiles,
        parsedAt: new Date().toISOString()
      }
    });
  }

  function normalizeSearch(value) {
    return String(value || "").toLocaleLowerCase();
  }

  function recordSearchText(record) {
    return [
      record.key,
      record.title,
      ...(record.authors || []),
      record.journal,
      record.year,
      record.keywords,
      record.doi
    ].filter(Boolean).join("\n");
  }

  function termScore(value, term) {
    const text = normalizeSearch(value);
    const query = normalizeSearch(term);
    if (!query) return 100;
    if (text === query) return 0;
    if (text.startsWith(query)) return 1;
    const token = text.search(
      new RegExp(`(?:^|[\\s,;:_./()\\-])${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
    if (token >= 0) return 10 + token / 1000;
    const contained = text.indexOf(query);
    return contained >= 0 ? 20 + contained / 1000 : Number.POSITIVE_INFINITY;
  }

  function matchingRecords(fragment) {
    const terms = String(fragment || "").trim().split(/\s+/).filter(Boolean);
    return records.map((record) => {
      let score = terms.length ? 0 : 100;
      for (const term of terms) {
        const termResult = Math.min(
          termScore(record.key, term),
          termScore(record.title, term) + 30,
          termScore((record.authors || []).join("; "), term) + 60,
          termScore(record.journal, term) + 90,
          termScore(record.year, term) + 100,
          termScore(recordSearchText(record), term) + 120
        );
        if (!Number.isFinite(termResult)) {
          score = Number.POSITIVE_INFINITY;
          break;
        }
        score += termResult;
      }
      return { record, score };
    }).filter((item) => Number.isFinite(item.score))
      .sort((left, right) => (
        left.score - right.score ||
        left.record.key.localeCompare(right.record.key, undefined, {
          sensitivity: "base"
        })
      ))
      .slice(0, MAX_RESULTS)
      .map((item) => item.record);
  }

  function abbreviatedAuthors(record) {
    const authors = record.authors || [];
    if (!authors.length) return "Unknown author";
    const first = authors.slice(0, 2).join(", ");
    return authors.length > 2 ? `${first} et al.` : first;
  }

  function publicationText(record) {
    const parts = [
      record.journal,
      record.volume,
      record.pages,
      record.year ? `(${record.year})` : ""
    ].filter(Boolean);
    return parts.join(", ") || "Publication details unavailable";
  }

  function setStatus(message, error = false) {
    status.hidden = !message;
    status.textContent = message || "";
    status.classList.toggle("smarttex-citation-status-error", error);
  }

  function createParsePrompt() {
    const card = document.createElement("section");
    card.className = "smarttex-citation-parse-card";
    const heading = document.createElement("strong");
    heading.textContent = parseState === "empty"
      ? "No citation entries were found"
      : "Bibliography not parsed";
    const description = document.createElement("p");
    description.textContent = parseState === "empty"
      ? "Parse the project bibliography again after checking that it contains valid BibTeX entries."
      : "SmartTeX needs to open and read the bibliography files used by this document.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "smarttex-citation-parse";
    button.textContent = parsing
      ? "Parsing…"
      : parseState === "loading"
        ? "Checking cache…"
        : "Parse bibliography now";
    button.disabled = parsing || parseState === "loading";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => parseBibliography());
    card.append(heading, description, button);
    list.appendChild(card);
  }

  function renderPopup() {
    const query = currentContext?.fragment || "";
    queryLabel.textContent = query
      ? `Citations matching “${query}”`
      : "Select a citation";
    list.replaceChildren();
    setStatus(parsing ? parseMessage : "", false);
    renderedRecords = [];

    if (parseState !== "ready") {
      createParsePrompt();
      return;
    }

    renderedRecords = matchingRecords(query);
    if (selectedIndex >= renderedRecords.length) selectedIndex = 0;
    if (!renderedRecords.length) {
      const empty = document.createElement("p");
      empty.className = "smarttex-citation-empty";
      empty.textContent = "No citation matches the current text.";
      list.appendChild(empty);
      return;
    }

    renderedRecords.forEach((record, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "smarttex-citation-item";
      item.classList.toggle("smarttex-citation-selected", index === selectedIndex);
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");

      const title = document.createElement("strong");
      title.className = "smarttex-citation-title";
      title.textContent = record.title || record.key;
      title.title = title.textContent;
      const key = document.createElement("code");
      key.className = "smarttex-citation-key";
      key.textContent = record.key;
      const authors = document.createElement("span");
      authors.className = "smarttex-citation-authors";
      authors.textContent = abbreviatedAuthors(record);
      const publication = document.createElement("span");
      publication.className = "smarttex-citation-publication";
      publication.textContent = publicationText(record);
      item.append(title, key, authors, publication);
      item.addEventListener("mouseenter", () => {
        selectedIndex = index;
        updateSelectedItem();
      });
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => insertRecord(record));
      list.appendChild(item);
    });
  }

  function updateSelectedItem() {
    [...list.querySelectorAll(".smarttex-citation-item")].forEach((item, index) => {
      const selected = index === selectedIndex;
      item.classList.toggle("smarttex-citation-selected", selected);
      item.setAttribute("aria-selected", selected ? "true" : "false");
    });
    list.querySelectorAll(".smarttex-citation-item")[selectedIndex]
      ?.scrollIntoView({ block: "nearest" });
  }

  async function insertRecord(record) {
    if (!record || !currentContext || smartCitationsPresent) return;
    const dismissedId = contextId();
    hidePopup();
    try {
      await bridgeRequest("replaceCitationToken", { text: record.key });
      dismissedContextId = dismissedId;
    } catch (error) {
      dismissedContextId = "";
      renderPopup();
      showPopup();
      setStatus(error.message || String(error), true);
    }
  }

  function positionPopup() {
    if (popup.hidden) return;
    const screen = currentState?.screen;
    if (!screen) return;
    const margin = 9;
    const gap = 10;
    const width = Math.min(540, window.innerWidth - margin * 2);
    popup.style.width = `${Math.max(280, width)}px`;
    popup.style.maxHeight = `${Math.max(180, window.innerHeight - margin * 2)}px`;
    const rect = popup.getBoundingClientRect();
    const cursorLeft = screen.pageX - window.scrollX;
    const cursorTop = screen.pageY - window.scrollY;
    const lineHeight = Math.max(14, Number(screen.lineHeight) || 18);
    const fitsBelow = cursorTop + lineHeight + gap + rect.height <= window.innerHeight - margin;
    const top = fitsBelow
      ? cursorTop + lineHeight + gap
      : cursorTop - gap - rect.height;
    popup.style.left = `${Math.round(Math.max(
      margin,
      Math.min(cursorLeft, window.innerWidth - rect.width - margin)
    ))}px`;
    popup.style.top = `${Math.round(Math.max(
      margin,
      Math.min(top, window.innerHeight - rect.height - margin)
    ))}px`;
  }

  function openForCurrentContext() {
    popupTimer = null;
    if (
      smartCitationsPresent ||
      parsing ||
      !currentContext ||
      contextId() === dismissedContextId
    ) {
      return;
    }
    selectedIndex = 0;
    renderPopup();
    showPopup();
    bridgeRequest("getCoordinates", {
      index: currentContext.anchorIndex
    }, 1200).then((response) => {
      if (response.screen && currentState) {
        currentState = { ...currentState, screen: response.screen };
        positionPopup();
      }
    }).catch(() => {});
  }

  function updateFromState() {
    if (parsing) return;
    if (smartCitationsPresent) {
      currentContext = null;
      hidePopup();
      return;
    }
    const nextContext = findCitationContext(currentState);
    if (!nextContext) {
      currentContext = null;
      dismissedContextId = "";
      hidePopup();
      return;
    }
    currentContext = nextContext;
    if (contextId() !== dismissedContextId) dismissedContextId = "";
    if (contextId() === dismissedContextId) {
      clearPopupTimer();
      popup.hidden = true;
      popup.classList.remove("smarttex-citation-visible");
      setBridgeActive(false);
      return;
    }
    setBridgeActive(true);
    clearPopupTimer();
    if (!popup.hidden) {
      selectedIndex = 0;
      renderPopup();
      positionPopup();
      return;
    }
    popupTimer = window.setTimeout(openForCurrentContext, OPEN_DELAY_MS);
  }

  function bibliographyFiles(tex, cursorIndex = 0) {
    const found = [];
    const add = (value, position) => {
      let name = String(value || "").trim().replace(/^['"]|['"]$/g, "");
      if (!name) return;
      if (!/\.bib$/i.test(name)) name += ".bib";
      found.push({ name, position });
    };
    let match;
    const traditional = /\\bibliography\s*\{([^{}]+)\}/gi;
    while ((match = traditional.exec(tex)) !== null) {
      match[1].split(",").forEach((name) => add(name, match.index));
    }
    const biblatex = /\\(?:addbibresource|addglobalbib|addsectionbib)\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}/gi;
    while ((match = biblatex.exec(tex)) !== null) add(match[1], match.index);
    const unique = new Map();
    found.sort((left, right) => (
      Number(left.position < cursorIndex) - Number(right.position < cursorIndex) ||
      left.position - right.position
    )).forEach((entry) => {
      const identity = entry.name.replace(/\\/g, "/").split("/").at(-1).toLowerCase();
      if (!unique.has(identity)) unique.set(identity, entry.name);
    });
    return [...unique.values()];
  }

  function treeItemName(item) {
    return String(
      item.getAttribute("aria-label") ||
      item.querySelector(".item-name-button span")?.textContent ||
      item.querySelector(".item-name span")?.textContent ||
      item.querySelector(".entity-name span")?.textContent ||
      ""
    ).trim();
  }

  function visibleBibFiles() {
    const names = new Set();
    document.querySelectorAll('.file-tree-list [role="treeitem"]').forEach((item) => {
      const name = treeItemName(item);
      if (/\.bib$/i.test(name)) names.add(name);
    });
    return [...names];
  }

  function fileMatches(left, right) {
    const normalize = (value) => String(value || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
    const leftValue = normalize(left);
    const rightValue = normalize(right);
    return (
      leftValue === rightValue ||
      leftValue.split("/").at(-1) === rightValue.split("/").at(-1)
    );
  }

  function findFileControl(fileName) {
    let baseMatch = null;
    for (const item of document.querySelectorAll('.file-tree-list [role="treeitem"]')) {
      const name = treeItemName(item);
      const control = (
        item.querySelector(".item-name-button") ||
        item.querySelector(".file-tree-entity-details") ||
        item.querySelector(".entity-name") ||
        item
      );
      if (fileMatches(name, fileName)) {
        if (name.replace(/\\/g, "/").toLowerCase() === String(fileName)
          .replace(/\\/g, "/").toLowerCase()) return control;
        baseMatch ||= control;
      }
    }
    return baseMatch;
  }

  async function findFileControlExpanded(fileName) {
    let control = findFileControl(fileName);
    if (control) return control;
    for (let pass = 0; pass < 3; pass += 1) {
      const collapsed = [...document.querySelectorAll(
        '.file-tree-list [role="treeitem"][aria-expanded="false"] button[aria-label*="Expand" i]'
      )];
      if (!collapsed.length) break;
      collapsed.forEach((button) => button.click());
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      control = findFileControl(fileName);
      if (control) return control;
    }
    return null;
  }

  async function waitForFile(fileName, previousState = null) {
    const deadline = Date.now() + FILE_OPEN_TIMEOUT_MS;
    let previousFingerprint = "";
    let stableObservations = 0;
    const startedOnTarget = fileMatches(previousState?.fileName, fileName);
    const previousValue = String(previousState?.value ?? "");
    const identicalBibContentIsValid = (
      /\.bib$/i.test(String(previousState?.fileName || "")) &&
      /\.bib$/i.test(fileName) &&
      parser.parseBibTeX(previousValue, fileName).length > 0
    );
    while (Date.now() < deadline) {
      try {
        const state = (await bridgeRequest("getState", {}, 1500)).state;
        if (state?.value !== undefined && fileMatches(state.fileName, fileName)) {
          const text = String(state.value);
          const fingerprint = `${text.length}:${text.slice(0, 180)}:${text.slice(-180)}`;
          if (fingerprint === previousFingerprint) stableObservations += 1;
          else {
            previousFingerprint = fingerprint;
            stableObservations = 0;
          }
          const contentBelongsToTarget = (
            startedOnTarget ||
            text !== previousValue ||
            identicalBibContentIsValid
          );
          if (contentBelongsToTarget && stableObservations >= 1) return state;
        }
      } catch (_error) {
        // The editor may be replacing its document.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    throw new Error(`Timed out while opening ${fileName}.`);
  }

  async function openFile(fileName) {
    const control = await findFileControlExpanded(fileName);
    if (!control) throw new Error(`Could not find ${fileName} in the project file tree.`);
    let previousState = null;
    try {
      previousState = (await bridgeRequest("getState", {}, 1500)).state || null;
    } catch (_error) {
      // Continue; the filename and stable content checks still guard the switch.
    }
    control.click();
    return waitForFile(fileName, previousState);
  }

  async function restoreFile(fileName) {
    if (!fileName) return;
    const control = await findFileControlExpanded(fileName);
    if (!control) return;
    let previousState = null;
    try {
      previousState = (await bridgeRequest("getState", {}, 1500)).state || null;
    } catch (_error) {
      // Restoration is best effort.
    }
    control.click();
    try {
      await waitForFile(fileName, previousState);
    } catch (_error) {
      // Restoration is best effort; the editor can finish the switch afterward.
    }
  }

  async function parseBibliography() {
    if (parsing || smartCitationsPresent) return;
    parsing = true;
    parseState = "unparsed";
    parseMessage = "Detecting bibliography files…";
    renderPopup();
    positionPopup();
    const originalState = currentState;
    const originalFile = originalState?.fileName || "";
    try {
      const liveState = (await bridgeRequest("getState", {}, 2500)).state;
      let files = bibliographyFiles(liveState.value, liveState.cursorIndex);
      if (!files.length) files = visibleBibFiles();
      if (!files.length) {
        throw new Error(
          "No \\bibliography{…}, \\addbibresource{…}, or visible .bib file was found."
        );
      }
      const parsed = [];
      const failures = [];
      for (let index = 0; index < files.length; index += 1) {
        const fileName = files[index];
        parseMessage = `Opening and parsing ${fileName} (${index + 1}/${files.length})…`;
        renderPopup();
        positionPopup();
        try {
          const bibState = await openFile(fileName);
          parsed.push(...parser.parseBibTeX(bibState.value, fileName));
        } catch (error) {
          failures.push(`${fileName}: ${error.message || String(error)}`);
        }
      }
      const unique = new Map();
      parsed.forEach((record) => {
        if (!unique.has(record.key.toLocaleLowerCase())) {
          unique.set(record.key.toLocaleLowerCase(), record);
        }
      });
      records = [...unique.values()];
      cachedFiles = files;
      parseState = records.length ? "ready" : "empty";
      parseMessage = failures.length
        ? `${failures.length} bibliography file(s) could not be read.`
        : "";
      await saveProjectCache();
      if (!records.length) {
        throw new Error(
          failures.length
            ? `No BibTeX entries were parsed. ${failures.join("; ")}`
            : "The detected bibliography files contain no parseable entries."
        );
      }
    } catch (error) {
      parseState = records.length ? "ready" : "unparsed";
      parseMessage = error.message || String(error);
    } finally {
      await restoreFile(originalFile);
      parsing = false;
      try {
        currentState = (await bridgeRequest("getState", {}, 2200)).state || originalState;
      } catch (_error) {
        currentState = originalState;
      }
      currentContext = findCitationContext(currentState);
      if (smartCitationsIsPresent()) {
        updateSmartCitationsPresence();
        return;
      }
      renderPopup();
      showPopup();
      if (parseMessage) setStatus(parseMessage, parseState !== "ready");
    }
  }

  function updateSmartCitationsPresence() {
    const present = smartCitationsIsPresent();
    if (present === smartCitationsPresent) return;
    smartCitationsPresent = present;
    if (present) {
      clearPopupTimer();
      currentContext = null;
      hidePopup();
    } else {
      updateFromState();
    }
  }

  window.addEventListener(STATE_EVENT, (event) => {
    try {
      currentState = JSON.parse(String(event.detail || "null"));
    } catch (_error) {
      return;
    }
    updateSmartCitationsPresence();
    if (cacheKey !== projectCacheKey()) {
      loadProjectCache().then(updateFromState).catch(updateFromState);
    } else {
      updateFromState();
    }
  });

  closeButton.addEventListener("mousedown", (event) => event.preventDefault());
  closeButton.addEventListener("click", () => hidePopup({ dismiss: true }));

  document.addEventListener("keydown", (event) => {
    if (smartCitationsPresent || popup.hidden || parsing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      hidePopup({ dismiss: true });
      bridgeRequest("focus").catch(() => {});
      return;
    }
    if (!renderedRecords.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectedIndex = (selectedIndex + 1) % renderedRecords.length;
      updateSelectedItem();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectedIndex = (
        selectedIndex - 1 + renderedRecords.length
      ) % renderedRecords.length;
      updateSelectedItem();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopImmediatePropagation();
      insertRecord(renderedRecords[selectedIndex]);
    }
  }, true);

  document.addEventListener("mousedown", (event) => {
    if (!popup.hidden && !popup.contains(event.target)) {
      hidePopup({ dismiss: true });
    }
  }, true);

  window.addEventListener("resize", positionPopup, { passive: true });
  window.addEventListener("scroll", (event) => {
    if (event.target instanceof Node && popup.contains(event.target)) return;
    positionPopup();
  }, true);

  const ownershipObserver = new MutationObserver(updateSmartCitationsPresence);
  ownershipObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  updateSmartCitationsPresence();
  loadProjectCache().catch(() => {});

  window.addEventListener("pagehide", () => {
    clearPopupTimer();
    ownershipObserver.disconnect();
    setBridgeActive(false);
    pendingRequests.forEach((pending) => {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("SmartTeX page closed."));
    });
    pendingRequests.clear();
  }, { once: true });
})();
