/**
 * Shared domain types for Paligraph Canvas.
 *
 * The drawing document is deliberately plain JSON: every point, stroke and
 * note can be serialised to IndexedDB, exported in a backup or moved between
 * versions without a migration layer. Rendering consumes these types but never
 * mutates them in place, which keeps undo/redo and persistence predictable.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export type PenVariant = 'pen' | 'pencil' | 'crayon' | 'brush';
export type InkTool = 'pen' | 'highlighter' | 'eraser' | 'lasso';
export type HighlighterMode = 'free' | 'straight';
export type EraserMode = 'stroke' | 'pixel';
export type PaperPattern = 'blank' | 'grid' | 'dots' | 'ruled' | 'axes';
export type PaperLineStyle = 'solid' | 'dashed';
export type ShapeKind =
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'square'
  | 'ellipse'
  | 'circle'
  | 'triangle'
  | 'equilateralTriangle'
  | 'diamond'
  | 'star'
  | 'pentagon'
  | 'hexagon'
  | 'check'
  | 'cross';

export interface InkPoint {
  /** World-space coordinates. */
  x: number;
  y: number;
  /** Normalised PointerEvent pressure. Mouse and touch report 0.5. */
  p: number;
}

export interface Stroke {
  id: string;
  /** Pen and highlighter are visible ink; eraser with `pixel` variant is a mask. */
  tool: 'pen' | 'highlighter' | 'eraser';
  variant: PenVariant | 'highlighter' | 'pixel';
  color: string;
  /** Nominal brush diameter in world units. */
  size: number;
  /** 0–1. Highlighter uses this value for its translucent pass. */
  opacity: number;
  points: InkPoint[];
  /** Stable seed makes pencil/crayon grain deterministic between redraws. */
  seed: number;
  mode?: HighlighterMode;
  /** Set after hold-to-correct so exports and redraws keep the clean geometry. */
  shape?: ShapeKind;
  createdAt: number;
}

export interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type FolderFilter = 'all' | 'uncategorized' | string;
export type NoteExportFormat = 'pdf' | 'markdown' | 'png' | 'svg' | 'editable';

export interface NoteTextStyle {
  text: string;
  fontId: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

export interface NoteImage {
  id: string;
  /** Data URL. Small raster imports are normalised to WebP; SVG is preserved. */
  src: string;
  name: string;
  mime: string;
  /** Top-left before rotation, in world coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise radians around the image centre. */
  rotation: number;
  /** Present when this image is a re-editable text block. */
  text?: NoteTextStyle;
}

export interface BackgroundSettings {
  pattern: PaperPattern;
  lineStyle: PaperLineStyle;
  /** World-space distance between grid lines / dots / ruled lines. */
  spacing: number;
  /** 0–0.6; the canvas clamps this while rendering. */
  opacity: number;
  /** Optional tint. Empty means "derive from the active theme". */
  color: string;
}

export interface Note {
  id: string;
  title: string;
  /** Optional Obsidian/Markdown source attached to the note. */
  markdown: string;
  /** Vault-relative path shown in the note metadata, when imported. */
  sourcePath?: string;
  /** Small image attachments referenced by the Markdown, as data URLs. */
  assets?: Record<string, string>;
  /** Folder in the note library; absent/null means uncategorized. */
  folderId?: string | null;
  strokes: Stroke[];
  /** Images placed directly on the canvas (not Markdown embeds). */
  images?: NoteImage[];
  background: BackgroundSettings;
  createdAt: number;
  updatedAt: number;
  /** Small data URL generated after edits, used by the note list. */
  thumbnail?: string;
  /** Bumped when the storage shape changes. */
  schemaVersion: number;
}

export interface ViewTransform {
  /** Screen pixels per world unit. */
  scale: number;
  /** Screen position of world origin. */
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Selection {
  ids: string[];
  imageIds: string[];
  bounds: Bounds;
  /** Current rotation, in radians, used by the selection overlay. */
  rotation: number;
}

export interface ViewportSize {
  width: number;
  height: number;
  dpr: number;
}

export interface LanguagePack {
  code: string;
  label: string;
  nativeLabel?: string;
  file: string;
  translations?: Record<string, string>;
  source?: 'builtin' | 'imported';
}

export interface ImportedLanguagePack {
  code: string;
  label: string;
  nativeLabel?: string;
  translations: Record<string, string>;
  importedAt: number;
}

export interface Settings {
  theme: ThemeChoice;
  language: string;
  liquidGlass: boolean;
  reduceMotion: boolean;
  palmRejection: boolean;
  shapeRecognition: boolean;
  mathRecognition: boolean;
  /** Multiplier applied to pressure deviation from neutral. */
  pressureStrength: number;
  pressureSensitivity: number;
  /** Infer pressure from speed/pauses when the device reports none. */
  pressureAlgorithm: boolean;
  penVariant: PenVariant;
  penColor: string;
  penSize: number;
  highlighterColor: string;
  highlighterSize: number;
  highlighterMode: HighlighterMode;
  eraserMode: EraserMode;
  eraserSize: number;
  defaultBackground: BackgroundSettings;
  showCanvasHints: boolean;
}

export interface SettingsJsonDocument {
  version: number;
  settings: Settings;
}
