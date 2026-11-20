# Changelog

All notable changes to Paligraph Canvas are documented here. The project follows a simple semantic-ish versioning scheme while the document schema stays at version 1.

## [1.14.0] — 2026-11-21

### Immersive PWA titlebar

- Added `window-controls-overlay` to the manifest `display_override`; installed Chromium PWAs now extend the app header into the native titlebar.
- Added a `useWindowControlsOverlay` hook that tracks titlebar geometry and reserves space for the native window buttons.
- The header is a draggable window region; buttons, the title input and export menu are explicitly non-draggable, and double-clicking the drag region maximises the window.
- Sidebar, editor and canvas are offset below the immersive titlebar; the skeleton loading state respects it too.
- Added `qa:wco`, covering the manifest mode, fixed header, drag/no-drag regions, system-button clearance and normal-browser fallback.

## [1.13.1] — 2026-11-21

### Fixed

- Canvas images can now be resized by dragging any of the four selection-corner handles. Scaling is proportional, keeps the opposite corner fixed, works for single or multiple selected images, and is recorded in undo/redo history.
- Image insertion now switches to the lasso tool automatically so the selected image's handles are immediately draggable instead of starting a pen stroke.
- Dragging a corner of a text block scales the block and its stored font size keeps re-editing consistent.
- Updated the selection hint to “drag to move · corners resize · handle rotates”.
- Added `qa:image-resize`, covering a 192→272 px resize and undo back to 192 px.

## [1.13.0] — 2026-11-21

### Insertable, re-editable text

- Added a header **Insert text** action and a text editor dialog with live preview.
- Supports five font families (sans, serif, mono, handwriting, rounded), sizes 12–96, colour, bold and italic.
- Multi-line text wraps at a readable width and is rendered to a high-DPI PNG block while retaining its text/style metadata.
- Text blocks are selected, moved, rotated, duplicated and deleted like canvas images; the selection toolbar exposes **Edit text** to reopen the same block with its original content and style.
- Editing preserves the block id, rotation and centre position; changing font/size recalculates its bounds.
- Text metadata is stored in `.paligraph` imports/exports and note cards now show a text-block count instead of treating text as an image.
- Added `qa:text`, covering insertion, font/size changes and second editing.

## [1.12.0] — 2026-11-21

### PWA file association

- Added a Web App Manifest `file_handlers` entry for `.paligraph` files using the custom `application/x-paligraph+json` MIME type.
- Added a `launchQueue` consumer that imports launched files into the note library, works for cold starts and for an already-running installed PWA, and supports multiple files.
- Changed editable-note downloads to use the custom MIME type.
- Added a Settings → About note explaining Windows “Open with → Paligraph” and default-app setup.
- Added `qa:pwa-files`, which verifies the manifest handler and simulates a launched file.
- Installed older PWAs may need one reinstall/update before Windows registers the new file type.

## [1.11.1] — 2026-11-21

### Fixed

- After the 620 ms shape hold arms a candidate, small hand jitter (up to 12 screen pixels) no longer cancels the snap or hides the shape hint. Releasing the pen still commits the recognised shape; moving farther than the slop deliberately returns to freehand.
- Added a QA step that moves 5–6 px after the hold and verifies the hint stays armed and the rectangle is committed.

## [1.11.0] — 2026-11-21

### Letter-aware math recognition

- Added all lower-case Latin letters `a–z` to the handwriting templates, plus hand-authored stroke skeletons that match how letters are actually drawn.
- Added row-level context resolution using baseline, letter height, closed-loop holes and stroke topology to disambiguate `a/n`, `y/p/r`, `n/h`, `z/2` and similar pairs.
- Added joined-stroke grouping for dots (`i/j`) and T-junctions (`y`, `t`, `f`) so multi-stroke letters are recognised as one glyph.
- Added repair for handwritten function names such as `log`, `ln`, `sin`, `cos`, `tan` and `exp` when letter templates read a digit lookalike.
- Tightened `+` detection so it no longer steals `t`/`f`-like letters; multiplication-cross detection now requires a true crossing instead of any two diagonals.
- Added `qa:math-letters`; verified `x+y` and `a+n` end-to-end.

