/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.__smartTeXEditorBridgeLoaded) return;
  globalThis.__smartTeXEditorBridgeLoaded = true;

  const STATE_EVENT = "smarttex:editor-state";
  const CITATION_REQUEST_EVENT = "smarttex:citation-editor-request";
  const CITATION_RESPONSE_EVENT = "smarttex:citation-editor-response";
  const CITE_COMMAND = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/i;
  let editorKind = "";
  let editor = null;
  let boundSession = null;
  let scheduledState = false;
  let lastFingerprint = "";
  let codeMirrorCleanup = null;
  let citationAutocompleteActive = false;

  function looksLikeCodeMirrorView(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      value.state?.doc &&
      typeof value.state.doc.toString === "function" &&
      typeof value.dispatch === "function"
    );
  }

  function discoverCodeMirrorView(value, depth = 0, seen = new Set()) {
    if (!value || depth > 3 || (typeof value !== "object" && typeof value !== "function")) {
      return null;
    }
    if (looksLikeCodeMirrorView(value)) return value;
    if (seen.has(value)) return null;
    seen.add(value);

    const preferredKeys = [
      "view",
      "editorView",
      "cmView",
      "editor",
      "_view",
      "rootView",
      "docView"
    ];
    for (const key of preferredKeys) {
      try {
        const found = discoverCodeMirrorView(value[key], depth + 1, seen);
        if (found) return found;
      } catch (_error) {
        // Framework-owned properties may use guarded accessors.
      }
    }

    if (depth >= 2) return null;
    let keys = [];
    try {
      keys = Object.getOwnPropertyNames(value).slice(0, 80);
    } catch (_error) {
      return null;
    }
    for (const key of keys) {
      if (preferredKeys.includes(key)) continue;
      try {
        const found = discoverCodeMirrorView(value[key], depth + 1, seen);
        if (found) return found;
      } catch (_error) {
        // Continue with the next discoverable property.
      }
    }
    return null;
  }

  function findCodeMirrorEditor() {
    const roots = [
      document.querySelector("#ide-redesign-panel-source-editor .cm-editor"),
      document.querySelector(".ide-redesign-editor-container .cm-editor"),
      document.querySelector(".cm-editor")
    ].filter(Boolean);

    for (const root of roots) {
      const content = root.querySelector(".cm-content");
      const candidates = [
        root.cmView?.view,
        root.cmView,
        root.editorView,
        root.view,
        content?.cmView?.view,
        content?.cmView,
        content?.editorView,
        content?.view
      ];
      for (const candidate of candidates) {
        if (looksLikeCodeMirrorView(candidate)) return candidate;
      }
      const discovered = discoverCodeMirrorView(content || root);
      if (discovered) return discovered;
    }
    return null;
  }

  function findAceEditor() {
    const candidates = [
      document.querySelector("#editor .ace_editor:not(.ace_autocomplete)"),
      document.querySelector("#editor.ace_editor"),
      document.querySelector(".ace-editor-body.ace_editor:not(.ace_autocomplete)")
    ].filter(Boolean);

    for (const element of candidates) {
      if (element.env?.editor) return element.env.editor;
      if (window.ace?.edit) {
        try {
          return window.ace.edit(element);
        } catch (_error) {
          // The next element may be the actual editor.
        }
      }
    }
    return null;
  }

  function findEditor() {
    const codeMirror = findCodeMirrorEditor();
    if (codeMirror) return { kind: "codemirror", editor: codeMirror };
    const ace = findAceEditor();
    return ace ? { kind: "ace", editor: ace } : null;
  }

  function selectedFileName() {
    const selected = document.querySelector(
      '.file-tree-list [role="treeitem"][aria-selected="true"], ' +
      '.file-tree-list li.selected[role="treeitem"]'
    );
    const fileName = (
      selected?.getAttribute("aria-label") ||
      selected?.querySelector(".item-name-button span")?.textContent ||
      selected?.querySelector(".item-name span")?.textContent ||
      selected?.querySelector(".entity-name span")?.textContent ||
      ""
    ).trim();
    if (fileName) return fileName;

    const breadcrumb = document.querySelector(".ol-cm-breadcrumbs > div");
    return breadcrumb?.textContent?.trim() || "";
  }

  function normalizedProjectPath(value) {
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/\/+/g, "/")
      .toLowerCase();
  }

  function pathStem(value) {
    return normalizedProjectPath(value).replace(/\.[a-z0-9]{1,8}$/i, "");
  }

  function projectPathMatches(leftValue, rightValue) {
    const left = normalizedProjectPath(leftValue);
    const right = normalizedProjectPath(rightValue);
    if (!left || !right) return false;
    const leftName = left.split("/").pop();
    const rightName = right.split("/").pop();
    return (
      left === right ||
      leftName === rightName ||
      pathStem(left) === pathStem(right) ||
      pathStem(leftName) === pathStem(rightName)
    );
  }

  function treeItemPath(item) {
    return String(
      item?.getAttribute("data-path") ||
      item?.getAttribute("data-file-path") ||
      item?.getAttribute("aria-label") ||
      item?.querySelector(
        ".item-name-button span, .item-name span, .entity-name span, [data-testid*='file-name']"
      )?.textContent ||
      ""
    ).trim();
  }

  function likelyFileId(value) {
    const text = String(value || "").trim();
    if (/^[a-f0-9]{24}$/i.test(text) || /^[a-f0-9-]{32,40}$/i.test(text)) {
      return text;
    }
    const embedded = text.match(/[a-f0-9]{24}/i)?.[0];
    return embedded || "";
  }

  function entityFromReactValue(root, targetPath) {
    const seen = new Set();
    const budget = { remaining: 5000 };
    const visit = (value, depth) => {
      if (
        !value ||
        depth > 8 ||
        budget.remaining-- <= 0 ||
        (typeof value !== "object" && typeof value !== "function") ||
        seen.has(value)
      ) {
        return null;
      }
      seen.add(value);
      let name = "";
      let id = "";
      let url = "";
      try {
        name = value.path || value.filePath || value.name || value.fileName || "";
        id = (
          value._id ||
          value.fileId ||
          value.entityId ||
          value.id ||
          value.file?._id ||
          value.entity?._id ||
          ""
        );
        url = value.downloadUrl || value.downloadURL || value.url || "";
      } catch (_error) {
        // Continue through accessible child properties.
      }
      if (projectPathMatches(name, targetPath)) {
        const fileId = likelyFileId(id);
        if (fileId || url) return { fileId, url: String(url || "") };
      }

      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(value).slice(0, 120);
      } catch (_error) {
        return null;
      }
      const preferred = [
        "file",
        "entity",
        "item",
        "node",
        "data",
        "props",
        "memoizedProps",
        "pendingProps",
        "memoizedState",
        "children",
        "rootFolder",
        "child",
        "sibling"
      ];
      keys.sort((left, right) => (
        (
          preferred.indexOf(left) < 0
            ? preferred.length
            : preferred.indexOf(left)
        ) - (
          preferred.indexOf(right) < 0
            ? preferred.length
            : preferred.indexOf(right)
        )
      ));
      for (const key of keys) {
        if (["window", "ownerDocument", "parentNode"].includes(key)) continue;
        try {
          const found = visit(value[key], depth + 1);
          if (found) return found;
        } catch (_error) {
          // React-owned properties can contain guarded accessors.
        }
      }
      return null;
    };
    return visit(root, 0);
  }

  function visibleProjectFile(targetPath) {
    return [...document.querySelectorAll('.file-tree-list [role="treeitem"]')]
      .find((candidate) => projectPathMatches(treeItemPath(candidate), targetPath)) || null;
  }

  function reactProjectFile(targetPath, item = null) {
    const roots = [
      item,
      item?.closest(".file-tree-list"),
      document.querySelector(".file-tree-list"),
      document.querySelector("#ide-root"),
      document.querySelector("[data-testid='ide-root']")
    ].filter(Boolean);
    for (const root of roots) {
      const reactKeys = Object.getOwnPropertyNames(root).filter((key) => (
        /^__(?:react|preact|vue)/i.test(key) || /fiber|props/i.test(key)
      ));
      for (const key of reactKeys) {
        const entity = entityFromReactValue(root[key], targetPath);
        if (entity) return entity;
      }
    }
    const globalNames = Object.getOwnPropertyNames(window).filter((key) => (
      /^(?:project|ide|editor|fileTree|fileStore|rootFolder)$/i.test(key) ||
      /^OLProject/i.test(key)
    ));
    for (const key of globalNames) {
      try {
        const entity = entityFromReactValue(window[key], targetPath);
        if (entity) return entity;
      } catch (_error) {
        // Some page globals expose guarded accessors.
      }
    }
    return null;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function revealProjectFile(targetPath) {
    let item = visibleProjectFile(targetPath);
    if (item) return item;
    for (let pass = 0; pass < 4; pass += 1) {
      const collapsedItems = [...document.querySelectorAll(
        '.file-tree-list [role="treeitem"][aria-expanded="false"]'
      )];
      const expandButtons = collapsedItems.map((collapsed) => (
        collapsed.querySelector(
          'button[aria-label*="Expand" i], button[title*="Expand" i], ' +
          '[data-testid*="expand"]'
        )
      )).filter(Boolean);
      if (!expandButtons.length) break;
      for (const button of expandButtons) button.click();
      await delay(120);
      item = visibleProjectFile(targetPath);
      if (item) return item;
    }
    return null;
  }

  async function resolveProjectFile(pathValue) {
    const targetPath = String(pathValue || "").trim();
    if (!targetPath) return null;
    let item = visibleProjectFile(targetPath);
    let reactEntity = reactProjectFile(targetPath, item);
    if (!item && !reactEntity) {
      item = await revealProjectFile(targetPath);
      reactEntity = reactProjectFile(targetPath, item);
    }
    const explicit = (
      item?.getAttribute("data-download-url") ||
      item?.getAttribute("data-url") ||
      item?.querySelector("a[href]")?.href ||
      ""
    ).trim();
    if (explicit) {
      return { url: new URL(explicit, window.location.href).href, path: treeItemPath(item) };
    }
    const attributeId = likelyFileId(
      item?.getAttribute("data-file-id") ||
      item?.getAttribute("data-entity-id") ||
      item?.getAttribute("data-id") ||
      item?.getAttribute("data-rbd-draggable-id") ||
      item?.id ||
      ""
    );
    const fileId = attributeId || reactEntity?.fileId || "";
    const explicitReactUrl = String(reactEntity?.url || "").trim();
    if (explicitReactUrl) {
      return {
        url: new URL(explicitReactUrl, window.location.href).href,
        fileId,
        path: treeItemPath(item) || targetPath
      };
    }
    const projectId = window.location.pathname.match(/\/project\/([^/?#]+)/i)?.[1] || "";
    if (!projectId || !fileId) return null;
    return {
      url: `${window.location.origin}/project/${encodeURIComponent(projectId)}/file/${encodeURIComponent(fileId)}`,
      fileId,
      path: treeItemPath(item) || targetPath
    };
  }

  function acePositionToIndex(session, position) {
    return session?.doc?.positionToIndex?.(position, 0) || 0;
  }

  function aceScreenPosition(position) {
    if (!editor || !position) return null;
    const coordinates = editor.renderer?.textToScreenCoordinates?.(
      position.row,
      position.column
    );
    if (!coordinates) return null;
    return {
      pageX: Number(coordinates.pageX) || 0,
      pageY: Number(coordinates.pageY) || 0,
      lineHeight: Number(editor.renderer?.lineHeight) || 16
    };
  }

  function codeMirrorScreenPosition(index) {
    if (!editor || editorKind !== "codemirror") return null;
    const bounded = Math.max(0, Math.min(Number(index) || 0, editor.state.doc.length));
    const coordinates = editor.coordsAtPos?.(bounded, 1) || editor.coordsAtPos?.(bounded);
    if (!coordinates) return null;
    return {
      pageX: coordinates.left + window.scrollX,
      pageY: coordinates.top + window.scrollY,
      lineHeight: Math.max(14, coordinates.bottom - coordinates.top)
    };
  }

  function editorIndexAtCoordinates(clientXValue, clientYValue) {
    if (!editor) return null;
    const clientX = Number(clientXValue) || 0;
    const clientY = Number(clientYValue) || 0;
    if (editorKind === "codemirror") {
      const index = editor.posAtCoords?.({ x: clientX, y: clientY }, true);
      if (!Number.isFinite(index)) return null;
      return Math.max(0, Math.min(index, editor.state.doc.length));
    }

    const coordinates = editor.renderer?.screenToTextCoordinates?.(
      clientX + window.scrollX,
      clientY + window.scrollY
    );
    const session = editor.getSession?.();
    if (!coordinates || !session) return null;
    return Math.max(
      0,
      Math.min(
        acePositionToIndex(session, coordinates),
        session.getValue().length
      )
    );
  }

  function codeMirrorContent(view) {
    return view?.contentDOM || view?.dom?.querySelector?.(".cm-content") || null;
  }

  function getEditorState() {
    if (!editor) return null;

    if (editorKind === "codemirror") {
      const value = editor.state.doc.toString();
      const selection = editor.state.selection?.main;
      const cursorIndex = Number(selection?.head ?? 0);
      const line = editor.state.doc.lineAt(
        Math.max(0, Math.min(cursorIndex, editor.state.doc.length))
      );
      const content = codeMirrorContent(editor);
      return {
        value,
        cursorIndex,
        cursor: {
          row: line.number - 1,
          column: cursorIndex - line.from
        },
        selectionFrom: Number(selection?.from ?? cursorIndex),
        selectionTo: Number(selection?.to ?? cursorIndex),
        selectionAnchor: Number(selection?.anchor ?? selection?.from ?? cursorIndex),
        selectionHead: Number(selection?.head ?? cursorIndex),
        screen: codeMirrorScreenPosition(cursorIndex),
        fileName: selectedFileName(),
        focused: Boolean(editor.hasFocus || (content && content.contains(document.activeElement))),
        editorKind
      };
    }

    const session = editor.getSession();
    const cursor = editor.getCursorPosition();
    const selection = editor.getSelectionRange?.();
    const cursorIndex = acePositionToIndex(session, cursor);
    return {
      value: session.getValue(),
      cursorIndex,
      cursor,
      selectionFrom: selection ? acePositionToIndex(session, selection.start) : cursorIndex,
      selectionTo: selection ? acePositionToIndex(session, selection.end) : cursorIndex,
      selectionAnchor: selection
        ? acePositionToIndex(
          session,
          editor.selection?.isBackwards?.() ? selection.end : selection.start
        )
        : cursorIndex,
      selectionHead: cursorIndex,
      screen: aceScreenPosition(cursor),
      fileName: selectedFileName(),
      focused: Boolean(editor.isFocused?.()),
      editorKind
    };
  }

  function codeMirrorReadOnly(view) {
    const content = codeMirrorContent(view);
    return content?.getAttribute?.("contenteditable") !== "true";
  }

  function replaceRange(startValue, endValue, textValue, options = {}) {
    if (!editor) return false;
    const text = String(textValue ?? "");
    if (editorKind === "codemirror") {
      if (codeMirrorReadOnly(editor)) return false;
      const docLength = editor.state.doc.length;
      const start = Math.max(0, Math.min(Number(startValue) || 0, docLength));
      const end = Math.max(start, Math.min(Number(endValue) || 0, docLength));
      const selectionStart = Math.max(
        start,
        Math.min(
          Number(options.selectionStart ?? start + text.length),
          start + text.length
        )
      );
      const selectionEnd = Math.max(
        start,
        Math.min(
          Number(options.selectionEnd ?? selectionStart),
          start + text.length
        )
      );
      editor.dispatch({
        changes: { from: start, to: end, insert: text },
        selection: { anchor: selectionStart, head: selectionEnd },
        scrollIntoView: true
      });
      if (options.focus !== false) editor.focus();
      scheduleState();
      return true;
    }

    if (editor.getReadOnly?.()) return false;
    const session = editor.getSession();
    const start = Math.max(0, Math.min(Number(startValue) || 0, session.getValue().length));
    const end = Math.max(start, Math.min(Number(endValue) || 0, session.getValue().length));
    const startPosition = session.doc.indexToPosition(start, 0);
    const endPosition = session.doc.indexToPosition(end, 0);
    const Range = window.ace?.require?.("ace/range")?.Range;
    if (!Range) return false;
    session.replace(
      new Range(startPosition.row, startPosition.column, endPosition.row, endPosition.column),
      text
    );
    const selectionStart = Math.max(
      start,
      Math.min(
        Number(options.selectionStart ?? start + text.length),
        start + text.length
      )
    );
    const selectionEnd = Math.max(
      start,
      Math.min(
        Number(options.selectionEnd ?? selectionStart),
        start + text.length
      )
    );
    const nextStart = session.doc.indexToPosition(selectionStart, 0);
    const nextEnd = session.doc.indexToPosition(selectionEnd, 0);
    editor.selection.setSelectionRange(
      new Range(nextStart.row, nextStart.column, nextEnd.row, nextEnd.column)
    );
    if (options.focus !== false) editor.focus();
    scheduleState();
    return true;
  }

  function setCursorIndex(indexValue, focusEditor = true) {
    if (!editor) return false;
    if (editorKind === "codemirror") {
      const index = Math.max(
        0,
        Math.min(Number(indexValue) || 0, editor.state.doc.length)
      );
      editor.dispatch({
        selection: { anchor: index },
        scrollIntoView: true
      });
      if (focusEditor) editor.focus();
      scheduleState();
      return true;
    }

    const session = editor.getSession();
    const index = Math.max(
      0,
      Math.min(Number(indexValue) || 0, session.getValue().length)
    );
    const position = session.doc.indexToPosition(index, 0);
    editor.selection.moveCursorToPosition(position);
    editor.clearSelection();
    if (focusEditor) editor.focus();
    editor.renderer?.scrollCursorIntoView?.(position, 0.5);
    scheduleState();
    return true;
  }

  function setSelectionRange(anchorValue, headValue, focusEditor = true) {
    if (!editor) return false;
    if (editorKind === "codemirror") {
      const length = editor.state.doc.length;
      const anchor = Math.max(0, Math.min(Number(anchorValue) || 0, length));
      const head = Math.max(0, Math.min(Number(headValue) || 0, length));
      editor.dispatch({
        selection: { anchor, head },
        scrollIntoView: true
      });
      if (focusEditor) editor.focus();
      scheduleState();
      return true;
    }

    const session = editor.getSession();
    const length = session.getValue().length;
    const anchor = Math.max(0, Math.min(Number(anchorValue) || 0, length));
    const head = Math.max(0, Math.min(Number(headValue) || 0, length));
    const Range = window.ace?.require?.("ace/range")?.Range;
    if (!Range) return false;
    const startIndex = Math.min(anchor, head);
    const endIndex = Math.max(anchor, head);
    const start = session.doc.indexToPosition(startIndex, 0);
    const end = session.doc.indexToPosition(endIndex, 0);
    editor.selection.setSelectionRange(
      new Range(start.row, start.column, end.row, end.column),
      anchor > head
    );
    if (focusEditor) editor.focus();
    editor.renderer?.scrollCursorIntoView?.(
      session.doc.indexToPosition(head, 0),
      0.5
    );
    scheduleState();
    return true;
  }

  function citationTokenAtCursor() {
    const state = getEditorState();
    if (!state) return null;
    const beforeCursor = state.value.slice(0, state.cursorIndex);
    const match = beforeCursor.match(CITE_COMMAND);
    if (!match) return null;
    const argument = match[1];
    const lastComma = argument.lastIndexOf(",");
    const beforeFragment = argument.slice(lastComma + 1);
    const leadingWhitespace = beforeFragment.match(/^\s*/)?.[0] || "";
    const start = state.cursorIndex - beforeFragment.length + leadingWhitespace.length;
    const afterFragment = state.value.slice(state.cursorIndex).match(/^[^,{}\s]*/)?.[0] || "";
    return {
      start,
      end: state.cursorIndex + afterFragment.length,
      fragment: beforeFragment.slice(leadingWhitespace.length) + afterFragment
    };
  }

  function replaceCitationToken(text) {
    const token = citationTokenAtCursor();
    if (!token || !replaceRange(token.start, token.end, text)) return null;
    return token;
  }

  function hideNativeCitationAutocomplete() {
    if (!citationAutocompleteActive) return;
    if (editorKind === "ace") {
      try {
        editor?.completer?.detach?.();
        editor?.completer?.popup?.hide?.();
      } catch (_error) {
        // ACE autocomplete APIs vary between editor releases.
      }
    }
    document.body?.classList.add("smarttex-citation-autocomplete-active");
  }

  function setCitationAutocompleteActive(value) {
    citationAutocompleteActive = Boolean(value);
    document.body?.classList.toggle(
      "smarttex-citation-autocomplete-active",
      citationAutocompleteActive
    );
    if (citationAutocompleteActive) hideNativeCitationAutocomplete();
  }

  function citationResponse(requestId, ok, payload = {}) {
    window.dispatchEvent(new CustomEvent(CITATION_RESPONSE_EVENT, {
      detail: JSON.stringify({ requestId, ok, ...payload })
    }));
  }

  function stateFingerprint(state) {
    if (!state) return "";
    return [
      state.fileName,
      state.cursorIndex,
      state.selectionFrom,
      state.selectionTo,
      state.focused ? "1" : "0",
      state.value.length,
      state.value.slice(Math.max(0, state.cursorIndex - 220), state.cursorIndex + 120)
    ].join("\n");
  }

  function emitState() {
    scheduledState = false;
    const state = getEditorState();
    if (!state) return;
    lastFingerprint = stateFingerprint(state);
    window.dispatchEvent(new CustomEvent(STATE_EVENT, {
      detail: JSON.stringify(state)
    }));
  }

  function scheduleState() {
    if (scheduledState) return;
    scheduledState = true;
    window.requestAnimationFrame(emitState);
  }

  function cleanupCodeMirrorBinding() {
    if (typeof codeMirrorCleanup === "function") codeMirrorCleanup();
    codeMirrorCleanup = null;
  }

  function bindCodeMirror(view) {
    cleanupCodeMirrorBinding();
    const content = codeMirrorContent(view);
    const root = view.dom || content?.closest?.(".cm-editor");
    const scroller = view.scrollDOM || root?.querySelector?.(".cm-scroller");
    const events = [
      "input",
      "keyup",
      "mouseup",
      "click",
      "focus",
      "blur",
      "paste",
      "cut",
      "compositionend"
    ];
    for (const eventName of events) {
      content?.addEventListener(eventName, scheduleState, true);
    }
    scroller?.addEventListener("scroll", scheduleState, { passive: true });

    const selectionListener = () => {
      const selection = document.getSelection();
      if (selection?.anchorNode && content?.contains(selection.anchorNode)) scheduleState();
    };
    document.addEventListener("selectionchange", selectionListener, true);

    const observer = new MutationObserver(scheduleState);
    if (root) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-selected"]
      });
    }

    codeMirrorCleanup = () => {
      for (const eventName of events) {
        content?.removeEventListener(eventName, scheduleState, true);
      }
      scroller?.removeEventListener("scroll", scheduleState);
      document.removeEventListener("selectionchange", selectionListener, true);
      observer.disconnect();
    };
  }

  function bindAceSession(session) {
    if (!session || session === boundSession) return;
    if (boundSession) {
      try {
        boundSession.off("change", scheduleState);
      } catch (_error) {
        // The old editor session may already be disposed.
      }
    }
    boundSession = session;
    boundSession.on("change", scheduleState);
  }

  function bindEditor(found) {
    if (!found?.editor) return;
    if (found.editor === editor && found.kind === editorKind) return;

    cleanupCodeMirrorBinding();
    editor = found.editor;
    editorKind = found.kind;
    boundSession = null;

    if (editorKind === "codemirror") {
      bindCodeMirror(editor);
      scheduleState();
      return;
    }

    bindAceSession(editor.getSession());
    editor.selection?.on?.("changeCursor", scheduleState);
    editor.selection?.on?.("changeSelection", scheduleState);
    editor.on?.("changeSession", () => {
      bindAceSession(editor.getSession());
      scheduleState();
    });
    editor.on?.("focus", scheduleState);
    editor.on?.("blur", scheduleState);
    editor.renderer?.on?.("afterRender", scheduleState);
    scheduleState();
  }

  window.addEventListener(CITATION_REQUEST_EVENT, async (event) => {
    let request = {};
    try {
      request = JSON.parse(String(event.detail || "{}"));
    } catch (_error) {
      return;
    }
    const requestId = request.requestId;
    try {
      if (!editor) bindEditor(findEditor());
      if (request.type === "getState") {
        const state = getEditorState();
        citationResponse(requestId, Boolean(state), { state });
        return;
      }
      if (request.type === "getCoordinates") {
        const screen = editorKind === "codemirror"
          ? codeMirrorScreenPosition(Number(request.index))
          : (() => {
            const session = editor?.getSession?.();
            const position = session?.doc?.indexToPosition?.(
              Math.max(0, Math.min(Number(request.index) || 0, session.getValue().length)),
              0
            );
            return aceScreenPosition(position);
          })();
        citationResponse(requestId, Boolean(screen), { screen });
        return;
      }
      if (request.type === "getIndexAtCoordinates") {
        const index = editorIndexAtCoordinates(request.clientX, request.clientY);
        citationResponse(requestId, Number.isFinite(index), { index });
        return;
      }
      if (request.type === "replaceCitationToken") {
        const token = replaceCitationToken(String(request.text ?? ""));
        citationResponse(requestId, Boolean(token), token ? { token } : {});
        return;
      }
      if (request.type === "setCitationAutocompleteActive") {
        setCitationAutocompleteActive(request.active);
        citationResponse(requestId, Boolean(editor), { active: citationAutocompleteActive });
        return;
      }
      if (request.type === "focus") {
        editor?.focus?.();
        citationResponse(requestId, Boolean(editor));
        return;
      }
      if (request.type === "setCursor") {
        const moved = setCursorIndex(request.index, request.focus !== false);
        citationResponse(requestId, moved, moved ? {
          index: Math.max(0, Number(request.index) || 0)
        } : {});
        return;
      }
      if (request.type === "resolveProjectFile") {
        const file = await resolveProjectFile(request.path);
        citationResponse(requestId, Boolean(file), file ? { file } : {
          error: `Project file not found: ${String(request.path || "")}`
        });
        return;
      }
      if (request.type === "setSelection") {
        const moved = setSelectionRange(
          request.anchor,
          request.head,
          request.focus !== false
        );
        citationResponse(requestId, moved, moved ? {
          anchor: Math.max(0, Number(request.anchor) || 0),
          head: Math.max(0, Number(request.head) || 0)
        } : {});
        return;
      }
      if (request.type === "replaceRange") {
        const replaced = replaceRange(
          request.start,
          request.end,
          request.text,
          {
            selectionStart: request.selectionStart,
            selectionEnd: request.selectionEnd,
            focus: request.focus !== false
          }
        );
        citationResponse(requestId, replaced);
        return;
      }
      citationResponse(requestId, false, {
        error: `Unknown SmartTeX citation request: ${request.type}`
      });
    } catch (error) {
      citationResponse(requestId, false, {
        error: error?.message || String(error)
      });
    }
  });

  const observer = new MutationObserver(() => {
    const found = findEditor();
    if (found) bindEditor(found);
    if (citationAutocompleteActive) hideNativeCitationAutocomplete();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const poll = window.setInterval(() => {
    const found = findEditor();
    if (found) bindEditor(found);
    const state = getEditorState();
    if (state && stateFingerprint(state) !== lastFingerprint) scheduleState();
  }, 250);

  window.addEventListener("pagehide", () => {
    window.clearInterval(poll);
    cleanupCodeMirrorBinding();
    observer.disconnect();
    setCitationAutocompleteActive(false);
  }, { once: true });

  bindEditor(findEditor());
})();
