/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
require("../latex-context.js");
require("../table-editor.js");

const editor = globalThis.SmartTeXTableEditor;

function apply(source, edit) {
  return source.slice(0, edit.start) + edit.text + source.slice(edit.end);
}

const initial = String.raw`Before
\begin{table}
\caption{Example}
\label{tab:example}
\begin{tabular}{|lD{.}{.}{2}|}
\hline
Alpha & 1.2 \\
Beta & 3.4 \\
\hline
\end{tabular}
\end{table}
After`;

const cursor = initial.indexOf("3.4") + 1;
const analysis = editor.analyze(initial, cursor);
assert.ok(analysis, "The active table should be detected.");
assert.equal(analysis.columnCount, 2, "Custom D columns should count as one column.");
assert.equal(analysis.rows.length, 2);
assert.deepEqual(analysis.current, { rowIndex: 1, cellIndex: 1, logicalColumn: 1 });

let changed = apply(initial, editor.addRow(initial, cursor, "above"));
let changedAnalysis = editor.analyze(changed, changed.indexOf("3.4"));
assert.equal(changedAnalysis.rows.length, 3);
assert.match(changed, /Alpha\s+&\s+1\.2\s+\\\\\n\s*&\s*\\\\\n\s*Beta\s+&\s+3\.4/);

changed = apply(initial, editor.addColumn(initial, cursor, "right"));
changedAnalysis = editor.analyze(changed, changed.indexOf("3.4"));
assert.equal(changedAnalysis.columnCount, 3);
assert.match(changed, /\{\|lD\{\.\}\{\.\}\{2\}\|c\}/);
assert.match(changed, /Beta\s+&\s+3\.4\s+&\s*\\\\/);

changed = apply(initial, editor.removeRow(initial, cursor));
changedAnalysis = editor.analyze(changed, changed.indexOf("Alpha"));
assert.equal(changedAnalysis.rows.length, 1);
assert.doesNotMatch(changed, /Beta/);

changed = apply(initial, editor.removeColumn(initial, cursor));
changedAnalysis = editor.analyze(changed, changed.indexOf("Beta"));
assert.equal(changedAnalysis.columnCount, 1);
assert.doesNotMatch(changed, /3\.4/);

changed = apply(initial, editor.moveColumn(initial, cursor, "left"));
assert.match(changed, /1\.2\s+&\s+Alpha/);
assert.match(changed, /3\.4\s+&\s+Beta/);

changed = apply(initial, editor.toggleBorder(initial, cursor, "cell", false));
assert.match(changed, /\\multicolumn\{1\}\{\|D\{\.\}\{\.\}\{2\}\|\}\{3\.4\}/);
assert.match(changed, /\\cline\{2-2\}/);

const doubleBorder = apply(initial, editor.toggleBorder(initial, cursor, "right", true));
assert.match(doubleBorder, /\\multicolumn\{1\}\{D\{\.\}\{\.\}\{2\}\|\|\}\{3\.4\}/);

const multicolumn = String.raw`\begin{tabular}{lcc}
\multicolumn{2}{c}{Heading} & X \\
A & B & C \\
\end{tabular}`;
const multiCursor = multicolumn.indexOf("Heading");
changed = apply(multicolumn, editor.addColumn(multicolumn, multiCursor, "right"));
assert.match(changed, /\\multicolumn\{3\}\{c\}\{Heading\}/);
assert.equal(editor.analyze(changed, changed.indexOf("Heading")).columnCount, 4);
assert.throws(
  () => editor.moveColumn(multicolumn, multiCursor, "right"),
  /multicolumn/
);
const borderedMulticolumn = apply(
  multicolumn,
  editor.toggleBorder(multicolumn, multiCursor, "cell", false)
);
assert.match(borderedMulticolumn, /\\cline\{1-2\}/);
assert.match(borderedMulticolumn, /\\multicolumn\{2\}\{\|c\|\}\{Heading\}/);

const selected = String.raw`\begin{tabular}{ccc}
A & B & C \\
D & E & F \\
\end{tabular}`;
const selectedStart = selected.indexOf("A");
const selectedEnd = selected.indexOf("B") + 1;
const selectedDouble = apply(
  selected,
  editor.toggleBorder(
    selected,
    selectedStart,
    "below",
    true,
    selectedStart,
    selectedEnd
  )
);
assert.equal(
  (selectedDouble.match(/\\cline\{1-2\}/g) || []).length,
  2,
  "A double selected horizontal rule should serialize as two matching clines."
);
assert.doesNotMatch(selectedDouble, /\\cline\{1-3\}/);

const selectedVertical = apply(
  selected,
  editor.toggleBorder(
    selected,
    selectedStart,
    "right",
    false,
    selectedStart,
    selected.indexOf("D") + 1
  )
);
assert.match(selectedVertical, /\\multicolumn\{1\}\{c\|\}\{A\}/);
assert.match(selectedVertical, /\\multicolumn\{1\}\{c\|\}\{D\}/);
assert.doesNotMatch(selectedVertical, /\\multicolumn\{1\}\{c\|\}\{B\}/);

