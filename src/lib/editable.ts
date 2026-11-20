import { clamp } from './geometry';
import { createId } from './strokes';
import { isTextFontId } from './textImage';
import type { BackgroundSettings, InkPoint, Note, NoteImage, NoteTextStyle, ShapeKind, Stroke } from './types';

/**
 * Paligraph's lossless, editable note file.
 *
 * It is plain JSON, contains the complete Markdown source, vector strokes,
 * background and imported canvas images, and can be parsed again without any
 * sidecar files. Data URLs make the file self-contained at the cost of size.
 */
export const EDITABLE_FORMAT = 'paligraph-note';
export const EDITABLE_VERSION = 1;

export type ImportedNote = Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'thumbnail'>;

export interface EditableFile {
  format: typeof EDITABLE_FORMAT;
  version: number;
  exportedAt: string;
  note: {
    title: string;
    markdown: string;
    sourcePath?: string;
    assets?: Record<string, string>;
    strokes: Stroke[];
    images: NoteImage[];
    background: BackgroundSettings;
  };
}

const SHAPES = new Set<ShapeKind>([
  'line', 'arrow', 'rectangle', 'square', 'ellipse', 'circle', 'triangle',
  'equilateralTriangle', 'diamond', 'star', 'pentagon', 'hexagon', 'check', 'cross',
]);
const TOOLS = new Set(['pen', 'highlighter', 'eraser']);
const VARIANTS = new Set(['pen', 'pencil', 'crayon', 'brush', 'highlighter', 'pixel']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function point(value: unknown): InkPoint | null {
  const raw = record(value);
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  return { x: raw.x, y: raw.y, p: clamp(finite(raw.p, 0.5), 0, 1) };
}

function normalizeStroke(value: unknown): Stroke | null {
  const raw = record(value);
  const tool = typeof raw.tool === 'string' && TOOLS.has(raw.tool) ? raw.tool : null;
  const variant = typeof raw.variant === 'string' && VARIANTS.has(raw.variant) ? raw.variant : null;
  if (!tool || !variant || !Array.isArray(raw.points)) return null;
  const points = raw.points.map(point).filter((item): item is InkPoint => Boolean(item)).slice(0, 24000);
  if (!points.length) return null;
  const shape = typeof raw.shape === 'string' && SHAPES.has(raw.shape as ShapeKind) ? raw.shape as ShapeKind : undefined;
  return {
    id: createId('imported-stroke'),
    tool: tool as Stroke['tool'],
    variant: variant as Stroke['variant'],
    color: color(raw.color, '#1f6feb'),
    size: clamp(finite(raw.size, 4), 0.5, 96),
    opacity: clamp(finite(raw.opacity, 1), 0.05, 1),
    points,
    seed: finite(raw.seed, Math.floor(Math.random() * 1e9)),
    createdAt: finite(raw.createdAt, Date.now()),
    shape,
    mode: raw.mode === 'straight' ? 'straight' : raw.mode === 'free' ? 'free' : undefined,
  };
}

function normalizeTextStyle(value: unknown): NoteTextStyle | undefined {
  const raw = record(value);
  if (typeof raw.text !== 'string' || !raw.text.trim()) return undefined;
  return {
    text: raw.text.slice(0, 2000),
    fontId: typeof raw.fontId === 'string' && isTextFontId(raw.fontId) ? raw.fontId : 'sans',
    fontSize: Math.round(clamp(finite(raw.fontSize, 28), 10, 120)),
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : '#1f2937',
    bold: Boolean(raw.bold),
    italic: Boolean(raw.italic),
  };
}

function normalizeImage(value: unknown): NoteImage | null {
  const raw = record(value);
  if (typeof raw.src !== 'string' || !raw.src.startsWith('data:image/')) return null;
  const width = clamp(finite(raw.width, 320), 4, 20000);
  const height = clamp(finite(raw.height, 240), 4, 20000);
  return {
    id: createId('image'),
    src: raw.src,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 240) : 'Imported image',
    mime: typeof raw.mime === 'string' ? raw.mime : 'image/png',
    x: finite(raw.x),
    y: finite(raw.y),
    width,
    height,
    rotation: finite(raw.rotation),
    text: normalizeTextStyle(raw.text),
  };
}

function normalizeBackground(value: unknown): BackgroundSettings {
  const raw = record(value);
  const patterns = new Set(['blank', 'grid', 'dots', 'ruled', 'axes']);
  const lines = new Set(['solid', 'dashed']);
  return {
    pattern: typeof raw.pattern === 'string' && patterns.has(raw.pattern) ? raw.pattern as BackgroundSettings['pattern'] : 'grid',
    lineStyle: typeof raw.lineStyle === 'string' && lines.has(raw.lineStyle) ? raw.lineStyle as BackgroundSettings['lineStyle'] : 'solid',
    spacing: Math.round(clamp(finite(raw.spacing, 32), 8, 160)),
    opacity: clamp(finite(raw.opacity, 0.14), 0, 0.6),
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '',
  };
}

export function serializeEditableNote(note: Note): string {
  const document: EditableFile = {
    format: EDITABLE_FORMAT,
    version: EDITABLE_VERSION,
    exportedAt: new Date().toISOString(),
    note: {
      title: note.title,
      markdown: note.markdown,
      sourcePath: note.sourcePath,
      assets: note.assets,
      strokes: note.strokes,
      images: note.images ?? [],
      background: note.background,
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseEditableNoteJson(source: string): ImportedNote {
  if (source.length > 45 * 1024 * 1024) throw new Error('The file is too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = record(parsed);
  const note = root.format === EDITABLE_FORMAT
    ? record(root.note)
    : root.note && typeof root.note === 'object' ? record(root.note) : root;
  if (!note || Array.isArray(note) || typeof note !== 'object') throw new Error('No Paligraph note was found.');
  const version = finite(root.version, EDITABLE_VERSION);
  if (root.format === EDITABLE_FORMAT && version > EDITABLE_VERSION) {
    throw new Error(`Unsupported editable note version ${version}.`);
  }
  const strokesRaw = Array.isArray(note.strokes) ? note.strokes : [];
  const imagesRaw = Array.isArray(note.images) ? note.images : [];
  const strokes = strokesRaw.map(normalizeStroke).filter((stroke): stroke is Stroke => Boolean(stroke)).slice(0, 12000);
  const images = imagesRaw.map(normalizeImage).filter((image): image is NoteImage => Boolean(image)).slice(0, 300);
  const markdown = typeof note.markdown === 'string' ? note.markdown : '';
  const title = typeof note.title === 'string' && note.title.trim() ? note.title.trim().slice(0, 160) : 'Imported note';
  if (!strokes.length && !images.length && !markdown.trim()) {
    throw new Error('The note is empty or unsupported.');
  }
  const assetsRaw = record(note.assets);
  const assets: Record<string, string> = {};
  for (const [key, value] of Object.entries(assetsRaw)) {
    if (typeof value === 'string' && value.startsWith('data:image/') && key.length < 500) assets[key] = value;
  }
  return {
    title,
    markdown,
    sourcePath: typeof note.sourcePath === 'string' ? note.sourcePath.slice(0, 1000) : undefined,
    assets: Object.keys(assets).length ? assets : undefined,
    strokes,
    images,
    background: normalizeBackground(note.background),
  };
}

export { normalizeStroke, normalizeImage };
