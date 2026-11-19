import {
  boundsCenter,
  boundsIntersect,
  clamp,
  distanceToSegmentSquared,
  expandBounds,
  pointInPolygon,
  pointsBounds,
  rotatePoint,
  simplifyPoints,
  unionBounds,
} from './geometry';
import { imageBounds, imageCenter, imageCorners } from './media';
import type { Bounds, EraserMode, InkPoint, NoteImage, PenVariant, Selection, Stroke } from './types';

/** Unique enough for local documents; no crypto dependency on older webviews. */
export function createId(prefix = 's'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export interface StrokeHitOptions {
  /** Extra world-space slop so a finger can pick a thin line comfortably. */
  slop?: number;
  /** Only test points within the viewport bounds. */
  viewport?: Bounds;
}

export function strokeBounds(stroke: Stroke): Bounds {
  return expandBounds(pointsBounds(stroke.points), stroke.size * 0.75 + 1);
}

export function hitTestStroke(stroke: Stroke, x: number, y: number, options: StrokeHitOptions = {}): boolean {
  if (stroke.tool === 'eraser') return false;
  const bounds = strokeBounds(stroke);
  if (x < bounds.minX - (options.slop ?? 0) || x > bounds.maxX + (options.slop ?? 0)) return false;
  if (y < bounds.minY - (options.slop ?? 0) || y > bounds.maxY + (options.slop ?? 0)) return false;
  const radius = stroke.size / 2 + (options.slop ?? 0);
  const radiusSq = radius * radius;
  const points = stroke.points;
  if (points.length === 1) {
    const dx = points[0].x - x;
    const dy = points[0].y - y;
    return dx * dx + dy * dy <= radiusSq;
  }
  for (let i = 1; i < points.length; i += 1) {
    if (distanceToSegmentSquared(x, y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) <= radiusSq) {
      return true;
    }
  }
  return false;
}

/**
 * Stroke eraser intersection. Sampling every point plus segment midpoints is
 * deliberately conservative: once a stroke is touched, the whole stroke goes
 * away, which is the behaviour of Apple Notes' object eraser.
 */
export function strokeIntersectsEraser(stroke: Stroke, eraserPoints: readonly InkPoint[], radius: number): boolean {
  if (stroke.tool === 'eraser' || !stroke.points.length) return false;
  const bounds = expandBounds(strokeBounds(stroke), radius);
  for (const eraserPoint of eraserPoints) {
    if (!boundsIntersect(bounds, { minX: eraserPoint.x, minY: eraserPoint.y, maxX: eraserPoint.x, maxY: eraserPoint.y })) {
      continue;
    }
    if (hitTestStroke(stroke, eraserPoint.x, eraserPoint.y, { slop: radius })) return true;
  }
  return false;
}

/** Returns visible, non-eraser strokes currently under the lasso polygon. */
export function strokesInLasso(
  strokes: readonly Stroke[],
  polygon: readonly InkPoint[],
  hiddenIds: ReadonlySet<string> = new Set(),
): string[] {
  if (polygon.length < 3) return [];
  const polygonBounds = pointsBounds(polygon);
  const ids: string[] = [];
  for (const stroke of strokes) {
    if (stroke.tool === 'eraser' || hiddenIds.has(stroke.id) || !stroke.points.length) continue;
    if (!boundsIntersect(strokeBounds(stroke), polygonBounds)) continue;
    // Sample densely enough to catch long strokes with sparse input points.
    const sample = sampleStrokePoints(stroke.points, 32);
    if (sample.some((point) => pointInPolygon(point.x, point.y, polygon))) ids.push(stroke.id);
  }
  return ids;
}

/** Evenly samples a polyline while preserving both endpoints. */
export function sampleStrokePoints(points: readonly InkPoint[], maximum: number): InkPoint[] {
  if (points.length <= maximum) return [...points];
  const stride = (points.length - 1) / (maximum - 1);
  const result: InkPoint[] = [];
  for (let i = 0; i < maximum; i += 1) {
    result.push(points[Math.round(i * stride)]);
  }
  return result;
}

export function boundsForStrokes(strokes: readonly Stroke[], ids?: ReadonlySet<string>): Bounds | null {
  let bounds: Bounds | null = null;
  for (const stroke of strokes) {
    if (ids && !ids.has(stroke.id)) continue;
    if (stroke.tool === 'eraser') continue;
    bounds = unionBounds(bounds, strokeBounds(stroke));
  }
  return bounds;
}

export function boundsForImages(images: readonly NoteImage[], ids?: ReadonlySet<string>): Bounds | null {
  let bounds: Bounds | null = null;
  for (const image of images) {
    if (ids && !ids.has(image.id)) continue;
    bounds = unionBounds(bounds, imageBounds(image));
  }
  return bounds;
}

export function imagesInLasso(
  images: readonly NoteImage[],
  polygon: readonly InkPoint[],
): string[] {
  if (polygon.length < 3) return [];
  const ids: string[] = [];
  for (const image of images) {
    const center = imageCenter(image);
    if (pointInPolygon(center.x, center.y, polygon)) {
      ids.push(image.id);
      continue;
    }
    if (imageCorners(image).some((corner) => pointInPolygon(corner.x, corner.y, polygon))) {
      ids.push(image.id);
    }
  }
  return ids;
}

export function makeSelection(
  strokes: readonly Stroke[],
  ids: readonly string[],
  images: readonly NoteImage[] = [],
  imageIds: readonly string[] = [],
): Selection | null {
  if (!ids.length && !imageIds.length) return null;
  const selected = new Set(ids);
  const selectedImages = new Set(imageIds);
  const bounds = unionBounds(boundsForStrokes(strokes, selected), boundsForImages(images, selectedImages));
  return bounds ? { ids: [...ids], imageIds: [...imageIds], bounds, rotation: 0 } : null;
}

export function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
  };
}

