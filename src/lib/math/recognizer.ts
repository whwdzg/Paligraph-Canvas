import { clamp, distance, distanceToSegmentSquared, pointsBounds, unionBounds } from '../geometry';
import type { Bounds, InkPoint, Stroke } from '../types';

/**
 * A compact, local handwriting recogniser for arithmetic and one-variable
 * equations. It is intentionally modest: operators are recognised from
 * geometry, digits through normalised bitmap matching against system font
 * skeletons, and the result is always presented in an editable field.
 *
 * No image ever leaves the browser and no ML model or network dependency is
 * involved. Long-press capture is a convenience; the dialog is the source of
 * truth, so a misread digit can be corrected before solving.
 */

const MASK_SIZE = 32;
const GLYPH_CANVAS = 64;
const OPERATORS = new Set(['+', '-', '×', '÷', '=']);
const DIGITS = new Set('0123456789'.split(''));
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const VARIABLES = new Set(LETTERS);
// These letters are routinely confused with digits. Prefer the digit only for
// this small set; x/y/a/c/... should stay letters even when a digit template is
// marginally closer (which is common after bitmap normalisation).
const DIGIT_LOOKALIKE_LETTERS = new Set(['z', 'o', 'l', 'i', 's', 'b', 'g']);
const DESCENDER_LETTERS = new Set(['g', 'j', 'p', 'q', 'y']);
const ASCENDER_LETTERS = new Set(['b', 'd', 'f', 'h', 'k', 'l', 't']);
const HOLED_SYMBOLS = new Set(['a', 'b', 'd', 'e', 'g', 'o', 'p', 'q', '0', '6', '8', '9']);

export interface MathGlyph {
  symbol: string;
  confidence: number;
  bounds: Bounds;
  width: number;
  height: number;
  strokes: Stroke[];
  /** Enclosed background regions (a, b, o, 0...), used for letter disambiguation. */
  holes?: number;
  /** Ranked template candidates, used for row-level letter disambiguation. */
  candidates?: Array<{ symbol: string; score: number }>;
}

export interface VerticalMath {
  operandA: string;
  operator: string;
  operandB: string;
  detectedResult?: string;
  expression: string;
  rows: string[];
}

export interface MathRecognition {
  glyphs: MathGlyph[];
  expression: string;
  layout: 'horizontal' | 'vertical';
  vertical?: VerticalMath;
  confidence: number;
  warnings: string[];
}

interface StrokeSummary {
  bounds: Bounds;
  width: number;
  height: number;
  length: number;
  horizontal: boolean;
  vertical: boolean;
  diagonal: boolean;
  dot: boolean;
}

interface Group {
  strokes: Stroke[];
  bounds: Bounds;
}

interface TemplateMask {
  symbol: string;
  mask: Uint8Array;
  distance: Float32Array;
  aspect: number;
  /** <1 prioritises hand-authored stroke skeletons over system-font outlines. */
  weight: number;
}

let templateCache: TemplateMask[] | null = null;