### Internal

- 64 unit tests remain green.
- Bumped package/app version to 1.11.0.

## [1.10.2] — 2026-11-20

### Fixed

- Freehand pen/pencil/crayon/brush strokes now commit the exact points and texture seed used by the live preview. Releasing the pointer no longer runs an RDP/pressure re-smoothing pass, so the stroke does not twitch or change shape/texture on lift.
- Straight highlighter and shape-snap paths keep the same preview geometry.
- Added a regression test for preserving live points and seed.

## [1.10.1] — 2026-11-20

### Fixed

- Settings content now fills the dialog correctly and scrolls on small/short viewports instead of being clipped by the modal body.
- Added explicit `min-height: 0` flex/grid constraints, stable scrollbar gutter, contained overscroll and momentum scrolling on touch devices.
- All settings tabs (appearance, canvas, language, data, about) are reachable and scroll independently on a 390 × 640 viewport.

## [1.10.0] — 2026-11-20

### Richer ink textures

- Pen now has a soft edge bleed, dense body and darker moist core.
- Pencil uses clipped graphite dust, short directional flecks and a tooth body instead of long crossing lines.
- Crayon uses broad wax bands, chipped waxy dashes and coarse pigment dust.
- Brush adds continuous bristle grooves, light dry-brush highlights and a darker spine.
- Texture colour is shaded from the ink colour so grooves remain visible on opaque strokes; all texture is clipped inside the ribbon and never floats outside the caps.

### Shape library polish

- The insert-shape popover now has 20 px rounded corners, a stronger frosted-glass blur and a solid fallback when liquid glass is disabled.

### Coordinate grid

- The axes background now draws a full straight-line criss-cross grid.
- At 600% zoom the minor grid stays at 1 world unit; every fifth line is a major grid line with a numbered label, plus unit ticks on the axes.
- Labels remain readable while the 1-unit grid is visible.

### Internal

- Added `traceRibbon` path reuse for clipped texture passes; 63 tests remain green.
- Bumped package/app version to 1.10.0.

## [1.9.1] — 2026-11-20

### Fixed

- Pen, brush, pencil and crayon start/end caps were drawn around the offset ribbon edge instead of the actual input endpoint, shifting the first/last few pixels sideways. Caps are now true semicircles centred on the endpoint.
- Grain/bristle passes no longer begin or end outside the tip cap, removing detached-looking specks at stroke ends.
- The first and last cross-section is kept symmetrical so tapered tips close cleanly at every zoom level and DPR.

## [1.9.0] — 2026-11-20

### Shapes and shape library

- Shape correction now recognises five-point stars, diamonds, perfect circles, squares, equilateral triangles, check marks and crosses, in addition to lines, rectangles, ellipses and triangles.
- Added an **Insert shape** button to the floating toolbar with 14 common shapes: line, arrow, rectangle, square, ellipse, circle, triangle, equilateral triangle, diamond, star, pentagon, hexagon, check and cross.
- Inserted shapes use the current ink colour/width/texture, are placed at the viewport centre and selected immediately for moving, rotating or deleting.
- Crosses are rendered as two independent diagonals; check marks and arrows use open paths. All shapes export correctly to SVG and `.paligraph`.

### Coordinate-axis background

- Added a **math axes** paper pattern with numbered ticks, origin `O`, and labelled positive x/y direction arrows.
- Axes are generated in screen space and remain crisp while panning/zooming; they are included in PNG/PDF/SVG exports and note thumbnails.
- Added a coordinate-axis preview tile and explanatory hint to the background panel.
- Shape/paper selection is preserved by `.paligraph` and settings import validation.

