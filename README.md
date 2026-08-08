# SmartTeX

## Contents

* [Installation for development](#installation-for-development)
* [Sync uploaded files and figures with Nextcloud](#sync-uploaded-files-and-figures-with-nextcloud)
* [Document options and presets](#document-options-and-presets)
* [Editor formatting and insertion toolbar](#editor-formatting-and-insertion-toolbar)
* [Collaborative comments](#collaborative-comments)
* [Equation preview](#equation-preview)
* [Reference and citation popups](#reference-and-citation-popups)
* [Reference autocomplete](#reference-autocomplete)
* [Citation autocomplete](#citation-autocomplete)
* [Table preview](#table-preview)
* [License](#license)

SmartTeX is a standalone browser extension for CollabTeX-compatible LaTeX
editors. It provides equation, table, figure, reference, and citation popup
previews anchored near the source editor.

## Installation for development

1. Open the browser's extension-management page.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select this `smarttex` directory.
5. Open SmartTeX's options and configure the document-editor domains.

The extension is independent of Smart Citations and can be enabled or disabled
separately.

## Document options and presets

The **S** hamburger opens all SmartTeX settings for the current document,
including popup behavior, autocomplete, label-change warnings, source
highlighting, data protection, and imprint links. **Use extension defaults**
applies the presets stored on the extension options page. After disabling it,
the document can override those values; every setting row has its own reset to
the corresponding extension preset.

Environment bodies, environment first lines, and section command lines have
independent enable switches and colors. The document-editor site list remains
available only on the extension presets page.

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


## Editor formatting and insertion toolbar

The editor toolbar provides source-aware controls for bold, italic, underline,
text size, bulleted and numbered lists, and insertion of figure, equation, and
table environments. While the cursor or selection is inside a table, additional
controls add, remove, and move rows or columns, toggle single or double borders,
remove borders, and beautify the table source. These tools are independent of
the removed full-document live preview.

## Collaborative comments

The editor toolbar includes a comments button that opens a resizable comments
pane between the source editor and compiled preview. A project-level
`.smarttex-comments.json` file stores comment threads, replies, text markers,
anchor context, author names, colors, and synchronization tombstones. Project
I/O is asynchronous, and anchor maintenance is deferred off the immediate
typing path.

The extension creates a persistent random animal name and user color on first
use. Both can be changed globally either on the extension options page or in
the in-editor SmartTeX menu. Selecting source text while the comments pane is
open exposes comment and marker actions. Commented ranges remain highlighted
in the author's color; point comments use a vertical source marker. Clicking a
source comment icon focuses its thread, while a thread can navigate back to its
source range. Threads support replies, individual comment removal, whole-thread
deletion, per-thread minimization, and minimizing all comments.

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
Cursor-only updates reuse the existing equation context, inferred numbering,
and prepared document macros. They are dispatched before the next paint and
rerender only the local KaTeX caret or selection. Editor scrolling only
repositions the popup and the already analyzed source overlays.

Preview popups can be easily closed with the <kbd>Esc</kbd> key. Figure popups
show zoom controls on hover; the mouse wheel zooms around the pointer position,
and a zoomed figure can be dragged with the hand cursor to pan it. Raster images
are enlarged through their layout dimensions so the browser resamples the
original source instead of scaling a cached compositor layer. PDF previews are
re-rendered before zooming at twice the required physical-pixel resolution.

Inside `\includegraphics{…}`, SmartTeX immediately opens an alphabetically
sorted figure-file list filtered by the text in the argument. Hovering or
selecting an entry displays its figure preview. Files already used by an
`\includegraphics` command in the active source carry a green checkmark. The
header control can restrict the list to files not yet included.

## Reference and citation popups

Reference, equation-reference, and citation previews can be displayed either on
pointer hover or only while the source-editor cursor is inside the corresponding
command.

By following the linked title in a reference popup, you can inspect the source
around the target.

## Reference autocomplete

Inside common reference commands such as `\ref{…}` and `\eqref{…}`,
SmartTeX replaces the editor's native completion list with a label list built
from the active document. Labels follow their first appearance in the document
by default; the options page can switch this to alphabetical order. Arrow-key
selection and mouse hover open the same equation, figure, table, or section
preview used elsewhere in SmartTeX, and Enter or Tab inserts the selected label.
Long reference and citation result lists remain bounded to the available screen
space and scroll internally. Section descriptions use the same class-aware
numbering as the source badges, including REVTeX Roman numbering and a reset to
alphabetic section numbers after `\appendix`.

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


## Version 1.4.34

Figure popup zoom now uses a fixed clipping viewport and stores the rendered
width and height of every image at 100%. Zoomed figures can therefore be panned
both horizontally and vertically to all four edges, including previews opened
from the `\includegraphics{...}` list. The transformed image no longer changes
the popup's outer geometry, so source highlights are only hidden beneath the
actual popup window and not beneath image content panned beyond it.

Changed-label hover previews now show a loading indicator before parsing. Their
context is recalculated around the exact reference occurrence, excludes the
outer `document` environment, and caches document macros, reference targets,
and citation targets for the duration of the preview. This prevents the whole
document from being rendered and avoids repeated full-document scans while
hovering.


## Version 1.4.28

This release improves the changed-label context preview and scroll behavior.
The context renderer recursively handles standard, custom, nested, formatting,
unit, link, citation, reference, environment, and mathematical LaTeX commands
instead of exposing raw command text. For each dialog entry, only the exact
reference occurrence represented by that entry is highlighted. During editor
wheel, touch, or scrollbar movement, source highlights, section/environment
badges, equation/environment previews, reference previews, and autocomplete
popups are hidden while their state is retained. Once scrolling settles, their
geometry and editor state are refreshed before the overlays become visible at
the new location.


## Version 1.4.27

This release gives editor interaction absolute priority over SmartTeX work. A
new central task controller invalidates active and scheduled SmartTeX analyses
on keyboard, input, wheel, scroll, and touch-scroll events originating in the
editor. Long synchronous parsers use cooperative checkpoints and
`isInputPending()` so queued interaction aborts before completion where the
browser supports it. Popup, autocomplete, toolbar, label-guard, structure,
highlight, and badge results are committed atomically; aborted work therefore
leaves the last valid UI in place and is retried only after the editor becomes
idle. Host-editor events are never prevented or stopped.


## Version 1.4.26

This release keeps the stable 1.4.20-based architecture and improves the
label-reference guard. Renamed labels are checked only after the cursor leaves
the corresponding `\label{...}` field. Context previews show a larger rendered
text excerpt with KaTeX equations and navigable reference links, and the
per-occurrence action is named Update. Source-highlighting options can now
emphasize the active field or environment with an adjustable strength; disabled
highlight categories show only the active structure in neutral gray.


## Version 1.4.25

This release is based directly on the stable 1.4.20 code path. The experimental
background-analysis architecture from versions 1.4.21–1.4.24 is not included.
It adds an optional warning dialog when a referenced label is renamed or deleted,
with navigation, KaTeX hover excerpts, per-reference Update/Ignore actions, and
Update all/Cancel controls.


## 1.4.34

- Keep changed-label reference previews local and approximately symmetric around the exact reference occurrence.
- Limit context expansion to at most three to four surrounding sentences per side; large environments such as `minipage` never expand the excerpt to the whole environment.
- Preserve complete nearby inline math and command syntax only when it fits inside a small bounded safety allowance.
- Show the global loading spinner over the SmartTeX S-hamburger button instead of at the editor cursor.
