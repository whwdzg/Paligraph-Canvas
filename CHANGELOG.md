# Changelog

All notable changes to Paligraph Canvas are documented here. The project follows a simple semantic-ish versioning scheme while the document schema stays at version 1.

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