function unionStrokeBounds(strokes: readonly Stroke[]): Bounds {
  let result: Bounds | null = null;
  for (const stroke of strokes) {
    result = unionBounds(result, pointsBounds(stroke.points));
  }
  return result ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function strokeSummary(stroke: Stroke): StrokeSummary {
  const points = stroke.points;
  const bounds = pointsBounds(points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  const first = points[0];
  const last = points[points.length - 1];
  const direct = Math.hypot(last.x - first.x, last.y - first.y);
  const straight = direct / Math.max(1, length);
  return {
    bounds,
    width,
    height,
    length,
    horizontal: width > Math.max(2, height * 2.3) && straight > 0.72,
    vertical: height > Math.max(2, width * 1.9) && straight > 0.68,
    diagonal: width > 4 && height > 4 && straight > 0.76 && !(width > height * 2.2) && !(height > width * 2.2),
    dot: width < 8 && height < 8 && length < 12,
  };
}

function overlaps(a: Bounds, b: Bounds): { h: number; v: number; hGap: number; vGap: number } {
  const h = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const v = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const hGap = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
  const vGap = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY);
  return { h, v, hGap, vGap };
}

function shouldGroup(a: Group, b: Group): boolean {
  const ab = a.bounds;
  const bb = b.bounds;
  const overlap = overlaps(ab, bb);
  const aw = Math.max(1, ab.maxX - ab.minX);
  const ah = Math.max(1, ab.maxY - ab.minY);
  const bw = Math.max(1, bb.maxX - bb.minX);
  const bh = Math.max(1, bb.maxY - bb.minY);
  const minW = Math.min(aw, bw);
  const minH = Math.min(ah, bh);
  const maxH = Math.max(ah, bh);

  // Crossing strokes, multi-stroke digits and plus signs. A vertical stroke
  // can have zero width, so allow a few pixels of tolerance around the
  // intersection instead of requiring a positive rectangle overlap.
  if (overlap.h + 4 > Math.max(1, minW * 0.28) && overlap.v + 4 > Math.max(1, minH * 0.22)) return true;
  // Two stacked horizontal strokes: equals sign. Both components must be
  // genuinely line-like; otherwise two vertically adjacent rows of a vertical
  // sum would be chained into one giant glyph.
  const aFlat = ah <= Math.max(4, aw * 0.3);
  const bFlat = bh <= Math.max(4, bw * 0.3);
  if (aFlat && bFlat && overlap.h > minW * 0.55 && overlap.vGap <= Math.max(8, Math.min(aw, bw) * 0.5)) return true;
  // Strokes whose bounds barely touch but clearly belong together.
  if (overlap.v > minH * 0.55 && overlap.hGap <= Math.max(2, maxH * 0.045)) return true;

  // Strokes that meet at a shared endpoint are one glyph (y, i, multi-stroke
  // letters). Do not chain two nearby characters that merely have close
  // bounding boxes.
  const endpointsOf = (group: Group): InkPoint[] => {
    const first = group.strokes[0]?.points;
    const last = group.strokes[group.strokes.length - 1]?.points;
    if (!first || !last) return [];
    return [first[0], first[first.length - 1], last[0], last[last.length - 1]];
  };
  const scale = Math.max(aw, ah, bw, bh);
  const tolerance = Math.max(4, scale * 0.06);
  const touching = endpointsOf(a).some((left) =>
    endpointsOf(b).some((right) => distance(left.x, left.y, right.x, right.y) <= tolerance),
  );
  if (touching) return true;

  // A stroke can also land in the middle of another one (the descender of y,
  // the stem of t/f). Check both endpoint sets against the opposite polyline.
  const endpointOnStroke = (endpoints: InkPoint[], group: Group): boolean =>
    endpoints.some((point) =>
      group.strokes.some((stroke) => {
        for (let index = 1; index < stroke.points.length; index += 1) {
          const previous = stroke.points[index - 1];
          const current = stroke.points[index];
          if (distanceToSegmentSquared(point.x, point.y, previous.x, previous.y, current.x, current.y) <= tolerance * tolerance) {
            return true;
          }
        }
        return false;
      }),
    );
  if (endpointOnStroke(endpointsOf(a), b) || endpointOnStroke(endpointsOf(b), a)) return true;

  // A dot directly above a tall stem is the i/j dot, not a separate decimal
  // point. Ordinary decimal points sit on the baseline beside a digit.
  const aDot = aw < 8 && ah < 8;
  const bDot = bw < 8 && bh < 8;
  if (aDot !== bDot) {
    const dot = aDot ? ab : bb;
    const stem = aDot ? bb : ab;
    const stemWidth = Math.max(1, stem.maxX - stem.minX);
    const stemHeight = Math.max(1, stem.maxY - stem.minY);
    const dotCenter = (dot.minX + dot.maxX) / 2;
    const stemCenter = (stem.minX + stem.maxX) / 2;
    const verticalGap = stem.minY - dot.maxY;
    if (
      stemHeight > 12 &&
      stemWidth < stemHeight * 0.9 &&
      Math.abs(dotCenter - stemCenter) < Math.max(7, stemWidth * 0.8) &&
      verticalGap >= -3 &&
      verticalGap < Math.max(12, stemHeight * 0.28)
    ) {
      return true;
    }
  }
  return false;
}

function groupStrokes(strokes: readonly Stroke[]): Group[] {
  const groups: Group[] = strokes
    .filter((stroke) => stroke.tool !== 'eraser' && stroke.points.length)
    .map((stroke) => ({ strokes: [stroke], bounds: pointsBounds(stroke.points) }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (!shouldGroup(groups[i], groups[j])) continue;
        groups[i] = {
          strokes: [...groups[i].strokes, ...groups[j].strokes],
          bounds: unionBounds(groups[i].bounds, groups[j].bounds) as Bounds,
        };
        groups.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return groups;
}

function drawGroupToCanvas(group: Group): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = GLYPH_CANVAS;
  canvas.height = GLYPH_CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const bounds = group.bounds;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((GLYPH_CANVAS - 18) / width, (GLYPH_CANVAS - 18) / height);
  const offsetX = (GLYPH_CANVAS - width * scale) / 2;
  const offsetY = (GLYPH_CANVAS - height * scale) / 2;
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-bounds.minX, -bounds.minY);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of group.strokes) {
    const points = stroke.points;
    ctx.lineWidth = Math.max(stroke.size * 0.7, Math.min(width, height) * 0.06);
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, ctx.lineWidth * 0.55, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  return canvas;
}

function extractMask(canvas: HTMLCanvasElement): { mask: Uint8Array; aspect: number } {
  const ctx = canvas.getContext('2d');
  const fallback = { mask: new Uint8Array(MASK_SIZE * MASK_SIZE), aspect: 1 };
  if (!ctx) return fallback;
  const image = ctx.getImageData(0, 0, GLYPH_CANVAS, GLYPH_CANVAS);
  let minX = GLYPH_CANVAS;
  let minY = GLYPH_CANVAS;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < GLYPH_CANVAS; y += 1) {
    for (let x = 0; x < GLYPH_CANVAS; x += 1) {
      if (image.data[(y * GLYPH_CANVAS + x) * 4 + 3] > 35) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) return fallback;
  const cropWidth = Math.max(1, maxX - minX + 1);
  const cropHeight = Math.max(1, maxY - minY + 1);
  const normalized = document.createElement('canvas');
  normalized.width = GLYPH_CANVAS;
  normalized.height = GLYPH_CANVAS;
  const normCtx = normalized.getContext('2d');
  if (!normCtx) return fallback;
  const fitScale = Math.min((MASK_SIZE - 8) / cropWidth, (MASK_SIZE - 8) / cropHeight);
  const drawWidth = cropWidth * fitScale;
  const drawHeight = cropHeight * fitScale;
  normCtx.drawImage(
    canvas,
    minX,
    minY,
    cropWidth,
    cropHeight,
    (MASK_SIZE - drawWidth) / 2,
    (MASK_SIZE - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  const pixels = normCtx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
  const mask = new Uint8Array(MASK_SIZE * MASK_SIZE);
  for (let i = 0; i < mask.length; i += 1) mask[i] = pixels[i * 4 + 3] > 45 ? 1 : 0;
  return { mask, aspect: cropWidth / cropHeight };
}

function countHoles(mask: Uint8Array, size = MASK_SIZE): number {
  const visited = new Uint8Array(size * size);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const index = y * size + x;
    if (visited[index] || mask[index]) return;
    visited[index] = 1;
    stack.push(index);
  };
  for (let x = 0; x < size; x += 1) {
    push(x, 0);
    push(x, size - 1);
  }
  for (let y = 0; y < size; y += 1) {
    push(0, y);
    push(size - 1, y);
  }
  while (stack.length) {
    const index = stack.pop()!;
    const x = index % size;
    const y = Math.floor(index / size);
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  let holes = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] && !visited[index]) holes += 1;
  }
  return holes;
}