### Internal

- Added `createShapePoints`, open/closed shape handling, new recogniser tests, and `qa:shapes-library`.
- 63 unit tests total.
- Bumped package/app version to 1.9.0.

## [1.8.0] — 2026-11-20

### Selection-based math recognition

- Handwritten math is now recognised by selecting the formula with the lasso and pressing the math button in the selection toolbar. The old long-press shortcut has been removed.
- The recogniser now includes common variables (`x/y/z/a/b/c/n/t`), powers, parentheses, `Σ`, `π`, `√` and multi-row detection for systems of equations.
- Raising a smaller digit after a variable is treated as a power where the geometry is unambiguous.
- Math dialog examples can be inserted with one click.

### Advanced math engine

- Replaced the tiny linear parser with a lazy Math.js-backed engine.
- Supports one-variable linear equations and numeric real roots (quadratic, logarithmic, exponential), linear systems such as `x+y=5; x-y=1`, symbolic derivatives, finite sums, logarithms/exponents and variable expression simplification.
- `log10`/`log2` and LaTeX-style fractions, roots and summation notation are normalised before solving.
- Math.js and its 192 KB gzip chunk load only when the math dialog opens.

### Internal

- Added selection-toolbar math action, recognizer templates, advanced solver tests and updated math QA.
- Bumped package/app version to 1.8.0.

## [1.7.0] — 2026-11-20

### Local backup reminder

- Notes with more than **100 ink strokes** now show a compact `Back up · N` chip in the editor header.
- The first time a note crosses the threshold in a session, a reminder explains that browsers may clear local IndexedDB data and recommends exporting an editable file.
- Clicking the chip downloads the current note as a lossless `.paligraph` file; eraser masks are excluded from the visible-stroke count.
- Reminders are per note and reset if the note falls back below the threshold.

### Internal

- Added `backup.ts` helpers and threshold tests (59 total).
- Added `qa:backup` browser QA with a synthetic 101-stroke note.
- Bumped package/app version to 1.7.0.

## [1.6.0] — 2026-11-20

### Ink and style polish

- Pressure input is now smoothed with a two-sided filter, removing sensor spikes while preserving deliberate pressure changes and the stroke endpoints.
- Pen and brush ribbons taper gently at both ends instead of ending as constant-width tubes.
- Brush strokes gain two subtle bristle hairs; the highlighter gains a faint wider bleed pass; pencil and crayon grain remains deterministic.
- The pen options panel now shows a live canvas ink preview rendered by the real `drawStroke` pipeline, including colour, width, pressure, taper and texture.
- Refined brush tile selection, tool active states, colour swatches and preview surfaces.

### Internal

- Added `StrokePreview`, pressure smoothing and renderer taper/bristle passes.
- Added a pressure-smoothing unit test (57 total).
- Bumped package/app version to 1.6.0.

## [1.5.0] — 2026-11-20

### Installable PWA

- Added a Vite PWA/Workbox build: generated `sw.js`, precache manifest, automatic registration and offline app-shell support.
- Precache includes all JS/CSS chunks, locales, icons, KaTeX fonts and the manifest (~2.3 MB on first install).
- Added a shared install controller for Chrome/Edge `beforeinstallprompt`, iOS Home Screen detection and installed/standalone state.
- Sidebar shows a dismissible install prompt when installation is available; Settings → About shows install status plus iOS/desktop instructions.
- Install prompt can be opened directly from the sidebar guide; installed state hides the prompt.
- `autoUpdate` keeps the offline cache current after deployment.

### Manifest

- Added a stable PWA `id`, standalone display override, launch handler, language/direction metadata and existing shortcuts/icons.
- Service Worker base/scope adapts to `/Paligraph-Canvas/` on GitHub Pages and `/` locally.

### Internal

