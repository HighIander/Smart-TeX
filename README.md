# SmartTeX

## Key Features

* choose citations from drop-down list, parsed from the connected bib file; support for [SmartCitations](https://github.com/HighIander/Smart-Citations) (an extension that provides a full-featured, supercharged refrence manager)
* choose references from lists with thumbnail previews, sort by alphabet or by order of appearance in document
* show previews of equations, figures (zommable!) and tables in popups; even the current cursor position is shown
* in the editor, environments are highlighted and numbered elements' numbers are displayed
* graphical user interface to edit tables: add, move, delete columns and rows, edit borders and styles
* add and sync figures from nextcloud
* track and accept/refuse changes from multiple authors
* add comments (support for emojis and animated gifs), highlight text
* all configurable and de-/activatable in the extension's option page

## Installation

SmartTeX is available in the Chrome Extension Web-Store and the Mozilla Firefox Add-On store for free.

## More Details

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

SmartTeX first tries to adopt the logged-in CollabTeX account name and creates
a persistent random animal name only when the host does not expose a usable
current-user name. A one-time bubble explains that fallback and links directly
to the in-editor SmartTeX options. The user name and color can be changed
globally either on the extension options page or in the in-editor SmartTeX menu. Selecting source text while the comments pane is
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
The bundled `Powered by GIPHY` attribution mark is a GIPHY trademark asset and
is used only for the GIPHY integration under GIPHY's API/branding terms; it is
not licensed as SmartTeX first-party source.

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





## Version 2.1.11 — Consistent user-name label

- Renames the comment identity label in the SmartTeX S-menu from **Name** to **User name**, matching the Options page.

## Version 2.1.10 — Concise identity and GIPHY options text

- Renames the comment identity field label from **Name** to **User name**.
- Simplifies the GIPHY Options text: it now mentions GIPHY API rate limiting only briefly as the reason SmartTeX may ask for a personal API key, without exposing SmartTeX's internal shared-key thresholds.

## Version 2.1.12 — More robust CollabTeX identity discovery and fallback notice

- Current-user discovery now prefers explicit CollabTeX/Overleaf page bootstrap and `ol-user` metadata, with account-menu metadata, collaboration tracking, and the same-origin user-settings page as progressively weaker fallbacks.
- Identity discovery is retried while CollabTeX finishes bootstrapping and is explicitly retriggered when a comment is started or the S-menu opens while a generated animal name is still active.
- Manual SmartTeX user names remain authoritative and are never overwritten by automatic discovery.
- If an animal fallback is still necessary, a one-time speech bubble is anchored to the displayed user name when the first comment is started. It explains the fallback and provides an **Open options** action.
- If that bubble has not been shown yet, opening the S-menu shows the same one-time explanation anchored to the **User name** field there.

## Version 2.1.9 — CollabTeX account name for comments

SmartTeX now adopts the logged-in CollabTeX display name from the local
collaboration client record when available. Random animal names remain only as
a fallback. Existing manual names are preserved, and once a user edits their
SmartTeX comment name it is never overwritten automatically. The provenance of
the name (generated, CollabTeX, or manual) is stored locally with the profile.

## Version 2.1.8 — GIPHY pagination and API-call-aware shared-key policy

- GIPHY Search and Trending requests use the maximum page size of 50 results per content API call.
- With a personal API key, the GIF picker automatically appends the next 50 results when scrolling near the bottom.
- With SmartTeX's bundled key, pagination is manual via a **Load more** button so scrolling alone never consumes another API call.
- Pagination appends into the existing chooser DOM and preserves the 2.1.6 focus/chooser stability protections.
- Shared-key usage now tracks both rolling-hour GIF insertions and Search/Trending API calls.
- SmartTeX politely suggests a personal key after five insertions or 10 content API calls in the last hour.
- A personal key becomes mandatory only after 10 insertions or 20 content API calls in a rolling hour, or after 50 total shared-key GIF insertions.
- The API-call allowance counts Search/Trending page requests; analytics pingbacks and the one-time random customer-ID bootstrap are not counted by SmartTeX's content-call policy.

## Version 2.1.6 — Stable comment focus and chooser lifetime

- Background comment synchronization and editor-state updates no longer rebuild the complete comments pane when its records have not changed.
- Focused comment/reply/edit fields, the emoji chooser, the GIPHY chooser, and SmartTeX comment modals protect their DOM while background updates arrive; necessary pane refreshes are deferred until the interaction ends.
- Frequent editor cursor/selection events now update overlays and the active-thread highlight in place instead of replacing all comment controls.
- The temporary 1.6-second comment-icon highlight timeout also updates CSS classes in place; it no longer tears down a chooser or focused field when the timeout expires.
- Deferred collaboration updates are applied after the protected interaction closes or focus leaves the input, so remote changes are not discarded.

## Version 2.1.5 — Remembered relative popup sizing

- Added a 50–200% relative popup-size slider next to **Reset popup sizes** in the S-menu.
- The down-arrow switches to remembered, independent Image, Equation, and Table popup-size sliders and hides the global slider.
- Changing any relative-size control clears saved ad-hoc popup resize overrides so the selected percentage becomes the new baseline.
- **Reset popup sizes** clears saved manual resize overrides and sets all relative popup-size values to 100% while retaining global/separate control mode.
- Relative popup-size values and the selected global/separate mode are remembered locally.

## Version 2.1.4 — Stable first-click GIPHY consent flow

- The first GIF-button activation is handled immediately so surrounding comment focus/re-render work cannot consume it.
- Accepting the GIPHY privacy notice now continues directly into the GIF chooser.
- GIPHY consent acceptance no longer forces a destructive comments-pane re-render while the chooser is opening.
- The pending GIF target is resolved again after asynchronous consent, so incidental pane re-renders do not invalidate the first click.

## Version 2.1.3 — Graduated shared GIPHY key usage

- The bundled GIPHY key remains available for occasional use without requiring a personal key after five GIFs.
- Insertions 6 through 10 within a rolling 60-minute window show a polite, optional personal-key prompt on each insertion; choosing “Continue with shared key” still inserts the GIF.
- A personal GIPHY API key is required only for insertions after the 10th GIF in a rolling hour, or after 50 total GIF insertions made with the bundled key.
- The quota prompt is tied to actual GIF insertion rather than opening or browsing the GIF picker.
- Choosing to add a personal key opens SmartTeX Options and focuses the GIPHY key field; the existing circular `?` button explains how to obtain a key.

## Version 2.1.2 — Shared GIPHY key and personal-key handoff

- Includes the configured shared GIPHY API key as the default when no personal key is set.
- The shared key permits five GIF insertions per rolling 60-minute window per browser profile.
- A sixth insertion attempt opens a prompt asking the user to configure a personal GIPHY API key and provides a direct route to SmartTeX Options.
- A personal key removes SmartTeX's five-GIF shared-key limit; GIPHY's own API limits still apply.
- The Options key field includes a circular `?` help button with a simple step-by-step overlay explaining how to obtain a GIPHY API key.

## Version 2.1.1 — GIPHY GIF comments

Comment, reply, and comment-edit text fields now include a `GIF` button next to
the emoji button. GIF search uses the GIPHY Web API. A separate GIPHY consent
notice is shown before the first GIPHY API/media request, whether the user first
encounters GIPHY by inserting a GIF or by viewing a GIF inserted by somebody
else. Consent can be withdrawn from SmartTeX options.

The GIPHY API key is configured per browser in **SmartTeX options → GIPHY GIFs
in comments** and is kept in local extension storage; it is not written to the
shared `.smarttex-comments.json` file. Saved comment records contain the GIPHY
ID, returned GIPHY page/embed URLs, dimensions, and available creator/source
attribution metadata. Search rendition URLs are used only transiently and are
not persisted or proxied by SmartTeX.

To configure GIF search, create a GIPHY developer account, open the GIPHY
Developer Dashboard, create an app/API key for a Web API integration, then copy
the resulting key into the SmartTeX option above. This implementation calls the
Web API directly and therefore needs an API key, not a GIPHY SDK key.