let growingRule = String.raw`\begin{tabular}{c}
A \\
\cline{1-1}
B \\
\end{tabular}`;
growingRule = apply(
  growingRule,
  editor.addColumn(growingRule, growingRule.indexOf("A"), "right")
);
growingRule = apply(
  growingRule,
  editor.addColumn(growingRule, growingRule.indexOf("A"), "right")
);
assert.match(growingRule, /\\cline\{1-3\}/);

const movedRow = apply(selected, editor.moveRow(selected, selected.indexOf("D"), "up"));
assert.ok(movedRow.indexOf("D") < movedRow.indexOf("A"));
assert.match(movedRow, /D\s+&\s+E\s+&\s+F/);
assert.match(movedRow, /A\s+&\s+B\s+&\s+C/);


const localCell = String.raw`\begin{tabular}{ccc}
1 & 2 & 3 \\
4 & 5 & 6 \\
\end{tabular}`;
const localCellCursor = localCell.indexOf("3 \\");
const localCellBordered = apply(
  localCell,
  editor.toggleBorder(localCell, localCellCursor, "cell", false)
);
assert.match(localCellBordered, /\\multicolumn\{1\}\{\|c\|\}\{3\}/);
const localCellContentCursor = localCellBordered.indexOf("}{3}") + 2;
const localCellUnbordered = apply(
  localCellBordered,
  editor.toggleBorder(localCellBordered, localCellContentCursor, "cell", false)
);
assert.doesNotMatch(localCellUnbordered, /\\multicolumn\{1\}\{c\}\{3\}/);
assert.match(localCellUnbordered, /1\s+&\s+2\s+&\s+3/);

const clearedCell = apply(
  localCellBordered,
  editor.removeBorders(localCellBordered, localCellContentCursor)
);
assert.doesNotMatch(clearedCell, /\\cline\{3-3\}/);
assert.doesNotMatch(clearedCell, /\\multicolumn\{1\}\{c\}\{3\}/);

const borderedWhole = String.raw`\begin{tabular}{|c|c|}
\hline
A & BBBB \\
CC & D \\
\hline
\end{tabular}`;
const clearedWhole = apply(
  borderedWhole,
  editor.removeBorders(
    borderedWhole,
    borderedWhole.indexOf("A"),
    borderedWhole.indexOf("A"),
    borderedWhole.indexOf("D") + 1
  )
);
assert.match(clearedWhole, /\\begin\{tabular\}\{cc\}/);
assert.doesNotMatch(clearedWhole, /\\(?:hline|cline)/);

const ugly = String.raw`\begin{tabular}{ccc}
a&bbbb&c\\
long&x&yy\\
\end{tabular}`;
const beautiful = apply(ugly, editor.beautify(ugly, ugly.indexOf("bbbb")));
const beautyRows = beautiful.split("\n").filter((line) => /\\\\\s*$/.test(line));
assert.equal(beautyRows.length, 2);
assert.equal(beautyRows[0].indexOf("&"), beautyRows[1].indexOf("&"));
assert.equal(beautyRows[0].lastIndexOf("&"), beautyRows[1].lastIndexOf("&"));
assert.equal(beautyRows[0].indexOf("\\\\"), beautyRows[1].indexOf("\\\\"));



const indentedTable = String.raw`Before
    \begin{tabular}{cc}
    A & B \\
    C & D \\
    \end{tabular}
After`;
let stableIndentTable = indentedTable;
for (let editIndex = 0; editIndex < 6; editIndex += 1) {
  const stableCursor = stableIndentTable.indexOf("A");
  stableIndentTable = apply(
    stableIndentTable,
    editor.toggleBorder(stableIndentTable, stableCursor, "left", false)
  );
  const tableLines = stableIndentTable.split("\n").filter((line) => (
    line.includes("\\begin{tabular}") ||
    line.includes("\\end{tabular}") ||
    line.includes("\\multicolumn") ||
    /^\s*A\s*&/.test(line) ||
    /^\s*C\s*&/.test(line)
  ));
  for (const line of tableLines) {
    assert.match(
      line,
      /^ {4}\S/,
      "Repeated table edits must retain the original four-space indentation."
    );
    assert.doesNotMatch(
      line,
      /^ {5,}\S/,
      "Repeated table edits must not accumulate leading spaces."
    );
  }
}

const created = editor.createTable({
  rows: 2,
  columns: 3,
  caption: "A caption",
  label: "tab:new",
  selectedText: "Selected"
});
assert.match(created.text, /\\caption\{A caption\}/);
assert.match(created.text, /\\label\{tab:new\}/);
assert.match(created.text, /\\begin\{tabular\}\{ccc\}/);
assert.equal((created.text.match(/\\\\/g) || []).length, 2);
assert.equal(created.text.slice(created.selectionStart, created.selectionEnd), "Selected");

console.log("SmartTeX table editor tests passed.");
