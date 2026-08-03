/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

(() => {
  "use strict";

  if (globalThis.SmartTeXBibTeX) return;

  function stripOuterDelimiters(value) {
    let result = String(value || "").trim();
    while (
      result.length >= 2 &&
      (
        (result.startsWith("{") && result.endsWith("}")) ||
        (result.startsWith('"') && result.endsWith('"'))
      )
    ) {
      result = result.slice(1, -1).trim();
    }
    return result;
  }

  function latexToText(value) {
    return stripOuterDelimiters(value)
      .replace(/\\(?:textit|textbf|emph|mathrm|mathbf|mathit|textrm|mbox|url)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\(?:['`^"~=Hckrubvd])\s*\{?([A-Za-z])\}?/g, "$1")
      .replace(/\\(?:ae|AE|oe|OE|aa|AA|o|O|l|L|ss)\b/g, (match) => ({
        "\\ae": "æ",
        "\\AE": "Æ",
        "\\oe": "œ",
        "\\OE": "Œ",
        "\\aa": "å",
        "\\AA": "Å",
        "\\o": "ø",
        "\\O": "Ø",
        "\\l": "ł",
        "\\L": "Ł",
        "\\ss": "ß"
      })[match] || match)
      .replace(/\\([%&#_$])/g, "$1")
      .replace(/&amp;/gi, "&")
      .replace(/~/g, " ")
      .replace(/---/g, "—")
      .replace(/--/g, "–")
      .replace(/[{}]/g, "")
      .replace(/\\[A-Za-z]+\*?/g, "")
      .replace(/\\(.)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function splitTopLevel(text, delimiter = ",") {
    const parts = [];
    let current = "";
    let braceDepth = 0;
    let parenDepth = 0;
    let quoted = false;
    let escaped = false;
    for (const character of String(text || "")) {
      if (escaped) {
        current += character;
        escaped = false;
        continue;
      }
      if (character === "\\") {
        current += character;
        escaped = true;
        continue;
      }
      if (character === '"') {
        current += character;
        quoted = !quoted;
        continue;
      }
      if (!quoted) {
        if (character === "{") braceDepth += 1;
        else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
        else if (character === "(") parenDepth += 1;
        else if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
      }
      if (
        character === delimiter &&
        !quoted &&
        braceDepth === 0 &&
        parenDepth === 0
      ) {
        parts.push(current);
        current = "";
      } else {
        current += character;
      }
    }
    parts.push(current);
    return parts;
  }

  function splitAuthorsRaw(value) {
    const text = stripOuterDelimiters(value);
    const authors = [];
    let current = "";
    let depth = 0;
    for (let index = 0; index < text.length;) {
      if (text[index] === "{") depth += 1;
      if (text[index] === "}") depth = Math.max(0, depth - 1);
      if (
        depth === 0 &&
        text.slice(index, index + 5).toLowerCase() === " and "
      ) {
        if (current.trim()) authors.push(current.trim());
        current = "";
        index += 5;
        continue;
      }
      current += text[index];
      index += 1;
    }
    if (current.trim()) authors.push(current.trim());
    return authors;
  }

  function formatAuthorName(value) {
    const parts = splitTopLevel(String(value || "")).map((part) => part.trim());
    if (parts.length < 2) return latexToText(value);
    const family = parts[0];
    const given = parts.at(-1);
    const suffix = parts.length > 2 ? parts.slice(1, -1).join(", ") : "";
    return latexToText(
      `${given ? `${given} ` : ""}${family}${suffix ? `, ${suffix}` : ""}`
    );
  }

  function splitAuthors(value) {
    return splitAuthorsRaw(value).map(formatAuthorName).filter(Boolean);
  }

  function readBalanced(text, startIndex, openCharacter, closeCharacter) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = startIndex; index < text.length; index += 1) {
      const character = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"' && depth <= 1) {
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (character === openCharacter) depth += 1;
      else if (character === closeCharacter) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }

  function parseFields(body) {
    const fields = {};
    for (const rawPart of splitTopLevel(body)) {
      const part = rawPart.trim();
      if (!part) continue;
      let depth = 0;
      let quoted = false;
      let escaped = false;
      let equalsIndex = -1;
      for (let index = 0; index < part.length; index += 1) {
        const character = part[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (character === '"') {
          quoted = !quoted;
          continue;
        }
        if (!quoted) {
          if (character === "{") depth += 1;
          else if (character === "}") depth = Math.max(0, depth - 1);
          else if (character === "=" && depth === 0) {
            equalsIndex = index;
            break;
          }
        }
      }
      if (equalsIndex < 0) continue;
      const name = part.slice(0, equalsIndex).trim().toLowerCase();
      const value = part.slice(equalsIndex + 1).trim();
      if (name) fields[name] = value;
    }
    return fields;
  }

  function findEntryStarts(text) {
    const starts = [];
    const pattern = /^[\t ]*@([A-Za-z]+)\s*([({])/gm;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      starts.push({
        start: match.index + match[0].indexOf("@"),
        type: match[1].toLowerCase(),
        openCharacter: match[2],
        openIndex: pattern.lastIndex - 1
      });
    }
    return starts;
  }

  function parseEntry(text, entry, nextStart, sourceFile) {
    if (["comment", "preamble", "string"].includes(entry.type)) return null;
    const segmentEnd = Number.isInteger(nextStart) ? nextStart : text.length;
    const segment = text.slice(entry.start, segmentEnd);
    const localOpen = entry.openIndex - entry.start;
    const closeCharacter = entry.openCharacter === "{" ? "}" : ")";
    const balancedClose = readBalanced(
      segment,
      localOpen,
      entry.openCharacter,
      closeCharacter
    );
    const close = balancedClose >= 0 ? balancedClose : segment.lastIndexOf(closeCharacter);
    const body = segment.slice(localOpen + 1, close > localOpen ? close : segment.length);
    const comma = body.indexOf(",");
    if (comma < 0) return null;
    const key = body.slice(0, comma).trim();
    if (!key) return null;
    const fields = parseFields(body.slice(comma + 1));
    const authorValue = fields.author || fields.editor || "";
    return {
      key,
      type: entry.type,
      title: latexToText(fields.title || key),
      authors: splitAuthors(authorValue),
      journal: latexToText(
        fields.journal ||
        fields.journaltitle ||
        fields.booktitle ||
        fields.publisher ||
        ""
      ),
      year: latexToText(fields.year || fields.date || "").match(/\d{4}/)?.[0] || "",
      volume: latexToText(fields.volume || ""),
      number: latexToText(fields.number || fields.issue || ""),
      pages: latexToText(
        fields.pages || fields.eid || fields.article_number || fields.articleno || ""
      ),
      keywords: latexToText(fields.keywords || fields.keyword || fields.subject || ""),
      doi: latexToText(fields.doi || "")
        .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
        .trim(),
      sourceFile,
      fields
    };
  }

  function parseBibTeX(value, sourceFile = "") {
    const text = String(value || "");
    const starts = findEntryStarts(text);
    const records = [];
    starts.forEach((entry, index) => {
      try {
        const record = parseEntry(text, entry, starts[index + 1]?.start, sourceFile);
        if (record) records.push(record);
      } catch (error) {
        console.warn(
          `[SmartTeX] Skipped malformed BibTeX entry near character ${entry.start}:`,
          error
        );
      }
    });
    return records;
  }

  globalThis.SmartTeXBibTeX = Object.freeze({
    parseBibTeX,
    latexToText,
    splitAuthors,
    splitAuthorsRaw,
    formatAuthorName
  });
})();