- Added `usePwaInstall`, PWA prompt/card components and `vite-plugin-pwa`.
- Added `qa:pwa` browser QA for service worker control, manifest, simulated install choice and offline reload.
- Bumped package/app version to 1.5.0.

## [1.4.0] — 2026-11-20

### Note library: folders and multi-select

- Nested folders with create, rename and delete. Deleting a folder moves its notes and subfolder contents to the parent instead of deleting them.
- Folder tree with counts, collapse/expand, and automatic expansion of imported hierarchies.
- New notes are created inside the currently selected folder.
- Multi-select mode in the note list: toggle notes, select all visible notes, bulk move to a folder, or bulk delete with confirmation.
- Note three-dot menu now includes Move to folder and exports for PDF, Markdown, PNG, SVG and `.paligraph`.
- IndexedDB upgraded to schema version 2 with a separate `folders` object store; existing notes migrate transparently.

### Obsidian and LaTeX

- Obsidian/Markdown imports retain their original relative directory paths and create the corresponding nested folders, reusing existing names on re-import.
- Markdown reading cards render LaTeX via KaTeX: `$...$`, `$$...$$`, `\(...\)` and `\[...\]`, with code blocks and inline code excluded.
- KaTeX and its CSS/fonts load only with the lazy Markdown renderer.

### Internal

- Added `folders.ts`, folder dialogs, bulk selection UI and folder-aware storage helpers.
- Added unit tests for folder trees, Obsidian folder paths and KaTeX output (56 total).
- Bumped package/app version to 1.4.0.

## [1.3.0] — 2026-11-20

### Storage usage

- **Settings → Data & backup** now reports browser storage used, quota and the persisted/best-effort state.
- Gives a note-data breakdown for ink strokes, canvas images, Markdown text, Markdown attachments, note previews, settings and language packs.
- Shows note and canvas-image counts and supports a manual refresh.
- Handles browsers without the Storage API, private-mode failures and unavailable quota information gracefully.
- Uses a pure, unit-tested note-size estimator; browser totals remain an estimate including caches.

### Internal

- Added `storageUsage.ts` and byte formatting in `format.ts`.
- Added 2 unit tests (52 total).
- Bumped package/app version to 1.3.0.

## [1.2.0] — 2026-11-20

### Canvas images

- Insert PNG, JPEG, WebP, GIF and SVG into any existing note, including notes imported from Markdown/Obsidian.
- Images are first-class canvas objects layered between the paper and ink: direct click or lasso selection, move, free rotation, 90° rotation, copy, duplicate, paste, delete and undo/redo.
- Image operations share the document history with strokes, including undo after deletion and cross-note paste.
- Raster images are normalised to WebP and capped at 2400 px on the long edge; SVG stays vector. Limits: 12 per batch, 40 per note, 18 MB per source file.
- Note-list previews now render placed images as well as ink.

### Export and import

- Added **PNG** export of the canvas content at content bounds.
- Added **SVG** export with vector strokes and shapes, embedded images, background patterns and pixel-eraser masks.
- Added the **`.paligraph` editable note** format: lossless JSON containing Markdown, strokes, images, background and attachments.
- The import dialog opens `.paligraph` files; the exported PNG/SVG can be inserted back as images.
- PNG/SVG entries are lazily loaded from the export menu; editable files are pure local JSON.

### Internal

- Added `media.ts` (image import/normalisation, decode cache, transforms), `editable.ts` (validated lossless format) and an image layer in the canvas renderer.
- History now snapshots both strokes and images.
- Added 7 unit tests for editable files and image geometry (50 total).
- Bumped package/app version to 1.2.0.

## [1.1.0] — 2026-11-20

### Shape correction

- Draw a line, rectangle, circle/ellipse or triangle, keep the pen still for ~620 ms and release to snap the rough ink to clean geometry.
- Live “shape recognized” preview and undoable corrected strokes.
- Shape intent is stored on the stroke and re-rendered crisply after pan, zoom, selection, rotation, export and reload.
- Shape correction can be disabled in **Settings → Appearance → Pen and touch**.

