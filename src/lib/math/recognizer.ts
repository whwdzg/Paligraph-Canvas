import { clamp, distance, pointsBounds, unionBounds } from '../geometry';
import type { Bounds, Stroke } from '../types';

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

export interface MathGlyph {
  symbol: string;
  confidence: number;
  bounds: Bounds;
  width: number;
  height: number;
  strokes: Stroke[];
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
  return { symbol, mask, distance: distanceTransform(mask), aspect };
}

function templates(): TemplateMask[] {
  if (templateCache) return templateCache;
  const fonts = [
    '700 34px "Segoe Print", "Ink Free", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", "Segoe UI", sans-serif',
    '600 34px "Segoe UI", "Microsoft YaHei UI", sans-serif',
    '700 33px Georgia, "Times New Roman", serif',
  ];
  const symbols = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '×', '÷', '=', '*'];
  const result: TemplateMask[] = [];
  for (const font of fonts) {
    for (const symbol of symbols) {
      const template = makeTemplate(symbol, font);
      if (template) result.push(template);
    }
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
    const score = chamfer + aspectPenalty;
    const current = scores.get(template.symbol);
    if (current === undefined || score < current) scores.set(template.symbol, score);
  }
  return [...scores.entries()]
    .map(([symbol, score]) => ({ symbol, score }))
    .sort((a, b) => a.score - b.score);
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
      if (overlap.h > -width * 0.12 && overlap.v > -height * 0.12) return { symbol: '+', confidence: 0.86 };
    }
    if (a.diagonal && b.diagonal) {
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
  const best = scores[0];
  const second = scores.find((item) => item.symbol !== best.symbol);
  const separation = second ? Math.max(0, second.score - best.score) : 0.5;
  const confidence = clamp(0.8 - best.score * 0.075 + separation * 0.08, 0.08, 0.97);
  return { symbol: best.symbol, confidence, bounds, width, height, strokes: group.strokes };
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

function rowText(row: MathGlyph[]): string {
  return row.map((glyph) => glyph.symbol).join('');
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
  const isValueEnd = (symbol: string | undefined): boolean => Boolean(symbol && (DIGITS.has(symbol) || symbol === ')' || symbol === 'x'));
  const isValueStart = (symbol: string | undefined): boolean => Boolean(symbol && (DIGITS.has(symbol) || symbol === '(' || symbol === 'x'));
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

  const symbols = rows.flatMap((row) => row.map((glyph) => glyph.symbol));
  const expression = resolveMultiplication(symbols);
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