function distanceTransform(mask: Uint8Array, size = MASK_SIZE): Float32Array {
  const distances = new Float32Array(size * size);
  const infinity = 1e7;
  for (let i = 0; i < mask.length; i += 1) distances[i] = mask[i] ? 0 : infinity;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (distances[index] === 0) continue;
      let best = distances[index];
      if (x > 0) best = Math.min(best, distances[index - 1] + 1);
      if (y > 0) {
        best = Math.min(best, distances[index - size] + 1);
        if (x > 0) best = Math.min(best, distances[index - size - 1] + diagonal);
        if (x < size - 1) best = Math.min(best, distances[index - size + 1] + diagonal);
      }
      distances[index] = best;
    }
  }
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = size - 1; x >= 0; x -= 1) {
      const index = y * size + x;
      if (distances[index] === 0) continue;
      let best = distances[index];
      if (x < size - 1) best = Math.min(best, distances[index + 1] + 1);
      if (y < size - 1) {
        best = Math.min(best, distances[index + size] + 1);
        if (x < size - 1) best = Math.min(best, distances[index + size + 1] + diagonal);
        if (x > 0) best = Math.min(best, distances[index + size - 1] + diagonal);
      }
      distances[index] = best;
    }
  }
  return distances;
}

function makeTemplate(symbol: string, font: string): TemplateMask | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = GLYPH_CANVAS;
  canvas.height = GLYPH_CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glyph = symbol === '*' ? '×' : symbol;
  ctx.fillText(glyph, GLYPH_CANVAS / 2, GLYPH_CANVAS / 2 + 1);
  const { mask, aspect } = extractMask(canvas);
  if (!mask.some((value) => value === 1)) return null;
  return { symbol, mask, distance: distanceTransform(mask), aspect, weight: 1 };
}

type SketchPoint = [number, number];

