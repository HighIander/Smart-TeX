/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

((global) => {
  "use strict";

  const CARET_MARKER = "\uE001";
  const RULE_COMMAND = /^\\(?:hline|toprule|midrule|bottomrule)\b\s*/;

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

  function stripLeadingRules(value) {
    let source = String(value || "").trimStart();
    let rule = false;
    let changed = true;
    while (changed) {
      changed = false;
      const simple = source.match(RULE_COMMAND);
      if (simple) {
        source = source.slice(simple[0].length).trimStart();
        rule = true;
        changed = true;
        continue;
      }
      const partial = source.match(/^\\c?midrule(?:\([^)]*\))?\s*\{[^{}]*\}\s*/);
      const cline = source.match(/^\\cline\s*\{[^{}]*\}\s*/);
      const match = partial || cline;
      if (match) {
        source = source.slice(match[0].length).trimStart();
        rule = true;
        changed = true;
      }
    }
    return { source, rule };
  }

  function parseColumnSpec(specValue) {
    const spec = String(specValue || "");
    const columns = [];
    let pendingLeftBorder = false;

    const appendSpec = (value) => {
      for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (/\s/.test(character)) continue;
        if (character === "|") {
          if (columns.length) columns[columns.length - 1].rightBorder = true;
          pendingLeftBorder = true;
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
            rightBorder: false
          });
          pendingLeftBorder = false;
          if (width) index = width.end - 1;
          continue;
        }
        if (/^[lcrXS]$/.test(character)) {
          columns.push({
            align: character === "r" || character === "S"
              ? "right"
              : character === "c"
                ? "center"
                : "left",
            leftBorder: pendingLeftBorder,
            rightBorder: false
          });
          pendingLeftBorder = false;
        }
      }
    };
    appendSpec(spec);
    if (pendingLeftBorder && columns.length) {
      columns[columns.length - 1].rightBorder = true;
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
      content: source.slice(content.start + 1, content.end - 1)
    };
  }

  function parseTable(sourceValue, columnSpecValue = "") {
    const rawRows = splitTableSource(sourceValue);
    const rows = [];
    let pendingRule = false;

    for (const rawCells of rawRows) {
      const first = stripLeadingRules(rawCells[0] || "");
      rawCells[0] = first.source;
      const hasContent = rawCells.some((cell) => cell.trim());
      if (!hasContent) {
        if (first.rule && rows.length) rows[rows.length - 1].ruleAfter = true;
        else pendingRule ||= first.rule;
        continue;
      }
      const cells = rawCells.map((raw) => {
        const multicolumn = parseMulticolumn(raw);
        return multicolumn || {
          colspan: 1,
          columnSpec: "",
          content: raw.trim()
        };
      });
      rows.push({
        cells,
        ruleBefore: pendingRule || first.rule,
        ruleAfter: false
      });
      pendingRule = false;
    }
    if (pendingRule && rows.length) rows[rows.length - 1].ruleAfter = true;
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
      if (source[index] === CARET_MARKER) {
        flushText();
        const caret = document.createElement("span");
        caret.className = "smarttex-table-rendered-caret";
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
    const mathSource = source.replaceAll(CARET_MARKER, "\\SmartTeXCaret{}");
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

  function renderTable(context, options) {
    const source = String(context.source || "");
    const caretOffset = options.includeCaret === false
      ? null
      : options.contextTools.commandAwareCaretOffset(
        source,
        context.cursorOffset,
        options.commandSide
      );
    const sourceWithCaret = caretOffset === null
      ? source
      : (
        source.slice(0, caretOffset) +
        CARET_MARKER +
        source.slice(caretOffset)
      );
    const model = parseTable(sourceWithCaret, context.columnSpec);
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
      if (rowModel.ruleBefore) row.classList.add("smarttex-table-rule-before");
      if (rowModel.ruleAfter) row.classList.add("smarttex-table-rule-after");
      let columnIndex = 0;
      for (const cellModel of rowModel.cells) {
        const cell = document.createElement("td");
        const overrideColumns = parseColumnSpec(cellModel.columnSpec);
        const column = overrideColumns[0] || model.columns[columnIndex] || {
          align: "left",
          leftBorder: false,
          rightBorder: false
        };
        cell.classList.add(`smarttex-table-align-${column.align}`);
        if (column.leftBorder) cell.classList.add("smarttex-table-border-left");
        const lastCoveredColumn = columnIndex + cellModel.colspan - 1;
        const lastColumn = model.columns[lastCoveredColumn];
        if (column.rightBorder || lastColumn?.rightBorder) {
          cell.classList.add("smarttex-table-border-right");
        }
        if (cellModel.colspan > 1) cell.colSpan = cellModel.colspan;
        if (context.environment === "array") {
          appendMathContent(cell, cellModel.content, options);
        } else {
          appendMixedContent(cell, cellModel.content, options);
        }
        row.appendChild(cell);
        columnIndex += cellModel.colspan;
      }
      body.appendChild(row);
    }
    return wrapper;
  }

  global.SmartTeXTableRenderer = Object.freeze({
    CARET_MARKER,
    splitTableSource,
    parseColumnSpec,
    parseTable,
    renderInlineLatex,
    renderTable
  });
})(globalThis);
