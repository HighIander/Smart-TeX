/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const rendererSource = fs.readFileSync(path.join(root, "figure-renderer.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
const renderedEditorSource = fs.readFileSync(path.join(root, "rendered-editor.js"), "utf8");

const context = {
  chrome: { runtime: { getURL: () => "" } },
  console
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(rendererSource, context, { filename: "figure-renderer.js" });

const source = String.raw`
    \centering
    \begin{subfigure}[t]{0.49\textwidth}
        \centering
        \includegraphics[width=\linewidth]{fig/appendix/nu2_scan_summary_all_cases_cold.png}
        \caption{Cold background plasma ($100\unit{eV}$).}
        \label{fig:nu2_scan_cold}
    \end{subfigure}%
    \hfill
    \begin{subfigure}[t]{0.49\textwidth}
        \centering
        \includegraphics[width=\linewidth]{fig/appendix/nu2_scan_summary_all_cases_warmDense.png}
        \caption{Warm background plasma ($1\unit{keV}$), dense beam
        ($\alpha = 0.05$).}
        \label{fig:nu2_scan_warm_dense}
    \end{subfigure}
`;

const renderer = context.SmartTeXFigureRenderer;
const wide = renderer.parseFigureLayout(source, { environment: "figure*" });
assert.equal(wide.rows.length, 1, "figure* must keep fitting subfigures on one row.");
assert.equal(wide.rows[0].items.length, 2);
assert.deepEqual(
  Array.from(wide.rows[0].items, (item) => Number(item.widthRatio)),
  [0.49, 0.49]
);
assert.equal(wide.rows[0].normalizeRelativeWidths, true);
assert.equal(wide.rows[0].relativeWidthRatio, 0.98);
assert.deepEqual(
  Array.from(wide.rows[0].items, (item) => item.images[0].path),
  [
    "fig/appendix/nu2_scan_summary_all_cases_cold.png",
    "fig/appendix/nu2_scan_summary_all_cases_warmDense.png"
  ]
);
assert.deepEqual(
  Array.from(wide.rows[0].items, (item) => Number(item.images[0].width.localRatio)),
  [1, 1],
  "width=\\linewidth must fill its own subfigure panel, not the outer figure."
);

const narrow = renderer.parseFigureLayout(source, { environment: "figure" });
assert.equal(narrow.rows.length, 2, "figure must stack subfigure panels vertically.");
assert.deepEqual(Array.from(narrow.rows, (row) => row.items.length), [1, 1]);
assert.deepEqual(
  Array.from(narrow.rows, (row) => Number(row.relativeWidthRatio)),
  [0.49, 0.49]
);
assert.ok(
  narrow.rows.every((row) => row.normalizeRelativeWidths),
  "A single relative panel must be normalized to the full width of its own row."
);

assert.match(
  contentSource,
  /parseFigureLayout\?\.\(context\.source \|\| "", \{ environment: context\.environment \}\)/,
  "Popup rendering must pass figure versus figure* into the shared layout parser."
);
assert.match(
  contentSource,
  /const rowFraction = normalizeRelativeWidths[\s\S]*widthRatio \/ relativeTotal/,
  "Popup panel widths must be normalized within each generated row."
);
assert.match(
  renderedEditorSource,
  /parseFigureLayout\(item\.context\?\.source \|\| "", \{[\s\S]*environment: item\.context\?\.environment/,
  "Rendered-editor figures must use the same figure versus figure* rule."
);

console.log("Subfigure layout regression checks passed.");