function arcSketch(cx: number, cy: number, rx: number, ry: number, start = 0, end = Math.PI * 2): SketchPoint[] {
  const points: SketchPoint[] = [];
  const steps = 20;
  for (let index = 0; index <= steps; index += 1) {
    const angle = start + ((end - start) * index) / steps;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

/**
 * Handwriting skeletons for lower-case variables. System-font glyphs are
 * usually closed outlines; these open polylines match the way a pen actually
 * draws letters (especially y, a, n and g).
 */
const SKELETONS: Record<string, SketchPoint[][]> = {
  a: [arcSketch(0.4, 0.56, 0.3, 0.25), [[0.7, 0.56], [0.76, 0.8]]],
  b: [[[0.3, 0.08], [0.3, 0.82]], arcSketch(0.55, 0.6, 0.29, 0.23)],
  c: [[[0.72, 0.32], [0.45, 0.3], [0.26, 0.5], [0.3, 0.72], [0.5, 0.84], [0.72, 0.8]]],
  d: [arcSketch(0.45, 0.6, 0.29, 0.23), [[0.75, 0.08], [0.75, 0.82]]],
  e: [[[0.72, 0.5], [0.35, 0.52], [0.25, 0.65], [0.3, 0.8], [0.52, 0.86], [0.72, 0.78]]],
  f: [[[0.66, 0.1], [0.5, 0.58], [0.42, 0.88]], [[0.28, 0.34], [0.7, 0.34]]],
  g: [arcSketch(0.45, 0.5, 0.28, 0.23), [[0.73, 0.5], [0.7, 0.82], [0.55, 0.95]]],
  h: [[[0.28, 0.08], [0.28, 0.82]], [[0.28, 0.46], [0.55, 0.32], [0.7, 0.48], [0.7, 0.82]]],
  i: [[[0.46, 0.12], [0.47, 0.14]], [[0.46, 0.36], [0.46, 0.82]]],
  j: [[[0.58, 0.12], [0.59, 0.14]], [[0.58, 0.36], [0.58, 0.74], [0.48, 0.92]]],
  k: [[[0.3, 0.08], [0.3, 0.82]], [[0.68, 0.38], [0.3, 0.6]], [[0.4, 0.54], [0.72, 0.82]]],
  l: [[[0.42, 0.08], [0.42, 0.82]]],
  m: [[[0.2, 0.36], [0.2, 0.82]], [[0.2, 0.46], [0.35, 0.32], [0.48, 0.46], [0.48, 0.82]], [[0.48, 0.46], [0.63, 0.32], [0.78, 0.46], [0.78, 0.82]]],
  n: [[[0.28, 0.36], [0.28, 0.82]], [[0.28, 0.46], [0.48, 0.32], [0.7, 0.46], [0.7, 0.82]]],
  o: [arcSketch(0.5, 0.58, 0.3, 0.24)],
  p: [[[0.3, 0.38], [0.3, 0.98]], arcSketch(0.55, 0.55, 0.29, 0.23)],
  q: [arcSketch(0.45, 0.55, 0.29, 0.23), [[0.74, 0.55], [0.74, 0.98]]],
  r: [[[0.3, 0.38], [0.3, 0.82]], [[0.3, 0.48], [0.48, 0.34], [0.66, 0.44]]],
  s: [[[0.72, 0.32], [0.5, 0.25], [0.3, 0.34], [0.32, 0.48], [0.5, 0.57], [0.68, 0.65], [0.7, 0.8], [0.5, 0.9], [0.3, 0.83]]],
  t: [[[0.5, 0.1], [0.5, 0.82]], [[0.25, 0.34], [0.75, 0.34]]],
  u: [[[0.28, 0.38], [0.28, 0.7], [0.35, 0.82], [0.54, 0.82], [0.68, 0.7], [0.68, 0.38]]],
  v: [[[0.25, 0.36], [0.5, 0.82], [0.75, 0.36]]],
  w: [[[0.15, 0.36], [0.34, 0.82], [0.5, 0.56], [0.66, 0.82], [0.85, 0.36]]],
  x: [[[0.25, 0.38], [0.75, 0.82]], [[0.75, 0.38], [0.25, 0.82]]],
  y: [[[0.25, 0.36], [0.5, 0.66], [0.75, 0.36]], [[0.5, 0.66], [0.38, 0.96]]],
  z: [[[0.25, 0.4], [0.75, 0.4], [0.25, 0.8], [0.75, 0.8]]],
};

function makeSkeletonTemplate(symbol: string, paths: SketchPoint[][]): TemplateMask | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = GLYPH_CANVAS;
  canvas.height = GLYPH_CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const all = paths.flat();
  const minX = Math.min(...all.map(([x]) => x));
  const maxX = Math.max(...all.map(([x]) => x));
  const minY = Math.min(...all.map(([, y]) => y));
  const maxY = Math.max(...all.map(([, y]) => y));
  const width = Math.max(0.01, maxX - minX);
  const height = Math.max(0.01, maxY - minY);
  const scale = Math.min((GLYPH_CANVAS - 18) / width, (GLYPH_CANVAS - 18) / height);
  const offsetX = (GLYPH_CANVAS - width * scale) / 2;
  const offsetY = (GLYPH_CANVAS - height * scale) / 2;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.6;
  for (const path of paths) {
    ctx.beginPath();
    path.forEach(([x, y], index) => {
      const px = offsetX + (x - minX) * scale;
      const py = offsetY + (y - minY) * scale;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  const { mask, aspect } = extractMask(canvas);
  if (!mask.some((value) => value === 1)) return null;
  return { symbol, mask, distance: distanceTransform(mask), aspect, weight: 0.78 };
}

function templates(): TemplateMask[] {
  if (templateCache) return templateCache;
  const fonts = [
    '700 34px "Segoe Print", "Ink Free", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", "Segoe UI", sans-serif',
    '600 34px "Segoe UI", "Microsoft YaHei UI", sans-serif',
    '700 33px Georgia, "Times New Roman", serif',
  ];
  const symbols = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    '+', '-', '×', '÷', '=', '*', '/', '^', '(', ')', 'Σ', 'π', '√',
    ...LETTERS,
  ];
  const result: TemplateMask[] = [];
  for (const font of fonts) {
    for (const symbol of symbols) {
      const template = makeTemplate(symbol, font);
      if (template) result.push(template);
    }
  }
  for (const symbol of LETTERS) {
    const paths = SKELETONS[symbol];
    if (!paths) continue;
    const template = makeSkeletonTemplate(symbol, paths);
    if (template) result.push(template);
  }
  templateCache = result;
  return result;
}

function compareMasks(user: Uint8Array, userAspect: number): Array<{ symbol: string; score: number }> {
  const userDistance = distanceTransform(user);
  const userCount = user.reduce((sum, value) => sum + value, 0) || 1;
  const scores = new Map<string, number>();
  for (const template of templates()) {
    let userToTemplate = 0;
    let templateToUser = 0;
    let templateCount = 0;
    for (let i = 0; i < user.length; i += 1) {
      if (user[i]) userToTemplate += Math.min(template.distance[i], 6);
      if (template.mask[i]) {
        templateToUser += Math.min(userDistance[i], 6);
        templateCount += 1;
      }
    }
    const chamfer = (userToTemplate / userCount) * 0.62 + (templateToUser / Math.max(1, templateCount)) * 0.38;
    const aspectPenalty = Math.abs(Math.log(Math.max(0.1, userAspect) / Math.max(0.1, template.aspect))) * 0.52;
    const score = (chamfer + aspectPenalty) * template.weight;
    const current = scores.get(template.symbol);
    if (current === undefined || score < current) scores.set(template.symbol, score);
  }
  return [...scores.entries()]
    .map(([symbol, score]) => ({ symbol, score }))
    .sort((a, b) => a.score - b.score);
}

function segmentCrosses(a: Stroke, b: Stroke): boolean {
  if (a.points.length < 2 || b.points.length < 2) return false;
  const a0 = a.points[0];
  const a1 = a.points[a.points.length - 1];
  const b0 = b.points[0];
  const b1 = b.points[b.points.length - 1];
  const cross = (p: InkPoint, q: InkPoint, r: InkPoint): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a0, a1, b0);
  const d2 = cross(a0, a1, b1);
  const d3 = cross(b0, b1, a0);
  const d4 = cross(b0, b1, a1);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Detects the two-stroke "v + descender" shape of a handwritten y. */
function looksLikeY(group: Group): boolean {
  if (group.strokes.length !== 2) return false;
  const bounds = group.bounds;
  const height = Math.max(1, bounds.maxY - bounds.minY);
  let fork: InkPoint | null = null;
  let descender: Stroke | null = null;

  for (const stroke of group.strokes) {
    const points = stroke.points;
    if (points.length < 3) continue;
    let lowIndex = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (points[index].y > points[lowIndex].y) lowIndex = index;
    }
    if (lowIndex === 0 || lowIndex === points.length - 1) continue;
    const start = points[0];
    const end = points[points.length - 1];
    const low = points[lowIndex];
    if (start.y > low.y - height * 0.12 || end.y > low.y - height * 0.12) continue;
    if (!((start.x < low.x && end.x > low.x) || (start.x > low.x && end.x < low.x))) continue;
    fork = low;
    break;
  }
  if (!fork) return false;

  for (const stroke of group.strokes) {
    if (stroke.points.includes(fork)) continue;
    const points = stroke.points;
    if (points.length < 2) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const firstDistance = distance(first.x, first.y, fork.x, fork.y);
    const lastDistance = distance(last.x, last.y, fork.x, fork.y);
    const near = firstDistance < lastDistance ? first : last;
    const far = firstDistance < lastDistance ? last : first;
    if (distance(near.x, near.y, fork.x, fork.y) > Math.max(10, height * 0.18)) continue;
    if (far.y > fork.y + height * 0.12) {
      descender = stroke;
      break;
    }
  }
  return Boolean(descender);
}

function classifyOperators(group: Group): { symbol: string; confidence: number } | null {
  const summaries = group.strokes.map(strokeSummary);
  const bounds = group.bounds;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  if (summaries.length === 1) {
    const only = summaries[0];
    if (only.dot && width < Math.max(6, height * 0.5)) return { symbol: '.', confidence: 0.7 };
    if (only.horizontal && width > height * 3 && width > 12) return { symbol: '-', confidence: 0.88 };
    return null;
  }

  if (summaries.length === 2) {
    const [a, b] = summaries;
    const overlap = overlaps(a.bounds, b.bounds);
    if (a.horizontal && b.horizontal && overlap.h > Math.min(a.width, b.width) * 0.52) {
      return { symbol: '=', confidence: 0.9 };
    }
    if ((a.horizontal && b.vertical) || (a.vertical && b.horizontal)) {
      const horizontal = a.horizontal ? a : b;
      const vertical = a.vertical ? a : b;
      const horizontalCenterX = (horizontal.bounds.minX + horizontal.bounds.maxX) / 2;
      const horizontalCenterY = (horizontal.bounds.minY + horizontal.bounds.maxY) / 2;
      const verticalCenterX = (vertical.bounds.minX + vertical.bounds.maxX) / 2;
      const verticalCenterY = (vertical.bounds.minY + vertical.bounds.maxY) / 2;
      const intersectionInside =
        verticalCenterY >= horizontal.bounds.minY - 3 &&
        verticalCenterY <= horizontal.bounds.maxY + 3 &&
        horizontalCenterX >= vertical.bounds.minX - 3 &&
        horizontalCenterX <= vertical.bounds.maxX + 3;
      const above = horizontalCenterY - vertical.bounds.minY;
      const below = vertical.bounds.maxY - horizontalCenterY;
      const balancedCross =
        Math.min(above, below) / Math.max(1, above, below) > 0.34;
      const crossesNearCenter =
        Math.abs(horizontalCenterX - verticalCenterX) < horizontal.width * 0.34 &&
        Math.abs(verticalCenterY - horizontalCenterY) < vertical.height * 0.24 &&
        balancedCross;
      if (intersectionInside && crossesNearCenter) return { symbol: '+', confidence: 0.86 };
    }
    if (a.diagonal && b.diagonal && segmentCrosses(group.strokes[0], group.strokes[1])) {
      return { symbol: '×', confidence: 0.78 };
    }
  }

  if (summaries.length === 3) {
    const horizontal = summaries.filter((summary) => summary.horizontal);
    const dots = summaries.filter((summary) => summary.dot);
    if (horizontal.length === 1 && dots.length === 2) return { symbol: '÷', confidence: 0.82 };
  }

  return null;
}

function recognizeGroup(group: Group): MathGlyph | null {
  const width = group.bounds.maxX - group.bounds.minX;
  const height = group.bounds.maxY - group.bounds.minY;
  if (width < 0.5 && height < 0.5) return null;
  const bounds = group.bounds;
  if (looksLikeY(group)) {
    return { symbol: 'y', confidence: 0.82, bounds, width, height, strokes: group.strokes };
  }
  const operator = classifyOperators(group);
  if (operator) {
    return { ...operator, bounds, width, height, strokes: group.strokes };
  }
  if (width < 0.5 || height < 0.5) return null;
  const canvas = drawGroupToCanvas(group);
  const { mask, aspect } = extractMask(canvas);
  if (!mask.some((value) => value === 1)) return null;
  const scores = compareMasks(mask, aspect);
  if (!scores.length) return null;
  let best = scores[0];
  // Digits and some lower-case letters (notably 2/z) share a skeleton. Prefer
  // a digit when the score is within a small margin; this keeps ordinary
  // arithmetic reliable while still allowing distinct x/y/z glyphs through.
  const bestDigit = scores.find((item) => DIGITS.has(item.symbol));
  if (
    bestDigit &&
    DIGIT_LOOKALIKE_LETTERS.has(best.symbol) &&
    bestDigit.score <= best.score + 0.1
  ) {
    best = bestDigit;
  }
  const second = scores.find((item) => item.symbol !== best.symbol);
  const separation = second ? Math.max(0, second.score - best.score) : 0.5;
  const confidence = clamp(0.8 - best.score * 0.075 + separation * 0.08, 0.08, 0.97);
  return {
    symbol: best.symbol,
    confidence,
    bounds,
    width,
    height,
    strokes: group.strokes,
    holes: countHoles(mask),
    candidates: scores.slice(0, 7),
  };
}

function rowsFromGlyphs(glyphs: MathGlyph[]): MathGlyph[][] {
  if (!glyphs.length) return [];
  const medianHeight = [...glyphs].sort((a, b) => a.height - b.height)[Math.floor(glyphs.length / 2)].height;
  const rows: MathGlyph[][] = [];
  const sorted = [...glyphs].sort((a, b) => (a.bounds.minY + a.bounds.maxY) / 2 - (b.bounds.minY + b.bounds.maxY) / 2);
  for (const glyph of sorted) {
    const centerY = (glyph.bounds.minY + glyph.bounds.maxY) / 2;
    let row = rows.find((candidate) => {
      const rowCenter = candidate.reduce((sum, item) => sum + (item.bounds.minY + item.bounds.maxY) / 2, 0) / candidate.length;
      return Math.abs(rowCenter - centerY) < Math.max(10, medianHeight * 0.52);
    });
    if (!row) {
      row = [];
      rows.push(row);
    }
    row.push(glyph);
  }
  for (const row of rows) row.sort((a, b) => a.bounds.minX - b.bounds.minX);
  rows.sort((a, b) => {
    const ay = a.reduce((sum, glyph) => sum + glyph.bounds.minY, 0) / a.length;
    const by = b.reduce((sum, glyph) => sum + glyph.bounds.minY, 0) / b.length;
    return ay - by;
  });
  return rows;
}

function candidateScore(glyph: MathGlyph, symbol: string): number {
  return glyph.candidates?.find((candidate) => candidate.symbol === symbol)?.score ?? 9;
}

function bestCandidate(
  glyph: MathGlyph,
  predicate: (symbol: string) => boolean,
  margin = 0.22,
): string | null {
  const current = candidateScore(glyph, glyph.symbol);
  const candidate = glyph.candidates?.find(
    (item) => item.symbol !== glyph.symbol && predicate(item.symbol) && item.score <= current + margin,
  );
  return candidate?.symbol ?? null;
}

/**
 * Template matching is local by nature; this pass uses the whole row's
 * baseline and context to resolve the classic ambiguities: n/0, z/2, a/q and
 * y/r. Descenders must actually descend, and digits inside a letter run are
 * more likely letters.
 */
function resolveRowGlyphs(row: MathGlyph[]): void {
  if (row.length < 2) return;
  const bottoms = row.map((glyph) => glyph.bounds.maxY).sort((a, b) => a - b);
  const baseline = bottoms[Math.floor(bottoms.length / 2)];
  const rowHeight = Math.max(...row.map((glyph) => glyph.height));
  const threshold = Math.max(3, rowHeight * 0.08);
  const heights = row.map((glyph) => glyph.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)];
  const content = row.filter((glyph) => !OPERATORS.has(glyph.symbol) && glyph.symbol !== '.');
  const letterCount = content.filter((glyph) => VARIABLES.has(glyph.symbol)).length;
  const majorityLetters = content.length > 0 && letterCount / content.length >= 0.6;

  for (let index = 0; index < row.length; index += 1) {
    const glyph = row[index];
    if (OPERATORS.has(glyph.symbol) || glyph.symbol === '.') continue;
    const bottom = glyph.bounds.maxY;
    let replacement: string | null = null;

    // A closed loop is strong evidence for a/b/d/o/p/q (and 0/6/8/9). This
    // fixes the common a→n and y→p mistakes before looking at baselines.
    if (glyph.holes !== undefined) {
      if (glyph.holes > 0 && !HOLED_SYMBOLS.has(glyph.symbol)) {
        replacement = bestCandidate(glyph, (symbol) => HOLED_SYMBOLS.has(symbol), 0.3);
      } else if (glyph.holes === 0 && HOLED_SYMBOLS.has(glyph.symbol)) {
        replacement = bestCandidate(glyph, (symbol) => !HOLED_SYMBOLS.has(symbol), 0.24);
      }
    }

    if (!replacement && ASCENDER_LETTERS.has(glyph.symbol) && glyph.height < medianHeight * 1.06) {
      // h/b/d/l/f/k need a tall stem; n/u/m do not.
      replacement = bestCandidate(
        glyph,
        (symbol) => VARIABLES.has(symbol) && !ASCENDER_LETTERS.has(symbol) && !DESCENDER_LETTERS.has(symbol) && !HOLED_SYMBOLS.has(symbol),
        0.24,
      );
    }

    if (!replacement && DESCENDER_LETTERS.has(glyph.symbol) && bottom < baseline - threshold) {
      // It was read as q/p/y but the glyph stays on the baseline.
      replacement = bestCandidate(glyph, (symbol) => VARIABLES.has(symbol) && !DESCENDER_LETTERS.has(symbol));
    } else if (!replacement && !DESCENDER_LETTERS.has(glyph.symbol) && bottom > baseline + threshold) {
      // A real descender was flattened into r/u/… by bitmap normalisation.
      replacement = bestCandidate(glyph, (symbol) => DESCENDER_LETTERS.has(symbol), 0.3);
    }

    if (!replacement && DIGITS.has(glyph.symbol) && majorityLetters) {
      const neighbors = [row[index - 1], row[index + 1]].filter(Boolean);
      const letterNeighbor = neighbors.some((neighbor) => VARIABLES.has(neighbor.symbol));
      if (letterNeighbor) {
        replacement = bestCandidate(glyph, (symbol) => VARIABLES.has(symbol), 0.24);
      }
    }

    if (replacement) {
      glyph.symbol = replacement;
      glyph.confidence = Math.min(glyph.confidence, 0.7);
    }
  }
}

function rowText(row: MathGlyph[]): string {
  let text = '';
  for (let index = 0; index < row.length; index += 1) {
    const glyph = row[index];
    const previous = row[index - 1];
    // A smaller, raised digit after a variable is much more likely an
    // exponent than an implicit product. This is deliberately conservative.
    const superscript =
      previous &&
      (VARIABLES.has(previous.symbol) || previous.symbol === ')') &&
      DIGITS.has(glyph.symbol) &&
      glyph.height < previous.height * 0.74 &&
      glyph.bounds.maxY < previous.bounds.maxY - previous.height * 0.08;
    if (superscript) text += '^';
    text += glyph.symbol;
  }
  return text;
}

/**
 * Loose handwriting often turns log/sin/cos/tan letters into digit lookalikes
 * (l0g, s1n, c0s...). Repair only when the token is directly called, so normal
 * products such as 10g are left untouched.
 */
function repairFunctionNames(text: string): string {
  return text
    .replace(/(?:1|l)(?:0|o)(?:9|g)(?=\()/gi, 'log')
    .replace(/(?:s|5)(?:1|i|l)(?:n|m)(?=\()/gi, 'sin')
    .replace(/c(?:0|o)(?:s|5)(?=\()/gi, 'cos')
    .replace(/(?:7|t)(?:4|a)(?:n|m)(?=\()/gi, 'tan')
    .replace(/(?:1|l)(?:n|m)(?=\()/gi, 'ln');
}

function isSeparatorRow(row: MathGlyph[]): boolean {
  return row.length === 1 && row[0].symbol === '-' && row[0].width > Math.max(40, row[0].height * 8);
}

function verticalFromRows(rows: MathGlyph[][]): VerticalMath | null {
  const dataRows = rows.filter((row) => !isSeparatorRow(row));
  if (dataRows.length < 2) return null;
  const operatorRows = dataRows
    .map((row, index) => ({ row, index, operators: row.filter((glyph) => OPERATORS.has(glyph.symbol) && glyph.symbol !== '=') }))
    .filter((entry) => entry.operators.length > 0);
  if (!operatorRows.length) return null;
  const entry = operatorRows[0];
  if (entry.operators.length > 1) return null;
  const operator = entry.operators[0].symbol;
  const digitsOf = (row: MathGlyph[]): string =>
    row.filter((glyph) => DIGITS.has(glyph.symbol)).map((glyph) => glyph.symbol).join('');

  let operandA = '';
  let operandB = '';
  if (entry.index === 0) {
    // Operator written above the second operand (rare but natural).
    if (dataRows.length < 3) return null;
    operandA = digitsOf(dataRows[1]);
    operandB = digitsOf(dataRows[2]);
  } else {
    operandA = digitsOf(dataRows[entry.index - 1]);
    operandB = digitsOf(dataRows[entry.index]);
  }
  if (!operandA || !operandB) return null;

  const resultIndex = entry.index + 1;
  const detectedResult = digitsOf(dataRows[resultIndex] ?? []);
  const expression = `${operandA}${operator}${operandB}`;
  return {
    operandA,
    operator,
    operandB,
    detectedResult: detectedResult || undefined,
    expression,
    rows: dataRows.map(rowText),
  };
}

/**
 * `×` is ambiguous between multiplication and the variable x. Context makes
 * the distinction: a symbol between two number-like tokens multiplies; a
 * symbol at the start, after an operator, or before an operator is x.
 */
function resolveMultiplication(symbols: string[]): string {
  const isValueEnd = (symbol: string | undefined): boolean =>
    Boolean(symbol && (DIGITS.has(symbol) || symbol === ')' || VARIABLES.has(symbol)));
  const isValueStart = (symbol: string | undefined): boolean =>
    Boolean(symbol && (DIGITS.has(symbol) || symbol === '(' || VARIABLES.has(symbol)));
  return symbols
    .map((symbol, index) => {
      if (symbol !== '×' && symbol !== '*') return symbol;
      const previous = symbols[index - 1];
      const next = symbols[index + 1];
      return isValueEnd(previous) && isValueStart(next) ? '*' : 'x';
    })
    .join('');
}

export function recognizeMathStrokes(strokes: readonly Stroke[]): MathRecognition {
  const usable = strokes.filter((stroke) => stroke.tool !== 'eraser' && stroke.points.length);
  if (typeof document === 'undefined' || !usable.length) {
    return { glyphs: [], expression: '', layout: 'horizontal', confidence: 0, warnings: [] };
  }
  const groups = groupStrokes(usable);
  const glyphs: MathGlyph[] = [];
  for (const group of groups) {
    const glyph = recognizeGroup(group);
    if (glyph) glyphs.push(glyph);
  }
  glyphs.sort((a, b) => (a.bounds.minX === b.bounds.minX ? a.bounds.minY - b.bounds.minY : a.bounds.minX - b.bounds.minX));
  if (!glyphs.length) {
    return { glyphs: [], expression: '', layout: 'horizontal', confidence: 0, warnings: ['No characters found.'] };
  }

  const rows = rowsFromGlyphs(glyphs);
  for (const row of rows) resolveRowGlyphs(row);
  const vertical = rows.length >= 2 && !glyphs.some((glyph) => glyph.symbol === '=') ? verticalFromRows(rows) : null;
  if (vertical) {
    return {
      glyphs,
      expression: vertical.expression,
      layout: 'vertical',
      vertical,
      confidence: glyphs.reduce((sum, glyph) => sum + glyph.confidence, 0) / glyphs.length,
      warnings: glyphs.some((glyph) => glyph.confidence < 0.75) ? ['Low confidence characters; please correct the expression.'] : [],
    };
  }

  // Multiple aligned rows that each contain an equals sign form a system of
  // equations. The editable field uses semicolons as the canonical separator.
  const equationRows = rows.filter((row) => row.some((glyph) => glyph.symbol === '='));
  if (rows.length > 1 && equationRows.length === rows.length) {
    const expression = repairFunctionNames(rows.map(rowText).join(';'));
    return {
      glyphs,
      expression,
      layout: 'horizontal',
      confidence: glyphs.reduce((sum, glyph) => sum + glyph.confidence, 0) / glyphs.length,
      warnings: glyphs.some((glyph) => glyph.confidence < 0.75) ? ['Low confidence characters; please correct the expression.'] : [],
    };
  }

  const symbols = rows.flatMap((row) => row.map((glyph) => glyph.symbol));
  const expression = repairFunctionNames(resolveMultiplication(symbols));
  return {
    glyphs,
    expression,
    layout: 'horizontal',
    confidence: glyphs.reduce((sum, glyph) => sum + glyph.confidence, 0) / glyphs.length,
    warnings: glyphs.some((glyph) => glyph.confidence < 0.75) ? ['Low confidence characters; please correct the expression.'] : [],
  };
}

/** Bounds around a group of strokes, used by the dialog preview. */
export function mathStrokesBounds(strokes: readonly Stroke[]): Bounds {
  return unionStrokeBounds(strokes);
}
