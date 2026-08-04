/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

((global) => {
  "use strict";

  const contextTools = global.SmartTeXLatexContext;

  function isEscaped(source, index) {
    let count = 0;
    for (let position = index - 1; position >= 0 && source[position] === "\\"; position -= 1) {
      count += 1;
    }
    return count % 2 === 1;
  }

  function skipWhitespace(source, index) {
    let position = index;
    while (position < source.length && /\s/.test(source[position])) position += 1;
    return position;
  }

  function readBalanced(source, start, opening = "{", closing = "}") {
    if (source[start] !== opening) return null;
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "\\" && !/[A-Za-z@]/.test(source[index + 1] || "")) {
        index += 1;
        continue;
      }
      if (source[index] === opening) depth += 1;
      if (source[index] !== closing) continue;
      depth -= 1;
      if (depth === 0) {
        return {
          start,
          end: index + 1,
          contentStart: start + 1,
          contentEnd: index
        };
      }
    }
    return null;
  }

  function environmentHeader(source, context) {
    const beginMatch = source.slice(context.openStart).match(/^\\begin\s*\{([^{}\r\n]+)\}/);
    if (!beginMatch) return null;
    const environment = beginMatch[1].trim();
    let position = context.openStart + beginMatch[0].length;
    const takeGroup = (opening = "{", closing = "}") => {
      position = skipWhitespace(source, position);
      const group = readBalanced(source, position, opening, closing);
      if (group) position = group.end;
      return group;
    };
    const takeOptional = () => {
      const saved = position;
      const group = takeGroup("[", "]");
      if (!group) position = saved;
      return group;
    };

    let spec = null;
    if (environment === "tabular*") {
      if (!takeGroup()) return null;
      takeOptional();
      spec = takeGroup();
    } else if (environment === "tabularx") {
      if (!takeGroup()) return null;
      spec = takeGroup();
    } else {
      takeOptional();
      spec = takeGroup();
    }
    if (!spec) return null;
    return {
      environment,
      specStart: spec.contentStart,
      specEnd: spec.contentEnd,
      contentStart: context.contentStart
    };
  }

  function emptyBoundary() {
    return {
      full: 0,
      partial: new Map(),
      other: []
    };
  }

  function cloneBoundary(boundary) {
    return {
      full: Number(boundary?.full) || 0,
      partial: new Map(boundary?.partial || []),
      other: [...(boundary?.other || [])]
    };
  }

  function mergeBoundary(left, right) {
    const merged = emptyBoundary();
    merged.full = Math.max(Number(left?.full) || 0, Number(right?.full) || 0);
    for (const [column, count] of left?.partial || []) {
      merged.partial.set(column, Math.max(merged.partial.get(column) || 0, count));
    }
    for (const [column, count] of right?.partial || []) {
      merged.partial.set(column, Math.max(merged.partial.get(column) || 0, count));
    }
    merged.other = [...(left?.other || []), ...(right?.other || [])];
    return merged;
  }

  function ruleTokenAt(source, start) {
    const slice = source.slice(start);
    const simple = slice.match(/^\\(hline|toprule|midrule|bottomrule)\b\s*/);
    if (simple) {
      return {
        raw: simple[0],
        end: start + simple[0].length,
        type: simple[1] === "hline" ? "full" : "other"
      };
    }
    const cline = slice.match(/^\\cline\s*\{\s*(\d+)\s*-\s*(\d+)\s*\}\s*/);
    if (cline) {
      return {
        raw: cline[0],
        end: start + cline[0].length,
        type: "partial",
        first: Math.max(1, Number(cline[1]) || 1),
        last: Math.max(1, Number(cline[2]) || 1)
      };
    }
    const cmidrule = slice.match(/^\\cmidrule(?:\([^)]*\))?\s*\{\s*(\d+)\s*-\s*(\d+)\s*\}\s*/);
    if (cmidrule) {
      return {
        raw: cmidrule[0],
        end: start + cmidrule[0].length,
        type: "other"
      };
    }
    return null;
  }

  function consumeLeadingRules(source) {
    let position = 0;
    const boundary = emptyBoundary();
    while (position < source.length) {
      const whitespace = source.slice(position).match(/^\s*/)?.[0] || "";
      position += whitespace.length;
      const token = ruleTokenAt(source, position);
      if (!token) {
        position -= whitespace.length;
        break;
      }
      position = token.end;
      if (token.type === "full") {
        boundary.full = Math.min(2, boundary.full + 1);
      } else if (token.type === "partial") {
        for (let column = token.first - 1; column <= token.last - 1; column += 1) {
          boundary.partial.set(
            column,
            Math.min(2, (boundary.partial.get(column) || 0) + 1)
          );
        }
      } else {
        boundary.other.push(token.raw.trim());
      }
    }
    return {
      boundary,
      rest: source.slice(position),
      consumed: position
    };
  }

  function rowChunks(body) {
    const chunks = [];
    let chunkStart = 0;
    let cellStart = 0;
    let braces = 0;
    let mathDelimiter = "";
    let comment = false;
    let cells = [];

    const finishCell = (end) => {
      cells.push({
        raw: body.slice(cellStart, end),
        start: cellStart,
        end
      });
    };
    const finishRow = (end, terminatorEnd) => {
      finishCell(end);
      chunks.push({
        start: chunkStart,
        end,
        terminatorEnd,
        raw: body.slice(chunkStart, end),
        cells
      });
      chunkStart = terminatorEnd;
      cellStart = terminatorEnd;
      cells = [];
    };

    for (let index = 0; index < body.length; index += 1) {
      const character = body[index];
      if (comment) {
        if (character === "\n" || character === "\r") comment = false;
        continue;
      }
      if (!mathDelimiter && character === "%" && !isEscaped(body, index)) {
        comment = true;
        continue;
      }
      if (character === "\\") {
        if (!mathDelimiter && body.startsWith("\\(", index)) {
          mathDelimiter = "\\)";
          index += 1;
          continue;
        }
        if (mathDelimiter === "\\)" && body.startsWith("\\)", index)) {
          mathDelimiter = "";
          index += 1;
          continue;
        }
      }
      if (character === "$" && !isEscaped(body, index) && mathDelimiter !== "\\)") {
        const delimiter = body.startsWith("$$", index) ? "$$" : "$";
        if (!mathDelimiter) mathDelimiter = delimiter;
        else if (mathDelimiter === delimiter) mathDelimiter = "";
        if (delimiter === "$$") index += 1;
        continue;
      }
      if (!mathDelimiter) {
        if (character === "{" && !isEscaped(body, index)) braces += 1;
        if (character === "}" && !isEscaped(body, index)) braces = Math.max(0, braces - 1);
      }
      if (mathDelimiter || braces > 0) continue;

      if (character === "&" && !isEscaped(body, index)) {
        finishCell(index);
        cellStart = index + 1;
        continue;
      }

      let terminatorEnd = -1;
      if (body.startsWith("\\tabularnewline", index)) {
        terminatorEnd = index + "\\tabularnewline".length;
      } else if (body.startsWith("\\\\", index)) {
        terminatorEnd = index + 2;
        let position = skipWhitespace(body, terminatorEnd);
        if (body[position] === "*") position = skipWhitespace(body, position + 1);
        if (body[position] === "[") {
          const spacing = readBalanced(body, position, "[", "]");
          if (spacing) position = spacing.end;
        }
        terminatorEnd = position;
      }
      if (terminatorEnd < 0) continue;
      finishRow(index, terminatorEnd);
      index = terminatorEnd - 1;
    }
    if (chunkStart < body.length || !chunks.length) finishRow(body.length, body.length);
    return chunks;
  }

  function multicolumnInfo(rawValue) {
    const raw = String(rawValue || "");
    const leading = raw.match(/^\s*/)?.[0].length || 0;
    const start = leading;
    if (!raw.startsWith("\\multicolumn", start)) return null;
    let position = skipWhitespace(raw, start + "\\multicolumn".length);
    const countGroup = readBalanced(raw, position);
    if (!countGroup) return null;
    position = skipWhitespace(raw, countGroup.end);
    const specGroup = readBalanced(raw, position);
    if (!specGroup) return null;
    position = skipWhitespace(raw, specGroup.end);
    const contentGroup = readBalanced(raw, position);
    if (!contentGroup || raw.slice(contentGroup.end).trim()) return null;
    const count = Math.max(
      1,
      Math.min(100, Number.parseInt(raw.slice(countGroup.contentStart, countGroup.contentEnd), 10) || 1)
    );
    return {
      count,
      countStart: countGroup.contentStart,
      countEnd: countGroup.contentEnd,
      specStart: specGroup.contentStart,
      specEnd: specGroup.contentEnd,
      spec: raw.slice(specGroup.contentStart, specGroup.contentEnd),
      contentStart: contentGroup.contentStart,
      contentEnd: contentGroup.contentEnd,
      content: raw.slice(contentGroup.contentStart, contentGroup.contentEnd)
    };
  }

  function setMulticolumnCount(raw, count) {
    const info = multicolumnInfo(raw);
    if (!info) return raw;
    return raw.slice(0, info.countStart) + String(Math.max(1, count)) + raw.slice(info.countEnd);
  }

  function parseBody(bodyValue, columnCount) {
    const body = String(bodyValue || "");
    const chunks = rowChunks(body);
    const rows = [];
    const boundaries = [emptyBoundary()];
    let pending = emptyBoundary();

    for (const chunk of chunks) {
      const leading = consumeLeadingRules(chunk.raw);
      pending = mergeBoundary(pending, leading.boundary);
      const adjustedCells = chunk.cells.map((cell, index) => {
        if (index !== 0) return { ...cell };
        return {
          ...cell,
          raw: cell.raw.slice(leading.consumed),
          start: cell.start + leading.consumed
        };
      });
      const hasContent = adjustedCells.some((cell) => cell.raw.trim());
      const hasExplicitRowTerminator = chunk.terminatorEnd > chunk.end;
      if (!hasContent && !hasExplicitRowTerminator) continue;

      boundaries[rows.length] = mergeBoundary(boundaries[rows.length], pending);
      pending = emptyBoundary();
      let logicalColumn = 0;
      const cells = adjustedCells.map((cell) => {
        const multicolumn = multicolumnInfo(cell.raw);
        const span = multicolumn?.count || 1;
        const parsed = {
          ...cell,
          span,
          logicalStart: logicalColumn,
          logicalEnd: logicalColumn + span,
          multicolumn
        };
        logicalColumn += span;
        return parsed;
      });
      while (logicalColumn < columnCount) {
        cells.push({
          raw: "",
          start: chunk.end,
          end: chunk.end,
          span: 1,
          logicalStart: logicalColumn,
          logicalEnd: logicalColumn + 1,
          multicolumn: null
        });
        logicalColumn += 1;
      }
      rows.push({
        cells,
        sourceStart: chunk.start + leading.consumed,
        sourceEnd: chunk.end
      });
      boundaries.push(emptyBoundary());
    }
    boundaries[rows.length] = mergeBoundary(boundaries[rows.length], pending);

    if (!rows.length) {
      const cells = Array.from({ length: Math.max(1, columnCount) }, (_, index) => ({
        raw: "",
        start: 0,
        end: 0,
        span: 1,
        logicalStart: index,
        logicalEnd: index + 1,
        multicolumn: null
      }));
      rows.push({ cells, sourceStart: 0, sourceEnd: 0 });
      boundaries.push(emptyBoundary());
    }
    return { rows, boundaries };
  }

  function mergeSpecBoundary(left, right) {
    return {
      bars: Math.max(Number(left?.bars) || 0, Number(right?.bars) || 0),
      other: [left?.other || "", right?.other || ""].filter(Boolean).join("")
    };
  }

  function parseColumnSpec(specValue) {
    const spec = String(specValue || "");
    const columns = [];
    const boundaries = [{ bars: 0, other: "" }];
    let prefix = "";

    const appendExpanded = (value) => {
      const nested = parseColumnSpec(value);
      if (!nested.columns.length) return;
      boundaries[boundaries.length - 1] = mergeSpecBoundary(
        boundaries[boundaries.length - 1],
        nested.boundaries[0]
      );
      nested.columns.forEach((column, index) => {
        columns.push(index === 0 ? prefix + column : column);
        prefix = "";
        boundaries.push({ ...nested.boundaries[index + 1] });
      });
    };

    for (let index = 0; index < spec.length; index += 1) {
      const character = spec[index];
      if (/\s/.test(character)) continue;
      if (character === "|") {
        const boundary = boundaries[boundaries.length - 1];
        boundary.bars = Math.min(2, boundary.bars + 1);
        continue;
      }
      if ([">", "<", "@", "!"].includes(character) && spec[index + 1] === "{") {
        const group = readBalanced(spec, index + 1);
        if (!group) {
          boundaries[boundaries.length - 1].other += character;
          continue;
        }
        const raw = spec.slice(index, group.end);
        if (character === ">") prefix += raw;
        else if (character === "<" && columns.length) columns[columns.length - 1] += raw;
        else boundaries[boundaries.length - 1].other += raw;
        index = group.end - 1;
        continue;
      }
      if (character === "*" && spec[index + 1] === "{") {
        const countGroup = readBalanced(spec, index + 1);
        const repeatedStart = countGroup ? skipWhitespace(spec, countGroup.end) : -1;
        const repeatedGroup = repeatedStart >= 0 ? readBalanced(spec, repeatedStart) : null;
        if (countGroup && repeatedGroup) {
          const count = Math.max(
            0,
            Math.min(100, Number.parseInt(
              spec.slice(countGroup.contentStart, countGroup.contentEnd),
              10
            ) || 0)
          );
          const repeated = spec.slice(repeatedGroup.contentStart, repeatedGroup.contentEnd);
          for (let repeat = 0; repeat < count; repeat += 1) appendExpanded(repeated);
          index = repeatedGroup.end - 1;
          continue;
        }
      }

      let rawColumn = "";
      if (["p", "m", "b"].includes(character) && spec[index + 1] === "{") {
        const group = readBalanced(spec, index + 1);
        rawColumn = group ? spec.slice(index, group.end) : character;
        if (group) index = group.end - 1;
      } else if (character === "D") {
        let end = index + 1;
        for (let argument = 0; argument < 3; argument += 1) {
          const groupStart = skipWhitespace(spec, end);
          const group = readBalanced(spec, groupStart);
          if (!group) break;
          end = group.end;
        }
        rawColumn = spec.slice(index, end);
        index = end - 1;
      } else if (character === "S") {
        let end = index + 1;
        const optionalStart = skipWhitespace(spec, end);
        const optional = readBalanced(spec, optionalStart, "[", "]");
        if (optional) end = optional.end;
        rawColumn = spec.slice(index, end);
        index = end - 1;
      } else if (/[A-Za-z]/.test(character)) {
        // User-defined column types are commonly represented by a single
        // letter. Treat them as columns rather than discarding the spec.
        rawColumn = character;
      }
      if (rawColumn) {
        columns.push(prefix + rawColumn);
        prefix = "";
        boundaries.push({ bars: 0, other: "" });
        continue;
      }
      boundaries[boundaries.length - 1].other += prefix + character;
      prefix = "";
    }
    if (prefix) boundaries[boundaries.length - 1].other += prefix;
    if (!columns.length) {
      columns.push("c");
      boundaries.push({ bars: 0, other: "" });
    }
    return { columns, boundaries };
  }

  function serializeColumnSpec(model) {
    let result = "";
    for (let index = 0; index < model.columns.length; index += 1) {
      const boundary = model.boundaries[index] || { bars: 0, other: "" };
      result += "|".repeat(Math.max(0, Math.min(2, boundary.bars || 0)));
      result += boundary.other || "";
      result += model.columns[index] || "c";
    }
    const finalBoundary = model.boundaries[model.columns.length] || { bars: 0, other: "" };
    result += "|".repeat(Math.max(0, Math.min(2, finalBoundary.bars || 0)));
    result += finalBoundary.other || "";
    return result;
  }

  function serializeBoundary(boundary, columnCount, indent) {
    const lines = [];
    for (const command of boundary.other || []) {
      if (command) lines.push(`${indent}${command}`);
    }
    const full = Math.max(0, Math.min(2, Number(boundary.full) || 0));
    for (let repeat = 0; repeat < full; repeat += 1) lines.push(`${indent}\\hline`);
    if (!full) {
      const counts = Array.from({ length: columnCount }, (_, index) => (
        Math.max(0, Math.min(2, Number(boundary.partial.get(index)) || 0))
      ));
      for (let layer = 1; layer <= 2; layer += 1) {
        let start = -1;
        for (let index = 0; index <= columnCount; index += 1) {
          const covered = index < columnCount && counts[index] >= layer;
          if (covered && start < 0) start = index;
          if (!covered && start >= 0) {
            lines.push(`${indent}\\cline{${start + 1}-${index}}`);
            start = -1;
          }
        }
      }
    }
    return lines;
  }

  function rowCellsByLogicalColumn(row, columnCount) {
    const values = Array.from({ length: columnCount }, () => null);
    row.cells.forEach((cell) => {
      for (
        let column = cell.logicalStart;
        column < Math.min(columnCount, cell.logicalEnd);
        column += 1
      ) values[column] = cell;
    });
    return values;
  }


  function trimmedCellContent(cell) {
    const raw = String(cell?.raw || "");
    const leading = raw.match(/^\s*/)?.[0] || "";
    const trailing = raw.match(/\s*$/)?.[0] || "";
    const contentEnd = Math.max(leading.length, raw.length - trailing.length);
    return raw.slice(leading.length, contentEnd);
  }

  function alignedColumnWidths(model) {
    const widths = Array.from({ length: model.columnCount }, () => 1);
    const spanning = [];
    for (const row of model.rows) {
      for (const cell of row.cells) {
        const contentLength = trimmedCellContent(cell).length;
        if ((cell.span || 1) === 1) {
          widths[cell.logicalStart] = Math.max(widths[cell.logicalStart] || 1, contentLength);
        } else {
          spanning.push({ cell, contentLength });
        }
      }
    }
    for (const { cell, contentLength } of spanning) {
      const first = Math.max(0, cell.logicalStart);
      const last = Math.min(model.columnCount, cell.logicalEnd);
      const available = widths.slice(first, last).reduce((sum, width) => sum + width, 0) +
        Math.max(0, last - first - 1) * 3;
      if (contentLength > available && last > first) {
        widths[last - 1] += contentLength - available;
      }
    }
    return widths;
  }

  function alignedCellWidth(cell, widths) {
    const first = Math.max(0, Number(cell?.logicalStart) || 0);
    const last = Math.max(first + 1, Math.min(
      widths.length,
      Number(cell?.logicalEnd) || first + 1
    ));
    return widths.slice(first, last).reduce((sum, width) => sum + width, 0) +
      Math.max(0, last - first - 1) * 3;
  }

  function serializeBody(model) {
    const indent = model.indent || "  ";
    const lines = [];
    const cellPositions = [];
    const widths = alignedColumnWidths(model);
    const rowModels = model.rows.map((row) => {
      let rowText = indent;
      const positions = [];
      row.cells.forEach((cell, cellIndex) => {
        if (cellIndex) rowText += " & ";
        const content = trimmedCellContent(cell);
        const start = rowText.length;
        rowText += content;
        positions.push({
          relativeStart: start,
          relativeEnd: start + content.length,
          logicalStart: cell.logicalStart,
          logicalEnd: cell.logicalEnd
        });
        rowText = rowText.padEnd(
          start + Math.max(content.length, alignedCellWidth(cell, widths)),
          " "
        );
      });
      return { rowText, positions };
    });
    const rowWidth = rowModels.reduce(
      (maximum, row) => Math.max(maximum, row.rowText.length),
      0
    );
    let offset = 1;

    for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex += 1) {
      const boundaryLines = serializeBoundary(
        model.boundaries[rowIndex] || emptyBoundary(),
        model.columnCount,
        indent
      );
      for (const line of boundaryLines) {
        lines.push(line);
        offset += line.length + 1;
      }

      const rowModel = rowModels[rowIndex];
      const rowLineStart = offset;
      const rowText = `${rowModel.rowText.padEnd(rowWidth, " ")} \\\\`;
      lines.push(rowText);
      cellPositions.push(rowModel.positions.map((position) => ({
        start: rowLineStart + position.relativeStart,
        end: rowLineStart + position.relativeEnd,
        logicalStart: position.logicalStart,
        logicalEnd: position.logicalEnd
      })));
      offset += rowText.length + 1;
    }

    const trailingLines = serializeBoundary(
      model.boundaries[model.rows.length] || emptyBoundary(),
      model.columnCount,
      indent
    );
    for (const line of trailingLines) {
      lines.push(line);
      offset += line.length + 1;
    }
    return {
      body: `\n${lines.join("\n")}\n`,
      cellPositions
    };
  }

  function indentationFromBody(body) {
    const match = String(body || "").match(/(?:^|\n)([ \t]+)\S/);
    return match?.[1] || "  ";
  }

  function stableTableIndent(sourceValue, openStartValue, bodyValue) {
    const source = String(sourceValue || "");
    const openStart = Math.max(0, Math.min(Number(openStartValue) || 0, source.length));
    const lineStart = source.lastIndexOf("\n", Math.max(0, openStart - 1)) + 1;
    const beforeBegin = source.slice(lineStart, openStart);

    // Use the indentation of the \begin{tabular...} line as the canonical
    // table indentation. Unlike whitespace inside the body, this prefix is
    // outside the replaced range and therefore cannot grow after repeated
    // formatting or border operations.
    if (/^[ \t]*$/.test(beforeBegin)) return beforeBegin;
    return indentationFromBody(bodyValue);
  }

  function currentCell(model, cursorRelative) {
    let rowIndex = 0;
    let cellIndex = 0;
    let found = false;
    let bestDistance = Infinity;
    model.rows.forEach((row, candidateRow) => {
      row.cells.forEach((cell, candidateCell) => {
        if (cursorRelative >= cell.start && cursorRelative <= cell.end) {
          rowIndex = candidateRow;
          cellIndex = candidateCell;
          found = true;
          return;
        }
        const distance = Math.min(
          Math.abs(cursorRelative - cell.start),
          Math.abs(cursorRelative - cell.end)
        );
        if (!found && distance < bestDistance) {
          bestDistance = distance;
          rowIndex = candidateRow;
          cellIndex = candidateCell;
        }
      });
    });
    const cell = model.rows[rowIndex]?.cells[cellIndex] || model.rows[0].cells[0];
    return {
      rowIndex,
      cellIndex,
      logicalColumn: Math.max(0, Math.min(model.columnCount - 1, cell.logicalStart || 0))
    };
  }

  function selectedCellRange(model, selectionStartValue, selectionEndValue) {
    const sourceLength = model.source.length;
    const start = Math.max(0, Math.min(
      Number.isFinite(Number(selectionStartValue)) ? Number(selectionStartValue) : model.cursor,
      sourceLength
    ));
    const end = Math.max(0, Math.min(
      Number.isFinite(Number(selectionEndValue)) ? Number(selectionEndValue) : start,
      sourceLength
    ));
    const anchor = currentCell(model, start - model.context.contentStart);
    const head = currentCell(model, end - model.context.contentStart);
    const anchorCell = model.rows[anchor.rowIndex]?.cells[anchor.cellIndex];
    const headCell = model.rows[head.rowIndex]?.cells[head.cellIndex];
    const rowStart = Math.min(anchor.rowIndex, head.rowIndex);
    const rowEnd = Math.max(anchor.rowIndex, head.rowIndex);
    const columnStart = Math.min(
      anchorCell?.logicalStart ?? anchor.logicalColumn,
      headCell?.logicalStart ?? head.logicalColumn
    );
    const columnEnd = Math.max(
      anchorCell?.logicalEnd ?? anchor.logicalColumn + 1,
      headCell?.logicalEnd ?? head.logicalColumn + 1
    );
    return {
      start: Math.min(start, end),
      end: Math.max(start, end),
      collapsed: start === end,
      rowStart,
      rowEnd,
      columnStart: Math.max(0, Math.min(model.columnCount - 1, columnStart)),
      columnEnd: Math.max(1, Math.min(model.columnCount, columnEnd))
    };
  }

  function analyze(sourceValue, cursorValue, selectionStartValue = cursorValue, selectionEndValue = selectionStartValue) {
    if (!contextTools?.findTableContext) return null;
    const source = String(sourceValue || "");
    const cursor = Math.max(0, Math.min(Number(cursorValue) || 0, source.length));
    const context = contextTools.findTableContext(source, cursor);
    if (!context) return null;
    const header = environmentHeader(source, context);
    if (!header) return null;
    const specModel = parseColumnSpec(source.slice(header.specStart, header.specEnd));
    const body = source.slice(context.contentStart, context.contentEnd);
    const parsed = parseBody(body, specModel.columns.length);
    const model = {
      source,
      cursor,
      context,
      header,
      specModel,
      rows: parsed.rows,
      boundaries: parsed.boundaries,
      columnCount: specModel.columns.length,
      indent: stableTableIndent(source, context.openStart, body)
    };
    model.current = currentCell(model, cursor - context.contentStart);
    model.selection = selectedCellRange(model, selectionStartValue, selectionEndValue);
    model.hasMulticolumn = model.rows.some((row) => row.cells.some((cell) => cell.span > 1));
    return model;
  }


  function normalizedSpecCore(value) {
    return String(value || "").replace(/\s+/g, "");
  }

  function simplifyRedundantMulticolumn(cell, model) {
    const info = multicolumnInfo(cell?.raw);
    if (!info || info.count !== 1) return false;
    const column = Math.max(0, Math.min(
      model.columnCount - 1,
      Number(cell.logicalStart) || 0
    ));
    const local = splitCellColumnSpec(info.spec);
    const base = splitCellColumnSpec(model.specModel.columns[column] || "c");
    const leftBoundary = model.specModel.boundaries[column]?.bars || 0;
    const rightBoundary = model.specModel.boundaries[column + 1]?.bars || 0;
    if (
      local.left ||
      local.right ||
      leftBoundary ||
      rightBoundary ||
      normalizedSpecCore(local.core) !== normalizedSpecCore(base.core)
    ) return false;
    const leading = cell.raw.match(/^\s*/)?.[0] || "";
    const trailing = cell.raw.match(/\s*$/)?.[0] || "";
    cell.raw = `${leading}${info.content}${trailing}`;
    cell.multicolumn = null;
    cell.span = 1;
    return true;
  }

  function normalizeRows(model) {
    const assignLogicalColumns = (row) => {
      let logicalColumn = 0;
      row.cells.forEach((cell) => {
        cell.multicolumn = multicolumnInfo(cell.raw);
        cell.span = cell.multicolumn?.count || 1;
        cell.logicalStart = logicalColumn;
        cell.logicalEnd = logicalColumn + cell.span;
        logicalColumn += cell.span;
      });
      while (logicalColumn < model.columnCount) {
        row.cells.push({
          raw: "",
          span: 1,
          logicalStart: logicalColumn,
          logicalEnd: logicalColumn + 1,
          multicolumn: null
        });
        logicalColumn += 1;
      }
    };
    model.rows.forEach(assignLogicalColumns);
    model.rows.forEach((row) => {
      let changed = false;
      row.cells.forEach((cell) => {
        changed = simplifyRedundantMulticolumn(cell, model) || changed;
      });
      if (changed) assignLogicalColumns(row);
    });
  }

  function resultFor(model, rowIndex, logicalColumn, selectionLength = 0) {
    normalizeRows(model);
    const spec = serializeColumnSpec(model.specModel);
    const serialized = serializeBody(model);
    const headerTail = model.source
      .slice(model.header.specEnd, model.context.contentStart)
      .replace(/\s*$/, "");
    const prefix = (
      model.source.slice(model.context.openStart, model.header.specStart) +
      spec +
      headerTail
    );
    const suffix = model.source.slice(model.context.contentEnd, model.context.closeEnd);
    // serializeBody ends directly after a newline. Reinsert the canonical
    // indentation before the closing environment so the complete table stays
    // aligned with its original \begin line after every edit.
    const replacement = prefix + serialized.body + model.indent + suffix;
    const row = Math.max(0, Math.min(rowIndex, model.rows.length - 1));
    const column = Math.max(0, Math.min(logicalColumn, model.columnCount - 1));
    const positions = serialized.cellPositions[row] || [];
    const position = positions.find((candidate) => (
      column >= candidate.logicalStart && column < candidate.logicalEnd
    )) || positions[0] || { start: 1, end: 1 };
    const selectionStart = model.context.openStart + prefix.length + position.start;
    const selectionEnd = Math.min(position.end, position.start + Math.max(0, selectionLength));
    return {
      start: model.context.openStart,
      end: model.context.closeEnd,
      text: replacement,
      selectionStart,
      selectionEnd: model.context.openStart + prefix.length + selectionEnd,
      focus: true
    };
  }

  function requireModel(source, cursor, selectionStart = cursor, selectionEnd = selectionStart) {
    const model = analyze(source, cursor, selectionStart, selectionEnd);
    if (!model) throw new Error("Place the cursor inside a tabular, tabularx, longtable, or array environment.");
    return model;
  }

  function addRow(source, cursor, direction, selectionStart = cursor, selectionEnd = selectionStart) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    const current = model.current.rowIndex;
    const insertion = direction === "above" ? current : current + 1;
    const cells = Array.from({ length: model.columnCount }, (_, index) => ({
      raw: "",
      span: 1,
      logicalStart: index,
      logicalEnd: index + 1,
      multicolumn: null
    }));
    model.rows.splice(insertion, 0, { cells });
    if (direction === "above") {
      model.boundaries.splice(insertion, 0, emptyBoundary());
    } else {
      model.boundaries.splice(insertion + 1, 0, emptyBoundary());
    }
    return resultFor(model, insertion, model.current.logicalColumn);
  }

  function removeRow(source, cursor, selectionStart = cursor, selectionEnd = selectionStart) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    if (model.rows.length <= 1) throw new Error("A table must contain at least one row.");
    const row = model.current.rowIndex;
    model.rows.splice(row, 1);
    const merged = mergeBoundary(model.boundaries[row], model.boundaries[row + 1]);
    model.boundaries.splice(row, 2, merged);
    return resultFor(
      model,
      Math.min(row, model.rows.length - 1),
      model.current.logicalColumn
    );
  }

  function moveRow(source, cursor, direction, selectionStart = cursor, selectionEnd = selectionStart) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    const row = model.current.rowIndex;
    const target = direction === "up" ? row - 1 : row + 1;
    if (target < 0 || target >= model.rows.length) return null;
    [model.rows[row], model.rows[target]] = [model.rows[target], model.rows[row]];
    [model.boundaries[row], model.boundaries[target]] = [
      model.boundaries[target],
      model.boundaries[row]
    ];
    return resultFor(model, target, model.current.logicalColumn);
  }

  function insertCellAtLogicalColumn(row, column) {
    for (let index = 0; index < row.cells.length; index += 1) {
      const cell = row.cells[index];
      if (column > cell.logicalStart && column < cell.logicalEnd && cell.span > 1) {
        cell.raw = setMulticolumnCount(cell.raw, cell.span + 1);
        return;
      }
      if (column <= cell.logicalStart) {
        row.cells.splice(index, 0, { raw: "", span: 1, multicolumn: null });
        return;
      }
    }
    row.cells.push({ raw: "", span: 1, multicolumn: null });
  }

  function insertPartialBoundaryColumn(boundary, insertion, oldColumnCount) {
    if (!boundary || boundary.full) return;
    const previous = new Map(boundary.partial || []);
    const shifted = new Map();
    for (const [column, count] of previous) {
      shifted.set(column >= insertion ? column + 1 : column, count);
    }
    let insertedCount = 0;
    for (let layer = 1; layer <= 2; layer += 1) {
      const fullLayer = Array.from({ length: oldColumnCount }, (_, column) => (
        (previous.get(column) || 0) >= layer
      )).every(Boolean);
      const insideSelectedRange = (
        insertion > 0 &&
        insertion < oldColumnCount &&
        (previous.get(insertion - 1) || 0) >= layer &&
        (previous.get(insertion) || 0) >= layer
      );
      if (fullLayer || insideSelectedRange) insertedCount = layer;
    }
    if (insertedCount) shifted.set(insertion, insertedCount);
    boundary.partial = shifted;
  }

  function addColumn(source, cursor, direction, selectionStart = cursor, selectionEnd = selectionStart) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    const insertion = direction === "left"
      ? model.current.logicalColumn
      : model.current.logicalColumn + 1;
    model.specModel.columns.splice(insertion, 0, "c");
    model.specModel.boundaries.splice(insertion + 1, 0, { bars: 0, other: "" });
    model.rows.forEach((row) => insertCellAtLogicalColumn(row, insertion));
    model.boundaries.forEach((boundary) => {
      insertPartialBoundaryColumn(boundary, insertion, model.columnCount);
    });
    model.columnCount += 1;
    return resultFor(model, model.current.rowIndex, insertion);
  }

  function removeLogicalColumn(row, column) {
    const index = row.cells.findIndex((cell) => (
      column >= cell.logicalStart && column < cell.logicalEnd
    ));
    if (index < 0) return;
    const cell = row.cells[index];
    if (cell.span > 1) {
      cell.raw = setMulticolumnCount(cell.raw, cell.span - 1);
    } else {
      row.cells.splice(index, 1);
    }
  }

  function removeColumn(source, cursor, selectionStart = cursor, selectionEnd = selectionStart) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    if (model.columnCount <= 1) throw new Error("A table must contain at least one column.");
    const column = model.current.logicalColumn;
    model.rows.forEach((row) => removeLogicalColumn(row, column));
    model.specModel.columns.splice(column, 1);
    const merged = mergeSpecBoundary(
      model.specModel.boundaries[column],
      model.specModel.boundaries[column + 1]
    );
    model.specModel.boundaries.splice(column, 2, merged);
    model.columnCount -= 1;
    for (const boundary of model.boundaries) {
      const adjusted = new Map();
      for (const [candidate, count] of boundary.partial) {
        if (candidate === column) continue;
        adjusted.set(candidate > column ? candidate - 1 : candidate, count);
      }
      boundary.partial = adjusted;
    }
    return resultFor(
      model,
      model.current.rowIndex,
      Math.min(column, model.columnCount - 1)
    );
  }

  function moveColumn(source, cursor, direction, selectionStart = cursor, selectionEnd = selectionStart) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    if (model.hasMulticolumn) {
      throw new Error("Columns cannot be moved while the table contains \\multicolumn cells.");
    }
    const column = model.current.logicalColumn;
    const target = direction === "left" ? column - 1 : column + 1;
    if (target < 0 || target >= model.columnCount) return null;
    [model.specModel.columns[column], model.specModel.columns[target]] = [
      model.specModel.columns[target],
      model.specModel.columns[column]
    ];
    model.rows.forEach((row) => {
      [row.cells[column], row.cells[target]] = [row.cells[target], row.cells[column]];
    });
    return resultFor(model, model.current.rowIndex, target);
  }

  function materializeFullBoundary(boundary, columnCount) {
    if (!boundary.full) return;
    const count = boundary.full;
    boundary.full = 0;
    for (let column = 0; column < columnCount; column += 1) {
      boundary.partial.set(column, count);
    }
  }

  function togglePartialBoundaryRange(boundary, firstColumn, lastColumn, count, columnCount) {
    materializeFullBoundary(boundary, columnCount);
    const allSet = Array.from(
      { length: Math.max(1, lastColumn - firstColumn) },
      (_item, offset) => (boundary.partial.get(firstColumn + offset) || 0) === count
    ).every(Boolean);
    for (let column = firstColumn; column < lastColumn; column += 1) {
      if (allSet) boundary.partial.delete(column);
      else boundary.partial.set(column, count);
    }
  }

  function setPartialBoundaryRange(
    boundary,
    firstColumn,
    lastColumn,
    count,
    columnCount,
    remove
  ) {
    materializeFullBoundary(boundary, columnCount);
    for (let column = firstColumn; column < lastColumn; column += 1) {
      if (remove) boundary.partial.delete(column);
      else boundary.partial.set(column, count);
    }
  }

  function toggleVerticalBoundary(specModel, boundaryIndex, count) {
    const boundary = specModel.boundaries[boundaryIndex];
    boundary.bars = boundary.bars === count ? 0 : count;
  }

  function splitCellColumnSpec(specValue) {
    const spec = String(specValue || "").trim() || "c";
    const leading = spec.match(/^\|{1,2}/)?.[0].length || 0;
    const trailing = spec.match(/\|{1,2}$/)?.[0].length || 0;
    const coreEnd = Math.max(leading, spec.length - trailing);
    return {
      left: Math.min(2, leading),
      right: Math.min(2, trailing),
      core: spec.slice(leading, coreEnd) || "c"
    };
  }

  function cellColumnSpec(cell, model) {
    if (cell?.multicolumn?.spec) return splitCellColumnSpec(cell.multicolumn.spec);
    const base = model.specModel.columns[cell?.logicalStart || 0] || "c";
    return splitCellColumnSpec(base);
  }

  function writeCellColumnSpec(cell, model, nextSpec) {
    const spec = `${"|".repeat(nextSpec.left)}${nextSpec.core || "c"}${"|".repeat(nextSpec.right)}`;
    const info = multicolumnInfo(cell.raw);
    if (info) {
      cell.raw = cell.raw.slice(0, info.specStart) + spec + cell.raw.slice(info.specEnd);
      cell.multicolumn = multicolumnInfo(cell.raw);
      return;
    }
    const leading = cell.raw.match(/^\s*/)?.[0] || "";
    const trailing = cell.raw.match(/\s*$/)?.[0] || "";
    const contentEnd = cell.raw.length - trailing.length;
    const content = cell.raw.slice(leading.length, contentEnd < leading.length ? undefined : contentEnd);
    const span = Math.max(1, Number(cell.span) || 1);
    cell.raw = `${leading}\\multicolumn{${span}}{${spec}}{${content}}${trailing}`;
    cell.multicolumn = multicolumnInfo(cell.raw);
  }

  function cellAtLogicalColumn(row, logicalColumn) {
    return row?.cells?.find((cell) => (
      logicalColumn >= cell.logicalStart && logicalColumn < cell.logicalEnd
    )) || null;
  }

  function cellSideCount(cell, model, side) {
    const spec = cellColumnSpec(cell, model);
    return side === "left" ? spec.left : spec.right;
  }

  function setCellSideCount(cell, model, side, count) {
    if (!cell) return;
    const spec = cellColumnSpec(cell, model);
    if (side === "left") spec.left = Math.max(0, Math.min(2, count));
    else spec.right = Math.max(0, Math.min(2, count));
    writeCellColumnSpec(cell, model, spec);
  }

  function toggleCellSideRange(model, rowStart, rowEnd, logicalColumn, side, count) {
    const cells = [];
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const cell = cellAtLogicalColumn(model.rows[row], logicalColumn);
      if (cell && !cells.includes(cell)) cells.push(cell);
    }
    const allSet = cells.length > 0 && cells.every(
      (cell) => cellSideCount(cell, model, side) === count
    );
    cells.forEach((cell) => setCellSideCount(cell, model, side, allSet ? 0 : count));
    return allSet;
  }

  function setCellSideRange(model, rowStart, rowEnd, logicalColumn, side, count, remove) {
    const seen = new Set();
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const cell = cellAtLogicalColumn(model.rows[row], logicalColumn);
      if (!cell || seen.has(cell)) continue;
      seen.add(cell);
      setCellSideCount(cell, model, side, remove ? 0 : count);
    }
  }

  function horizontalRangeSet(boundary, firstColumn, lastColumn, count) {
    for (let column = firstColumn; column < lastColumn; column += 1) {
      if ((boundary.partial.get(column) || 0) !== count) return false;
    }
    return true;
  }

  function toggleBorder(
    source,
    cursor,
    action,
    doubleLine = false,
    selectionStart = cursor,
    selectionEnd = selectionStart
  ) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    const count = doubleLine ? 2 : 1;
    const selection = model.selection || {
      rowStart: model.current.rowIndex,
      rowEnd: model.current.rowIndex,
      columnStart: model.current.logicalColumn,
      columnEnd: model.current.logicalColumn + 1
    };
    const rowStart = Math.max(0, selection.rowStart);
    const rowEnd = Math.min(model.rows.length - 1, selection.rowEnd);
    const firstColumn = Math.max(0, selection.columnStart);
    const lastColumn = Math.min(
      model.columnCount,
      Math.max(firstColumn + 1, selection.columnEnd)
    );
    const above = model.boundaries[rowStart];
    const below = model.boundaries[rowEnd + 1];

    if (action === "left") {
      toggleCellSideRange(model, rowStart, rowEnd, firstColumn, "left", count);
    } else if (action === "right") {
      toggleCellSideRange(model, rowStart, rowEnd, lastColumn - 1, "right", count);
    } else if (action === "above") {
      togglePartialBoundaryRange(
        above,
        firstColumn,
        lastColumn,
        count,
        model.columnCount
      );
    } else if (action === "below") {
      togglePartialBoundaryRange(
        below,
        firstColumn,
        lastColumn,
        count,
        model.columnCount
      );
    } else if (action === "cell") {
      materializeFullBoundary(above, model.columnCount);
      materializeFullBoundary(below, model.columnCount);
      const leftCells = [];
      const rightCells = [];
      for (let row = rowStart; row <= rowEnd; row += 1) {
        const leftCell = cellAtLogicalColumn(model.rows[row], firstColumn);
        const rightCell = cellAtLogicalColumn(model.rows[row], lastColumn - 1);
        if (leftCell && !leftCells.includes(leftCell)) leftCells.push(leftCell);
        if (rightCell && !rightCells.includes(rightCell)) rightCells.push(rightCell);
      }
      const allSet = (
        horizontalRangeSet(above, firstColumn, lastColumn, count) &&
        horizontalRangeSet(below, firstColumn, lastColumn, count) &&
        leftCells.length > 0 &&
        rightCells.length > 0 &&
        leftCells.every((cell) => cellSideCount(cell, model, "left") === count) &&
        rightCells.every((cell) => cellSideCount(cell, model, "right") === count)
      );
      setPartialBoundaryRange(
        above,
        firstColumn,
        lastColumn,
        count,
        model.columnCount,
        allSet
      );
      setPartialBoundaryRange(
        below,
        firstColumn,
        lastColumn,
        count,
        model.columnCount,
        allSet
      );
      setCellSideRange(
        model,
        rowStart,
        rowEnd,
        firstColumn,
        "left",
        count,
        allSet
      );
      setCellSideRange(
        model,
        rowStart,
        rowEnd,
        lastColumn - 1,
        "right",
        count,
        allSet
      );
    } else if (action === "table") {
      const top = model.boundaries[0];
      const bottom = model.boundaries[model.rows.length];
      const outerLeft = model.specModel.boundaries[0];
      const outerRight = model.specModel.boundaries[model.columnCount];
      const allSet = (
        outerLeft.bars === count &&
        outerRight.bars === count &&
        top.full === count &&
        bottom.full === count
      );
      outerLeft.bars = allSet ? 0 : count;
      outerRight.bars = allSet ? 0 : count;
      top.full = allSet ? 0 : count;
      bottom.full = allSet ? 0 : count;
      if (!allSet) {
        top.partial.clear();
        bottom.partial.clear();
      }
    } else {
      throw new Error(`Unknown border action: ${action}`);
    }
    return resultFor(model, rowStart, firstColumn);
  }


  function removeBorders(
    source,
    cursor,
    selectionStart = cursor,
    selectionEnd = selectionStart
  ) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    const selection = model.selection || {
      rowStart: model.current.rowIndex,
      rowEnd: model.current.rowIndex,
      columnStart: model.current.logicalColumn,
      columnEnd: model.current.logicalColumn + 1
    };
    const rowStart = Math.max(0, selection.rowStart);
    const rowEnd = Math.min(model.rows.length - 1, selection.rowEnd);
    const firstColumn = Math.max(0, selection.columnStart);
    const lastColumn = Math.min(
      model.columnCount,
      Math.max(firstColumn + 1, selection.columnEnd)
    );
    const wholeTable = (
      rowStart === 0 &&
      rowEnd === model.rows.length - 1 &&
      firstColumn === 0 &&
      lastColumn === model.columnCount
    );

    for (let boundaryIndex = rowStart; boundaryIndex <= rowEnd + 1; boundaryIndex += 1) {
      const boundary = model.boundaries[boundaryIndex];
      materializeFullBoundary(boundary, model.columnCount);
      for (let column = firstColumn; column < lastColumn; column += 1) {
        boundary.partial.delete(column);
      }
    }

    if (wholeTable) {
      model.specModel.boundaries.forEach((boundary) => {
        boundary.bars = 0;
      });
      model.boundaries.forEach((boundary) => {
        boundary.full = 0;
        boundary.partial.clear();
      });
    }

    const seen = new Set();
    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
      for (let column = firstColumn; column < lastColumn; column += 1) {
        const cell = cellAtLogicalColumn(model.rows[rowIndex], column);
        if (!cell || seen.has(cell)) continue;
        seen.add(cell);
        const spec = cellColumnSpec(cell, model);
        spec.left = 0;
        spec.right = 0;
        writeCellColumnSpec(cell, model, spec);
      }
    }
    return resultFor(model, rowStart, firstColumn);
  }

  function beautify(source, cursor, selectionStart = cursor, selectionEnd = selectionStart) {
    const model = requireModel(source, cursor, selectionStart, selectionEnd);
    return resultFor(
      model,
      model.current.rowIndex,
      model.current.logicalColumn,
      Math.max(0, selectionEnd - selectionStart)
    );
  }

  function createTable({ rows, columns, caption = "", label = "tab:table", selectedText = "" }) {
    const rowCount = Math.max(1, Math.min(100, Number(rows) || 1));
    const columnCount = Math.max(1, Math.min(50, Number(columns) || 1));
    const safeLabel = String(label || "tab:table").replace(/[{}\r\n]/g, "").trim() || "tab:table";
    const cells = Array.from({ length: rowCount }, (_, rowIndex) => (
      Array.from({ length: columnCount }, (_, columnIndex) => (
        rowIndex === 0 && columnIndex === 0 ? String(selectedText || "") : ""
      ))
    ));
    const widths = Array.from({ length: columnCount }, (_item, columnIndex) => (
      Math.max(1, ...cells.map((row) => String(row[columnIndex] || "").length))
    ));
    const rowSources = cells.map((row) => {
      let value = "  ";
      row.forEach((cell, columnIndex) => {
        if (columnIndex) value += " & ";
        value += String(cell || "").padEnd(widths[columnIndex], " ");
      });
      return value;
    });
    const alignedWidth = Math.max(...rowSources.map((row) => row.length));
    const lines = rowSources.map((row) => `${row.padEnd(alignedWidth, " ")} \\\\`);
    const prefix = [
      "\\begin{table}[htbp]",
      "\\centering",
      `\\caption{${String(caption || "")}}`,
      `\\label{${safeLabel}}`,
      `\\begin{tabular}{${"c".repeat(columnCount)}}`,
      ""
    ].join("\n");
    const suffix = "\n\\end{tabular}\n\\end{table}";
    const text = prefix + lines.join("\n") + suffix;
    const firstCellOffset = prefix.length + 2;
    return {
      text,
      selectionStart: firstCellOffset,
      selectionEnd: firstCellOffset + String(selectedText || "").length
    };
  }

  global.SmartTeXTableEditor = Object.freeze({
    analyze,
    addRow,
    removeRow,
    addColumn,
    moveColumn,
    moveRow,
    removeColumn,
    toggleBorder,
    removeBorders,
    beautify,
    createTable,
    parseColumnSpec,
    serializeColumnSpec
  });
})(globalThis);
