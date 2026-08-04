# SmartTeX

## Contents

* [Installation for development](#installation-for-development)
* [Sync uploaded files and figures with Nextcloud](#sync-uploaded-files-and-figures-with-nextcloud)
* [Equation preview](#equation-preview)
* [Reference and citation popups](#reference-and-citation-popups)
* [Reference autocomplete](#reference-autocomplete)
* [Citation autocomplete](#citation-autocomplete)
* [Table preview](#table-preview)
* [License](#license)

SmartTeX is a standalone browser extension for CollabTeX-compatible LaTeX
editors. It provides live equation and table previews anchored near the text
cursor, plus an optional full-document live preview inside the PDF pane.

## Installation for development

1. Open the browser's extension-management page.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select this `smarttex` directory.
5. Open SmartTeX's options and configure the document-editor domains.

The extension is independent of Smart Citations and can be enabled or disabled
separately.

## Sync uploaded files and figures with Nextcloud

The cloud button next to **Smart** connects the current CollabTeX document to a
Nextcloud account. Connections are saved by SmartTeX and can be reused by other
documents, while the selected connection, automatic-update setting, linked
files, and last visited Nextcloud directory remain document-specific.

CollabTeX's native upload dialog gains a **From Nextcloud** source. Files
selected there are uploaded through CollabTeX and remain linked to their
Nextcloud source. Linked files have individual update controls in the file
tree, and the file-tree toolbar provides an update-all control. Optional
automatic updates check the linked sources once per minute.

Changing or disconnecting a document's Nextcloud connection removes its link
metadata after confirmation. The existing CollabTeX files are not deleted and
continue as normal project files.

## Equation preview

The preview recognizes inline and display math delimiters as well as common
equation environments. It applies `\newcommand`, `\renewcommand`, and
`\providecommand` definitions that occur earlier in the active file, including
commands with an optional default argument. Document-only metadata such as
`\label`, `\nonumber`, and `\notag` is consumed without affecting the rendered
equation.

KaTeX is bundled locally. Equation source is not sent to an external service.
Numbered equation environments and multi-line equation arrays show their
inferred equation numbers in a separated right-hand column. Starred
environments, `\nonumber`, `\notag`, and explicit `\tag` values are respected.
The rendered caret treats delimiter commands such as `\left(` and
`\right\rangle` as indivisible units, so moving through their source does not
temporarily invalidate the preview.

Preview popups can be easily closed with the <kbd>Esc</kbd> key.

## Reference and citation popups

Reference, equation-reference, and citation previews can be displayed either on
pointer hover or only while the source-editor cursor is inside the corresponding
command.

By following the linked title in a reference popup, you can inspect the source
around the target. A back-arrow button then appears to the left of the SmartTeX
formatting controls and quickly returns you to the previous cursor position.

## Reference autocomplete

Inside common reference commands such as `\ref{…}` and `\eqref{…}`,
SmartTeX replaces the editor's native completion list with a label list built
from the active document. Labels follow their first appearance in the document
by default; the options page can switch this to alphabetical order. Arrow-key
selection and mouse hover open the same equation, figure, table, or section
preview used elsewhere in SmartTeX, and Enter or Tab inserts the selected label.

## Citation autocomplete

Inside common `\cite{…}` commands, SmartTeX offers a compact citation-key
autocomplete list. On first use, it asks for confirmation before parsing the
bibliography files declared by the current document. Bibliography files are
read passively in the background from the collaborative project model or an
in-memory project archive; SmartTeX never opens them in the editor or changes
the active document. Parsed entries are cached per project.

The popup supports matching by key, title, author, journal, year, keyword, and
DOI, as well as keyboard selection using the arrow keys, Enter, or Tab.

The popup includes a small link to
[Smart Citations](https://github.com/HighIander/Smart-Citations) for users who
want the full reference manager, featuring automatic completion of details
using DOI lookup, PDF download with commenting and notes, and categories shared
with other users—all backed up and synchronized via Nextcloud. If Smart
Citations is active on the page, SmartTeX disables its own citation handling
and leaves autocomplete entirely to Smart Citations.

## Table preview

Moving the cursor into a `tabular`, `tabular*`, `tabularx`, `longtable`, or
`array` environment opens a live table preview. It supports column alignment
and vertical rules, `\hline` and booktabs-style rules, `\multicolumn`, common
text-formatting commands, imported simple macros, and KaTeX-rendered inline
mathematics. Table source is processed locally.

For a `tabular` nested in a captioned `table` environment, the preview header
shows the table number inferred from earlier captioned tables in the active
LaTeX file.

## License

First-party SmartTeX source files are licensed under CC BY-NC-SA 4.0.
Bundled KaTeX files are licensed under the MIT license included with the
vendor files.

The name "Smart TeX", "Smart-TeX" and "SmartTeX" are owned by the author and not part of this license.