### Handwriting maths

- Long-press existing ink (~560 ms) to capture the nearby handwriting cluster.
- Local, offline recognizer for digits, `+ − × ÷`, `=`, and the variable `x`, using geometric operator detection plus normalised font-skeleton bitmap matching.
- Editable expression field with live solving for arithmetic and one-variable linear equations, including parentheses, decimals and implicit multiplication.
- Detects simple vertical arithmetic layout and provides an optional aligned column working view.
- Handwriting preview, per-character confidence chips and a low-confidence warning.
- Math recognition can be disabled independently in settings.

### Imported note previews

- Markdown and Obsidian notes now generate actual content thumbnails in the note list: title, excerpt and the first referenced vault image as a cropped cover.
- Preview generation runs in a bounded background worker pool after import, so large vaults stay responsive.
- Thumbnail aspect ratio and card layout tuned for the new 16:10 previews.

### Internal

- Added `shapes.ts` geometry recognition, `math/solver.ts`, `math/recognizer.ts`, `MathDialog`, shape hold gesture, math hold gesture and 12 new unit tests (43 total).
- Bumped package/app version to 1.1.0.

## [1.0.0] — 2026-11-19

First public release.

### Canvas

- Infinite, vector-backed canvas with independent world/view transforms.
- Pen, pencil, crayon and brush engines with pressure-sensitive strokes.
- Freehand and straight-line highlighter modes, custom colours and widths.
- Object eraser (whole stroke) and pixel eraser (`destination-out` masks), plus clear-canvas confirmation.
- Lasso selection with move, free rotation, 90° rotation, copy, duplicate, delete, paste and keyboard shortcuts.
- Undo/redo history for all document mutations.
- Deliberate two-finger long-press navigation (260 ms) with pinch zoom; quick two-finger taps are ignored.
- Stylus support: pressure, coalesced events, palm rejection and barrel-button eraser.
- Zoom HUD, fit-to-content, view reset and wheel/trackpad navigation.

### Notes and imports

- Local-first note library stored in IndexedDB, with debounced saves, relative timestamps and vector thumbnails.
- First-run welcome note with an original ink illustration.
- Import one or more Markdown files, an Obsidian vault folder, or drag-and-drop files/folders.
- Obsidian wiki links, embeds, highlights and callouts normalised for the reading card.
- Small image attachments inlined per-note; limits protect browser memory.
- Markdown source drawer with reading time, word count and apply/export actions.

### Export

- Markdown export preserving the original source; canvas notes get an embedded ink snapshot.
- A4 PDF export with on-demand jsPDF loading, system-font Markdown layout (CJK-safe), checklist rendering and a separate ink-annotation page when needed.
- Safe filenames and download progress states.

### Design and settings

- Fluent Design Sun Valley visual system with optional liquid glass and solid fallback.
- Light / dark / system themes, reduced motion and configurable glass surfaces.
- Background patterns: blank, grid, dots, ruled; solid/dashed lines, spacing, opacity and tint.
- Versioned settings JSON import/export with clamping and unknown-key tolerance.
- JSON language-pack import, built-in zh-CN / zh-TW / en / ja locales and English fallback.
- Responsive layouts for desktop, tablet and mobile, including an accessible mobile sidebar.
- Custom Fluent-style app icon, favicon, Apple touch icon and maskable PWA icon.

### Performance and delivery

- Lazy chunks for Markdown, Obsidian scanning, import UI and PDF generation.
- Locale prefetch handed directly from the boot script to React.
- Manual vendor chunks and long-term cacheable assets.
- DPR/area/memory-aware canvas resolution and viewport culling.
- GitHub Actions workflow for type-check, tests, build and GitHub Pages deployment under `/Paligraph-Canvas/`.
- 31 unit tests plus Playwright-based visual/interaction QA scripts.