export function rotateStroke(stroke: Stroke, cx: number, cy: number, angle: number): Stroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => {
      const next = rotatePoint(point.x, point.y, cx, cy, angle);
      return { ...point, x: next.x, y: next.y };
    }),
  };
}

export function applyStrokeTransform(
  strokes: readonly Stroke[],
  ids: ReadonlySet<string>,
  transform: (stroke: Stroke) => Stroke,
): Stroke[] {
  return strokes.map((stroke) => (ids.has(stroke.id) ? transform(stroke) : stroke));
}

export function moveStrokes(strokes: readonly Stroke[], ids: ReadonlySet<string>, dx: number, dy: number): Stroke[] {
  return applyStrokeTransform(strokes, ids, (stroke) => translateStroke(stroke, dx, dy));
}

export function rotateStrokes(
  strokes: readonly Stroke[],
  ids: ReadonlySet<string>,
  cx: number,
  cy: number,
  angle: number,
): Stroke[] {
  return applyStrokeTransform(strokes, ids, (stroke) => rotateStroke(stroke, cx, cy, angle));
}

export function cloneStrokes(strokes: readonly Stroke[], ids: ReadonlySet<string>, dx = 0, dy = 0): Stroke[] {
  return strokes
    .filter((stroke) => ids.has(stroke.id))
    .map((stroke) => {
      const clone = translateStroke(stroke, dx, dy);
      return { ...clone, id: createId(), seed: createSeed(), createdAt: Date.now() };
    });
}

export function deleteStrokes(strokes: readonly Stroke[], ids: ReadonlySet<string>): Stroke[] {
  return strokes.filter((stroke) => !ids.has(stroke.id));
}

/**
 * Pencil tuning. Pen input is pressure sensitive; mouse/touch report a fixed
 * 0.5 and get the default body weight. The normalised pressure is baked into
 * the stroke so redraws don't depend on current settings.
 */
export function penWidth(size: number, pressure: number, variant: PenVariant, sensitivity: number, tilt = 0.5): number {
  const p = clamp(pressure, 0, 1);
  const base = variant === 'brush' ? 1.15 : variant === 'crayon' ? 1.08 : 1;
  const eased = 0.42 + (1 - 0.42) * (p * clamp(sensitivity, 0, 1) + 0.5 * (1 - sensitivity));
  const tiltBoost = 1 + (1 - clamp(tilt, 0, 1)) * 0.14;
  return Math.max(0.75, size * base * eased * tiltBoost);
}

