/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

((global) => {
  "use strict";

  const CARET_MARKER = "\uE001";
  const OPERATOR_CARET_MARKER = "\uE002";

  function isEscaped(source, index) {
    let slashes = 0;
    for (let position = index - 1; position >= 0 && source[position] === "\\"; position -= 1) {
      slashes += 1;
    }
    return slashes % 2 === 1;
  }

  function readBalanced(source, start, opening = "{", closing = "}") {
    if (source[start] !== opening) return null;
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === opening && !isEscaped(source, index)) depth += 1;
      if (source[index] === closing && !isEscaped(source, index)) {
        depth -= 1;
        if (depth === 0) return { start, end: index + 1 };
      }
    }
    return null;
  }

  function skipWhitespace(source, startValue) {
    let position = startValue;
    while (position < source.length && /\s/.test(source[position])) position += 1;
    return position;
  }

  function splitTableSource(sourceValue) {
    const source = String(sourceValue || "");
    const rows = [];
    let cells = [];
    let cell = "";
    let braces = 0;
    let mathDelimiter = "";

    const finishCell = () => {
      cells.push(cell);
      cell = "";
    };
    const finishRow = () => {
      finishCell();
      rows.push(cells);
      cells = [];
    };

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (!isEscaped(source, index)) {
        if (!mathDelimiter && character === "$") {
          mathDelimiter = source.startsWith("$$", index) ? "$$" : "$";
          cell += mathDelimiter;
          index += mathDelimiter.length - 1;
          continue;
        }
        if (mathDelimiter && source.startsWith(mathDelimiter, index)) {
          cell += mathDelimiter;
          index += mathDelimiter.length - 1;
          mathDelimiter = "";
          continue;
        }
        if (!mathDelimiter && source.startsWith("\\(", index)) {
          mathDelimiter = "\\)";
          cell += "\\(";
          index += 1;
          continue;
        }
        if (mathDelimiter === "\\)" && source.startsWith("\\)", index)) {
          cell += "\\)";
          index += 1;
          mathDelimiter = "";
          continue;
        }
        if (!mathDelimiter && character === "{") braces += 1;
        if (!mathDelimiter && character === "}") braces = Math.max(0, braces - 1);
      }

      if (!mathDelimiter && braces === 0 && character === "&" && !isEscaped(source, index)) {
        finishCell();
        continue;
      }
      if (
        !mathDelimiter &&
        braces === 0 &&
        source.startsWith("\\tabularnewline", index)
      ) {
        finishRow();
        index += "\\tabularnewline".length - 1;
        continue;
      }
      if (
        !mathDelimiter &&
        braces === 0 &&
        source.startsWith("\\\\", index)
      ) {
        finishRow();
        index += 1;
        let next = skipWhitespace(source, index + 1);
        if (source[next] === "*") next = skipWhitespace(source, next + 1);
        if (source[next] === "[") {
          const spacing = readBalanced(source, next, "[", "]");
          if (spacing) index = spacing.end - 1;
        }
        continue;
      }
      cell += character;
    }
    finishRow();
    return rows;
  }


  function splitTableSourceDetailed(sourceValue) {
    const source = String(sourceValue || "");
    const rows = [];
    let cells = [];
    let cellStart = 0;
    let rowStart = 0;
    let braces = 0;
    let mathDelimiter = "";

    const finishCell = (end) => {
      cells.push({
        raw: source.slice(cellStart, end),
        start: cellStart,
        end
      });
    };
    const finishRow = (end, terminatorEnd) => {
      finishCell(end);
      rows.push({
        cells,
        start: rowStart,
        end,
        terminatorEnd
      });
      cells = [];
      rowStart = terminatorEnd;
      cellStart = terminatorEnd;
    };

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (!isEscaped(source, index)) {
        if (!mathDelimiter && character === "$") {
          mathDelimiter = source.startsWith("$$", index) ? "$$" : "$";
          index += mathDelimiter.length - 1;
          continue;
        }
        if (mathDelimiter && source.startsWith(mathDelimiter, index)) {
          index += mathDelimiter.length - 1;
          mathDelimiter = "";
          continue;
        }
        if (!mathDelimiter && source.startsWith("\\(", index)) {
          mathDelimiter = "\\)";
          index += 1;
          continue;
        }
        if (mathDelimiter === "\\)" && source.startsWith("\\)", index)) {
          index += 1;
          mathDelimiter = "";
          continue;
        }
        if (!mathDelimiter && character === "{") braces += 1;
        if (!mathDelimiter && character === "}") braces = Math.max(0, braces - 1);
      }

      if (!mathDelimiter && braces === 0 && character === "&" && !isEscaped(source, index)) {
        finishCell(index);
        cellStart = index + 1;
        continue;
      }

      let terminatorEnd = -1;
      if (!mathDelimiter && braces === 0 && source.startsWith("\\tabularnewline", index)) {
        terminatorEnd = index + "\\tabularnewline".length;
      } else if (!mathDelimiter && braces === 0 && source.startsWith("\\\\", index)) {
        terminatorEnd = index + 2;
        let next = skipWhitespace(source, terminatorEnd);
        if (source[next] === "*") next = skipWhitespace(source, next + 1);
        if (source[next] === "[") {
          const spacing = readBalanced(source, next, "[", "]");
          if (spacing) next = spacing.end;
        }
        terminatorEnd = next;
      }
      if (terminatorEnd < 0) continue;
      finishRow(index, terminatorEnd);
      index = terminatorEnd - 1;
    }
    if (rowStart < source.length || !rows.length) {
      finishRow(source.length, source.length);
    }
    return rows;
  }

  function emptyHorizontalBoundary() {
    return { full: 0, partial: new Map() };
  }

  function mergeHorizontalBoundary(left, right) {
    const merged = emptyHorizontalBoundary();
    merged.full = Math.max(Number(left?.full) || 0, Number(right?.full) || 0);
    for (const [column, count] of left?.partial || []) {
      merged.partial.set(column, Math.max(merged.partial.get(column) || 0, count));
    }
    for (const [column, count] of right?.partial || []) {
      merged.partial.set(column, Math.max(merged.partial.get(column) || 0, count));
    }
    return merged;
  }

  function stripLeadingRules(value) {
    let source = String(value || "");
    let position = 0;
    const boundary = emptyHorizontalBoundary();
    while (position < source.length) {
      const whitespace = source.slice(position).match(/^\s*/)?.[0] || "";
      position += whitespace.length;
      const slice = source.slice(position);
      const full = slice.match(/^\\(hline|toprule|midrule|bottomrule)\b\s*/);
      if (full) {
        boundary.full = Math.min(2, boundary.full + 1);
        position += full[0].length;
        continue;
      }
      const partial = slice.match(/^\\(?:cline|cmidrule(?:\([^)]*\))?)\s*\{\s*(\d+)\s*-\s*(\d+)\s*\}\s*/);
      if (partial) {
        const first = Math.max(1, Number(partial[1]) || 1);
        const last = Math.max(first, Number(partial[2]) || first);
        for (let column = first - 1; column <= last - 1; column += 1) {
          boundary.partial.set(
            column,
            Math.min(2, (boundary.partial.get(column) || 0) + 1)
          );
        }
        position += partial[0].length;
        continue;
      }
      position -= whitespace.length;
      break;
    }
    return { source: source.slice(position), boundary };
  }

  function parseColumnSpec(specValue) {
    const spec = String(specValue || "");
    const columns = [];
    let pendingLeftBorder = 0;

    const appendSpec = (value) => {
      for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (/\s/.test(character)) continue;
        if (character === "|") {
          if (columns.length) {
            columns[columns.length - 1].rightBorder = Math.min(
              2,
              (columns[columns.length - 1].rightBorder || 0) + 1
            );
          }
          pendingLeftBorder = Math.min(2, pendingLeftBorder + 1);
          continue;
        }
        if (character === "*" && value[index + 1] === "{") {
          const countGroup = readBalanced(value, index + 1);
          if (!countGroup) continue;
          const specStart = skipWhitespace(value, countGroup.end);
          const repeatedGroup = readBalanced(value, specStart);
          if (!repeatedGroup) continue;
          const count = Number.parseInt(
            value.slice(index + 2, countGroup.end - 1),
            10
          );
          const repeated = value.slice(specStart + 1, repeatedGroup.end - 1);
          for (let repeat = 0; repeat < Math.min(50, count || 0); repeat += 1) {
            appendSpec(repeated);
          }
          index = repeatedGroup.end - 1;
          continue;
        }
        if (["@","!",">","<"].includes(character) && value[index + 1] === "{") {
          const modifier = readBalanced(value, index + 1);
          if (modifier) index = modifier.end - 1;
          continue;
        }
        if (["p", "m", "b"].includes(character) && value[index + 1] === "{") {
          const width = readBalanced(value, index + 1);
          columns.push({
            align: "left",
            leftBorder: pendingLeftBorder,
            rightBorder: 0
          });
          pendingLeftBorder = 0;
          if (width) index = width.end - 1;
          continue;
        }
        if (character === "D") {
          let end = index + 1;
          for (let groupIndex = 0; groupIndex < 3; groupIndex += 1) {
            const groupStart = skipWhitespace(value, end);
            const group = readBalanced(value, groupStart);
            if (!group) break;
            end = group.end;
          }
          columns.push({
            align: "right",
            leftBorder: pendingLeftBorder,
            rightBorder: 0
          });
          pendingLeftBorder = 0;
          index = end - 1;
          continue;
        }
        if (character === "S") {
          const optionalStart = skipWhitespace(value, index + 1);
          const optional = readBalanced(value, optionalStart, "[", "]");
          columns.push({
            align: "right",
            leftBorder: pendingLeftBorder,
            rightBorder: 0
          });
          pendingLeftBorder = 0;
          if (optional) index = optional.end - 1;
          continue;
        }
        if (/^[lcrX]$/.test(character) || /[A-Za-z]/.test(character)) {
          columns.push({
            align: character === "r"
              ? "right"
              : character === "c"
                ? "center"
                : "left",
            leftBorder: pendingLeftBorder,
            rightBorder: 0
          });
          pendingLeftBorder = 0;
        }
      }
    };
    appendSpec(spec);
    if (pendingLeftBorder && columns.length) {
      columns[columns.length - 1].rightBorder = Math.max(
        columns[columns.length - 1].rightBorder || 0,
        pendingLeftBorder
      );
    }
    return columns;
  }

  function parseMulticolumn(value) {
    const source = String(value || "");
    let position = skipWhitespace(source, 0);
    if (!source.startsWith("\\multicolumn", position)) return null;
    position = skipWhitespace(source, position + "\\multicolumn".length);
    const count = readBalanced(source, position);
    if (!count) return null;
    position = skipWhitespace(source, count.end);
    const spec = readBalanced(source, position);
    if (!spec) return null;
    position = skipWhitespace(source, spec.end);
    const content = readBalanced(source, position);
    if (!content || source.slice(content.end).trim()) return null;
    return {
      colspan: Math.max(
        1,
        Math.min(50, Number.parseInt(source.slice(count.start + 1, count.end - 1), 10) || 1)
      ),
      columnSpec: source.slice(spec.start + 1, spec.end - 1),
      content: source.slice(content.start + 1, content.end - 1),
      contentStart: content.start + 1,
      contentEnd: content.end - 1,
      commandStart: skipWhitespace(source, 0),
      commandEnd: content.end
    };
  }

  function parseTable(sourceValue, columnSpecValue = "") {
    const source = String(sourceValue || "");
    const rawRows = splitTableSourceDetailed(source);
    const rows = [];
    let pendingBoundary = emptyHorizontalBoundary();

    for (const rawRow of rawRows) {
      const rawCells = rawRow.cells.map((cell) => ({ ...cell }));
      const first = stripLeadingRules(rawCells[0]?.raw || "");
      if (rawCells[0]) {
        rawCells[0].raw = first.source;
        rawCells[0].start += (rawCells[0].end - rawCells[0].start) - first.source.length;
      }
      pendingBoundary = mergeHorizontalBoundary(pendingBoundary, first.boundary);
      const hasContent = rawCells.some((cell) => cell.raw.trim());
      if (!hasContent) continue;
      const cells = rawCells.map((cell) => {
        const multicolumn = parseMulticolumn(cell.raw);
        if (multicolumn) {
          return {
            ...multicolumn,
            sourceStart: cell.start,
            sourceEnd: cell.end,
            contentStart: cell.start + multicolumn.contentStart,
            contentEnd: cell.start + multicolumn.contentEnd
          };
        }
        const leading = cell.raw.match(/^\s*/)?.[0].length || 0;
        const trailing = cell.raw.match(/\s*$/)?.[0].length || 0;
        const contentEnd = Math.max(leading, cell.raw.length - trailing);
        return {
          colspan: 1,
          columnSpec: "",
          content: cell.raw.slice(leading, contentEnd),
          sourceStart: cell.start,
          sourceEnd: cell.end,
          contentStart: cell.start + leading,
          contentEnd: cell.start + contentEnd
        };
      });
      rows.push({
        cells,
        ruleBefore: pendingBoundary,
        ruleAfter: emptyHorizontalBoundary()
      });
      pendingBoundary = emptyHorizontalBoundary();
    }
    if (rows.length) rows[rows.length - 1].ruleAfter = pendingBoundary;
    return {
      columns: parseColumnSpec(columnSpecValue),
      rows
    };
  }

  function appendText(parent, sourceValue, options) {
    const source = String(sourceValue || "");
    const document = parent.ownerDocument;
    const sourceOffset = Number.isFinite(Number(options.sourceOffset))
      ? Number(options.sourceOffset)
      : null;
    const formatting = {
      textbf: "strong",
      textit: "em",
      emph: "em",
      underline: "u",
      texttt: "code",
      textsc: "span",
      hl: "mark"
    };
    const escaped = {
      "\\&": "&",
      "\\%": "%",
      "\\_": "_",
      "\\#": "#",
      "\\$": "$",
      "\\{": "{",
      "\\}": "}",
      "\\textbackslash": "\\",
      "\\dots": "…",
      "\\ldots": "…"
    };

    const referenceCommands = new Set([
      "ref",
      "eqref",
      "pageref",
      "autoref",
      "cref",
      "Cref"
    ]);
    const safeColor = (value) => {
      const color = String(value || "").trim();
      return (
        /^(?:[a-z]+|#[a-f0-9]{3,8}|rgb\(\s*\d+(?:\s*,\s*\d+){2}\s*\))$/i
          .test(color)
      ) ? color : "";
    };
    let highlightColor = safeColor(options.highlightColor);
    let textBuffer = "";
    let textBoundaries = [];
    const absoluteOffset = (relativeOffset) => (
      sourceOffset === null ? null : sourceOffset + relativeOffset
    );
    const appendBufferedText = (value, startValue, endValue) => {
      const text = String(value || "");
      if (!text) return;
      const start = absoluteOffset(startValue);
      const end = absoluteOffset(endValue);
      if (
        textBuffer &&
        start !== null &&
        textBoundaries.at(-1) !== start
      ) {
        flushText();
      }
      if (!textBuffer && start !== null) textBoundaries = [start];
      textBuffer += text;
      if (start === null || end === null) return;
      const span = end - start;
      for (let index = 1; index <= text.length; index += 1) {
        textBoundaries.push(
          Math.round(start + span * index / text.length)
        );
      }
    };
    const flushText = () => {
      if (!textBuffer) return;
      const node = document.createTextNode(textBuffer);
      if (textBoundaries.length === textBuffer.length + 1) {
        node.smarttexSourceBoundaries = textBoundaries.slice();
      }
      parent.appendChild(node);
      textBuffer = "";
      textBoundaries = [];
    };
    for (let index = 0; index < source.length;) {
      if (
        source[index] === CARET_MARKER ||
        source[index] === OPERATOR_CARET_MARKER
      ) {
        flushText();
        const caret = document.createElement("span");
        caret.className = "smarttex-table-rendered-caret";
        if (source[index] === OPERATOR_CARET_MARKER) {
          caret.classList.add("smarttex-table-operator-caret");
        }
        caret.setAttribute("aria-hidden", "true");
        parent.appendChild(caret);
        index += 1;
        continue;
      }
      if (source[index] === "~") {
        appendBufferedText("\u00A0", index, index + 1);
        index += 1;
        continue;
      }
      if (source[index] === "\\" && source.startsWith("\\\\", index)) {
        flushText();
        parent.appendChild(document.createElement("br"));
        index += 2;
        continue;
      }
      if (source[index] !== "\\") {
        if (source[index] !== "{" && source[index] !== "}") {
          appendBufferedText(source[index], index, index + 1);
        } else {
          flushText();
        }
        index += 1;
        continue;
      }

      const commandMatch = source.slice(index).match(/^\\([A-Za-z@]+|.)/);
      if (!commandMatch) {
        appendBufferedText(source[index], index, index + 1);
        index += 1;
        continue;
      }
      const command = commandMatch[0];
      if (escaped[command]) {
        appendBufferedText(escaped[command], index, index + command.length);
        index += command.length;
        continue;
      }
      if (command === "\\newline" || command === "\\linebreak") {
        flushText();
        parent.appendChild(document.createElement("br"));
        index += command.length;
        continue;
      }

      const commandName = command.slice(1);
      let groupStart = skipWhitespace(source, index + command.length);
      const group = readBalanced(source, groupStart);
      if (commandName === "sethlcolor" && group) {
        highlightColor = safeColor(
          source.slice(group.start + 1, group.end - 1)
        );
        index = group.end;
        continue;
      }
      if (
        ["textcolor", "colorbox", "fcolorbox"].includes(commandName) &&
        group
      ) {
        const groups = [group];
        let groupEnd = group.end;
        const requiredGroups = commandName === "fcolorbox" ? 3 : 2;
        while (groups.length < requiredGroups) {
          const nextStart = skipWhitespace(source, groupEnd);
          const next = readBalanced(source, nextStart);
          if (!next) break;
          groups.push(next);
          groupEnd = next.end;
        }
        if (groups.length === requiredGroups) {
          flushText();
          const element = document.createElement(
            commandName === "textcolor" ? "span" : "mark"
          );
          const foreground = safeColor(
            source.slice(groups[0].start + 1, groups[0].end - 1)
          );
          const backgroundGroup = commandName === "fcolorbox"
            ? groups[1]
            : groups[0];
          const background = safeColor(
            source.slice(backgroundGroup.start + 1, backgroundGroup.end - 1)
          );
          if (commandName === "textcolor" && foreground) {
            element.style.color = foreground;
          } else if (background) {
            element.style.backgroundColor = background;
          }
          if (commandName === "fcolorbox" && foreground) {
            element.style.border = `1px solid ${foreground}`;
          }
          const contentGroup = groups.at(-1);
          appendText(
            element,
            source.slice(contentGroup.start + 1, contentGroup.end - 1),
            {
              ...options,
              highlightColor,
              sourceOffset: sourceOffset === null
                ? undefined
                : sourceOffset + contentGroup.start + 1
            }
          );
          parent.appendChild(element);
          index = groupEnd;
          continue;
        }
      }
      if (referenceCommands.has(commandName) && group) {
        flushText();
        const label = source.slice(group.start + 1, group.end - 1).trim();
        const rendered = options.renderReference?.({
          command: commandName,
          label
        });
        const referenceNode = rendered?.nodeType
          ? rendered
          : document.createTextNode(String(rendered || `[${label}]`));
        if (sourceOffset !== null) {
          referenceNode.smarttexSourceRange = {
            start: sourceOffset + index,
            end: sourceOffset + group.end
          };
        }
        parent.appendChild(referenceNode);
        index = group.end;
        continue;
      }
      if (formatting[commandName] && group) {
        flushText();
        const element = document.createElement(formatting[commandName]);
        if (commandName === "textsc") element.className = "smarttex-small-caps";
        if (commandName === "hl" && highlightColor) {
          element.style.backgroundColor = highlightColor;
        }
        appendText(
          element,
          source.slice(group.start + 1, group.end - 1),
          {
            ...options,
            highlightColor,
            sourceOffset: sourceOffset === null
              ? undefined
              : sourceOffset + group.start + 1
          }
        );
        parent.appendChild(element);
        index = group.end;
        continue;
      }

      const macro = options.macros?.[command];
      if (typeof macro === "string" && (options.macroDepth || 0) < 20) {
        const argumentCount = [...macro.matchAll(/#([1-9])/g)]
          .reduce((maximum, match) => Math.max(maximum, Number(match[1])), 0);
        const argumentsList = [];
        let macroEnd = index + command.length;
        let complete = true;
        for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
          const argumentStart = skipWhitespace(source, macroEnd);
          const argument = readBalanced(source, argumentStart);
          if (!argument) {
            complete = false;
            break;
          }
          argumentsList.push(
            source.slice(argument.start + 1, argument.end - 1)
          );
          macroEnd = argument.end;
        }
        if (!complete) {
          appendBufferedText(command, index, index + command.length);
          index += command.length;
          continue;
        }
        const placeholder = "\uE001";
        const expansion = macro
          .replace(/##/g, placeholder)
          .replace(/#([1-9])/g, (_match, number) => (
            argumentsList[Number(number) - 1] ?? ""
          ))
          .replaceAll(placeholder, "#");
        flushText();
        const expansionContainer = document.createElement("span");
        if (sourceOffset !== null) {
          expansionContainer.smarttexSourceRange = {
            start: sourceOffset + index,
            end: sourceOffset + macroEnd
          };
        }
        appendText(expansionContainer, expansion, {
          ...options,
          sourceOffset: undefined,
          macroDepth: (options.macroDepth || 0) + 1
        });
        parent.appendChild(expansionContainer);
        index = macroEnd;
        continue;
      }

      if (["protect", "relax", "leavevmode"].includes(commandName)) {
        index += command.length;
        continue;
      }
      if (group) {
        flushText();
        appendText(
          parent,
          source.slice(group.start + 1, group.end - 1),
          {
            ...options,
            highlightColor,
            sourceOffset: sourceOffset === null
              ? undefined
              : sourceOffset + group.start + 1
          }
        );
        index = group.end;
        continue;
      }

      appendBufferedText(command, index, index + command.length);
      index += command.length;
    }
    flushText();
  }

  function findClosingMath(source, start, closing) {
    for (let index = start; index < source.length; index += 1) {
      if (!isEscaped(source, index) && source.startsWith(closing, index)) {
        return index;
      }
    }
    return -1;
  }

  function appendMathContent(parent, sourceValue, options) {
    const source = String(sourceValue || "");
    const mathSource = source
      .replaceAll(OPERATOR_CARET_MARKER, "\\SmartTeXOperatorCaret{}")
      .replaceAll(CARET_MARKER, "\\SmartTeXCaret{}");
    const math = parent.ownerDocument.createElement("span");
    math.className = "smarttex-table-inline-math";
    if (
      Number.isFinite(Number(options.sourceStart)) &&
      Number.isFinite(Number(options.sourceEnd))
    ) {
      math.smarttexSourceRange = {
        start: Number(options.sourceStart),
        end: Number(options.sourceEnd)
      };
    }
    try {
      options.katex.render(mathSource, math, {
        displayMode: false,
        throwOnError: true,
        strict: "ignore",
        trust: options.trust,
        maxExpand: 1000,
        maxSize: 25,
        macros: options.macros
      });
    } catch (_error) {
      appendText(math, source, options);
    }
    parent.appendChild(math);
  }

  function appendMixedContent(parent, sourceValue, options) {
    const source = String(sourceValue || "");
    const sourceOffset = Number.isFinite(Number(options.sourceOffset))
      ? Number(options.sourceOffset)
      : null;
    let index = 0;
    let textStart = 0;
    while (index < source.length) {
      let opening = "";
      let closing = "";
      if (source.startsWith("\\(", index)) {
        opening = "\\(";
        closing = "\\)";
      } else if (source[index] === "$" && !isEscaped(source, index)) {
        opening = source.startsWith("$$", index) ? "$$" : "$";
        closing = opening;
      }
      if (!opening) {
        index += 1;
        continue;
      }
      const mathEnd = findClosingMath(source, index + opening.length, closing);
      if (mathEnd < 0) {
        index += opening.length;
        continue;
      }
      appendText(parent, source.slice(textStart, index), {
        ...options,
        sourceOffset: sourceOffset === null
          ? undefined
          : sourceOffset + textStart
      });
      appendMathContent(
        parent,
        source.slice(index + opening.length, mathEnd),
        {
          ...options,
          sourceOffset: undefined,
          sourceStart: sourceOffset === null
            ? undefined
            : sourceOffset + index,
          sourceEnd: sourceOffset === null
            ? undefined
            : sourceOffset + mathEnd + closing.length
        }
      );
      index = mathEnd + closing.length;
      textStart = index;
    }
    appendText(parent, source.slice(textStart), {
      ...options,
      sourceOffset: sourceOffset === null
        ? undefined
        : sourceOffset + textStart
    });
  }

  function renderInlineLatex(sourceValue, options) {
    const container = options.document.createElement("span");
    container.className = "smarttex-inline-latex";
    appendMixedContent(container, sourceValue, options);
    return container;
  }

  function horizontalBoundaryCount(boundary, firstColumn, lastColumn) {
    const full = Math.max(0, Math.min(2, Number(boundary?.full) || 0));
    if (full) return full;
    let count = 0;
    for (let column = firstColumn; column < lastColumn; column += 1) {
      count = Math.max(count, Math.max(0, Math.min(
        2,
        Number(boundary?.partial?.get?.(column)) || 0
      )));
    }
    return count;
  }

  function addBorderClass(cell, side, count) {
    if (!count) return;
    cell.classList.add(`smarttex-table-border-${side}`);
    if (count >= 2) cell.classList.add(`smarttex-table-border-${side}-double`);
  }

  function renderTable(context, options) {
    const source = String(context.source || "");
    const caretOffset = options.includeCaret === false
      ? null
      : Math.max(0, Math.min(
        Number(context.cursorOffset) || 0,
        source.length
      ));
    const model = parseTable(source, context.columnSpec);
    if (!model.rows.length) throw new Error("The table does not contain a row yet.");

    const document = options.document;
    const wrapper = document.createElement("div");
    wrapper.className = "smarttex-table-scroll";
    const table = document.createElement("table");
    table.className = "smarttex-table-preview";
    const body = document.createElement("tbody");
    table.appendChild(body);
    wrapper.appendChild(table);

    for (const rowModel of model.rows) {
      const row = document.createElement("tr");
      let descriptorColumn = 0;
      const descriptors = rowModel.cells.map((cellModel) => {
        const overrideColumns = parseColumnSpec(cellModel.columnSpec);
        const firstColumn = descriptorColumn;
        const lastColumn = descriptorColumn + cellModel.colspan - 1;
        const column = overrideColumns[0] || model.columns[firstColumn] || {
          align: "left",
          leftBorder: 0,
          rightBorder: 0
        };
        descriptorColumn += cellModel.colspan;
        return {
          cellModel,
          overrideColumns,
          hasOverride: Boolean(String(cellModel.columnSpec || "").trim()),
          column,
          firstColumn,
          lastColumn
        };
      });

      for (let descriptorIndex = 0; descriptorIndex < descriptors.length; descriptorIndex += 1) {
        const descriptor = descriptors[descriptorIndex];
        const { cellModel, column, firstColumn, lastColumn } = descriptor;
        const cell = document.createElement("td");
        cell.classList.add(`smarttex-table-align-${column.align}`);

        if (descriptorIndex === 0) {
          addBorderClass(
            cell,
            "left",
            descriptor.hasOverride
              ? Number(column.leftBorder) || 0
              : Number(model.columns[firstColumn]?.leftBorder) || 0
          );
        }

        const nextDescriptor = descriptors[descriptorIndex + 1];
        const baseLastColumn = model.columns[lastColumn];
        const currentRight = descriptor.hasOverride
          ? Number(column.rightBorder) || 0
          : Number(baseLastColumn?.rightBorder) || 0;
        const nextLeft = nextDescriptor
          ? (nextDescriptor.hasOverride
            ? Number(nextDescriptor.column?.leftBorder) || 0
            : Number(model.columns[nextDescriptor.firstColumn]?.leftBorder) || 0)
          : 0;
        addBorderClass(cell, "right", Math.max(currentRight, nextLeft));
        addBorderClass(
          cell,
          "top",
          horizontalBoundaryCount(rowModel.ruleBefore, firstColumn, lastColumn + 1)
        );
        addBorderClass(
          cell,
          "bottom",
          horizontalBoundaryCount(rowModel.ruleAfter, firstColumn, lastColumn + 1)
        );
        if (cellModel.colspan > 1) cell.colSpan = cellModel.colspan;
        let visibleContent = cellModel.content;
        if (caretOffset !== null && (
          caretOffset >= cellModel.sourceStart &&
          caretOffset <= cellModel.sourceEnd
        )) {
          let localCaret;
          let operatorCaret = false;
          if (caretOffset <= cellModel.contentStart) localCaret = 0;
          else if (caretOffset >= cellModel.contentEnd) localCaret = visibleContent.length;
          else localCaret = caretOffset - cellModel.contentStart;
          if (cellModel.colspan > 1 || String(cellModel.columnSpec || "").trim()) {
            operatorCaret = (
              caretOffset < cellModel.contentStart ||
              caretOffset >= cellModel.contentEnd
            );
          }
          if (!operatorCaret && caretOffset >= cellModel.contentStart && caretOffset <= cellModel.contentEnd) {
            operatorCaret = Boolean(
              options.contextTools.cursorInsideControlSequence?.(
                visibleContent,
                localCaret
              ) ||
              options.contextTools.cursorAtProtectedAtomBoundary?.(
                visibleContent,
                localCaret
              )
            );
          }
          localCaret = options.contextTools.commandAwareCaretOffset(
            visibleContent,
            localCaret,
            options.commandSide
          );
          visibleContent = (
            visibleContent.slice(0, localCaret) +
            (operatorCaret ? OPERATOR_CARET_MARKER : CARET_MARKER) +
            visibleContent.slice(localCaret)
          );
        }
        const contentOptions = {
          ...options,
          sourceOffset: Number.isFinite(Number(options.sourceOffset))
            ? Number(options.sourceOffset) + cellModel.contentStart
            : undefined
        };
        if (context.environment === "array") {
          appendMathContent(cell, visibleContent, contentOptions);
        } else {
          appendMixedContent(cell, visibleContent, contentOptions);
        }
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
    return wrapper;
  }

  global.SmartTeXTableRenderer = Object.freeze({
    CARET_MARKER,
    OPERATOR_CARET_MARKER,
    splitTableSource,
    splitTableSourceDetailed,
    parseColumnSpec,
    parseTable,
    renderInlineLatex,
    renderTable
  });
})(globalThis);