export function strokeToPath(stroke: Stroke): string {
  if (!stroke.points.length) return '';
  const points = stroke.points;
  if (points.length === 1) return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}l0,0`;
  let path = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    path += ` Q${points[i].x.toFixed(2)},${points[i].y.toFixed(2)} ${midX.toFixed(2)},${midY.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  path += ` L${last.x.toFixed(2)},${last.y.toFixed(2)}`;
  return path;
}

/**
 * Smooth and simplify a finished stroke. Simplification is skipped for very
 * short strokes (dots and flick marks) so their character is preserved.
 */
export function finalizeStrokePoints(points: readonly InkPoint[], tolerance = 0.35): InkPoint[] {
  if (points.length < 3) return [...points];
  // RDP removes redundant samples; the renderer smooths with quadratic
  // segments, so we don't double the point count here.
  return simplifyPoints(points, tolerance);
}

/**
 * Pressure sensors are noticeably noisy on some pens and tablets. A short
 * two-sided exponential filter keeps the width transition smooth without
 * rounding off deliberate pressure changes. Mouse input (p=0.5) is untouched.
 */
export function smoothStrokePressure(points: readonly InkPoint[], alpha = 0.34): InkPoint[] {
  if (points.length < 3) return [...points];
  const forward: number[] = new Array(points.length);
  const backward: number[] = new Array(points.length);
  let pressure = clamp(points[0].p, 0, 1);
  for (let i = 0; i < points.length; i += 1) {
    pressure = i === 0 ? pressure : pressure * (1 - alpha) + clamp(points[i].p, 0, 1) * alpha;
    forward[i] = pressure;
  }
  pressure = clamp(points[points.length - 1].p, 0, 1);
  for (let i = points.length - 1; i >= 0; i -= 1) {
    pressure = i === points.length - 1 ? pressure : pressure * (1 - alpha) + clamp(points[i].p, 0, 1) * alpha;
    backward[i] = pressure;
  }
  return points.map((point, index) => ({
    ...point,
    p: index === 0
      ? clamp(point.p, 0, 1)
      : index === points.length - 1
        ? clamp(point.p, 0, 1)
        : clamp(forward[index] * 0.62 + backward[index] * 0.38, 0, 1),
  }));
}

export function finishStroke(
  points: readonly InkPoint[],
  options: {
    tool: 'pen' | 'highlighter' | 'eraser';
    variant: PenVariant | 'highlighter' | 'pixel';
    color: string;
    size: number;
    opacity: number;
    mode?: 'free' | 'straight';
  },
): Stroke | null {
  if (!points.length) return null;
  let finalPoints = [...points];
  if (options.mode === 'straight' && finalPoints.length >= 2) {
    finalPoints = [finalPoints[0], finalPoints[finalPoints.length - 1]];
  } else if (finalPoints.length > 2) {
    finalPoints = finalizeStrokePoints(finalPoints);
    if (options.tool === 'pen') finalPoints = smoothStrokePressure(finalPoints);
  }
  return {
    id: createId(),
    tool: options.tool,
    variant: options.variant,
    color: options.color,
    size: options.size,
    opacity: options.opacity,
    points: finalPoints,
    seed: createSeed(),
    mode: options.mode,
    createdAt: Date.now(),
  };
}

export function boundsForEraserMode(mode: EraserMode): 'stroke' | 'pixel' {
  return mode;
}

export function selectionCenter(selection: Selection): { x: number; y: number } {
  return boundsCenter(selection.bounds);
}

/** Bounding box after a preview rotation, used to position handles. */
export function rotatedSelectionCorners(selection: Selection): InkPoint[] {
  const { x: cx, y: cy } = boundsCenter(selection.bounds);
  return [
    { x: selection.bounds.minX, y: selection.bounds.minY },
    { x: selection.bounds.maxX, y: selection.bounds.minY },
    { x: selection.bounds.maxX, y: selection.bounds.maxY },
    { x: selection.bounds.minX, y: selection.bounds.maxY },
  ].map((point) => {
    const next = rotatePoint(point.x, point.y, cx, cy, selection.rotation);
    return { ...next, p: 0.5 };
  });
}
