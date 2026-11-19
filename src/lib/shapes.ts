import { clamp, distance, pointsBounds, simplifyPoints } from './geometry';
import { createId, createSeed } from './strokes';
import type { InkPoint, ShapeKind, Stroke } from './types';

/**
 * Lightweight, fully local shape correction.
 *
 * A rough shape is recognised from the geometry itself (no ML model, no
 * network). Recognition is deliberately conservative: only a confident
 * line/rectangle/circle/triangle is snapped, so ordinary handwriting is not
 * silently changed. The preview is shown while the pen is still down and is
 * only committed when the user lifts it.
 */

export interface ShapeFit {
  kind: ShapeKind;
  confidence: number;
  points: InkPoint[];
}

function polygonArea(points: readonly InkPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function pathLength(points: readonly InkPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += distance(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  return length;
}

function perimeter(points: readonly InkPoint[]): number {
  return pathLength(points) + (points.length > 1 ? distance(points[0].x, points[0].y, points[points.length - 1].x, points[points.length - 1].y) : 0);
}

function convexHull(points: readonly InkPoint[]): InkPoint[] {
  if (points.length <= 2) return [...points];
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: InkPoint, a: InkPoint, b: InkPoint): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: InkPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: InkPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function angleAt(previous: InkPoint, current: InkPoint, next: InkPoint): number {
  const ax = previous.x - current.x;
  const ay = previous.y - current.y;
  const bx = next.x - current.x;
  const by = next.y - current.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
  const cosine = clamp((ax * bx + ay * by) / denominator, -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

function ellipsePoints(bounds: { minX: number; minY: number; maxX: number; maxY: number }): InkPoint[] {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const rx = (bounds.maxX - bounds.minX) / 2;
  const ry = (bounds.maxY - bounds.minY) / 2;
  const points: InkPoint[] = [];
  for (let i = 0; i <= 96; i += 1) {
    const angle = (i / 96) * Math.PI * 2;
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, p: 0.55 });
  }
  return points;
}

function rectanglePoints(bounds: { minX: number; minY: number; maxX: number; maxY: number }): InkPoint[] {
  const { minX, minY, maxX, maxY } = bounds;
  return [
    { x: minX, y: minY, p: 0.55 },
    { x: maxX, y: minY, p: 0.55 },
    { x: maxX, y: maxY, p: 0.55 },
    { x: minX, y: maxY, p: 0.55 },
    { x: minX, y: minY, p: 0.55 },
  ];
}

/** Returns a corrected stroke only when the recognition is confident. */
export function recognizeShape(rawPoints: readonly InkPoint[]): ShapeFit | null {
  if (rawPoints.length < 4) return null;
  const originalBounds = pointsBounds(rawPoints);
  const width = originalBounds.maxX - originalBounds.minX;
  const height = originalBounds.maxY - originalBounds.minY;
  const diagonal = Math.hypot(width, height);
  if (diagonal < 14) return null;

  const points = simplifyPoints(rawPoints, Math.max(0.8, diagonal * 0.018));
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const closeGap = distance(first.x, first.y, last.x, last.y);
  const closed = closeGap <= diagonal * 0.24 || closeGap / Math.max(1, pathLength(points)) < 0.09;
  const bounds = pointsBounds(points);
  const bboxArea = Math.max(1, width * height);
  const hull = convexHull(points);
  const hullArea = Math.abs(polygonArea(hull));

  if (!closed) {
    const direct = distance(first.x, first.y, last.x, last.y);
    const length = pathLength(points);
    const straightness = direct / Math.max(1, length);
    if (direct > 24 && straightness > 0.94) {
      return {
        kind: 'line',
        confidence: clamp((straightness - 0.9) * 8 + 0.58, 0, 0.99),
        points: [
          { ...first, p: 0.55 },
          { ...last, p: 0.55 },
        ],
      };
    }
    return null;
  }

  const normalized = [...points];
  if (distance(normalized[0].x, normalized[0].y, normalized[normalized.length - 1].x, normalized[normalized.length - 1].y) < diagonal * 0.08) {
    normalized.pop();
  }
  const corners = simplifyPoints([...normalized, normalized[0]], diagonal * 0.055);
  if (corners.length > 1 && distance(corners[0].x, corners[0].y, corners[corners.length - 1].x, corners[corners.length - 1].y) < diagonal * 0.06) {
    corners.pop();
  }
  const cornerArea = Math.abs(polygonArea(corners));
  const turns = corners.map((corner, index) =>
    angleAt(corners[(index - 1 + corners.length) % corners.length], corner, corners[(index + 1) % corners.length]),
  );
  const sharpTurn = turns.length ? turns.reduce((sum, turn) => sum + turn, 0) / turns.length : 0;
  const perimeterLength = Math.max(1, perimeter(normalized));
  const circularity = (4 * Math.PI * Math.abs(polygonArea(normalized))) / (perimeterLength * perimeterLength);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const rx = Math.max(1, width / 2);
  const ry = Math.max(1, height / 2);
  let radialError = 0;
  for (const point of normalized) {
    const normalizedRadius = Math.hypot((point.x - center.x) / rx, (point.y - center.y) / ry);
    radialError += Math.abs(normalizedRadius - 1);
  }
  radialError /= normalized.length;

  const fillRatio = hullArea / bboxArea;

  // Circles and ellipses must be tested before rectangles: both can simplify
  // to a handful of corners, but the normalized radius of a circle stays very
  // close to one. This prevents a round sketch from being squared off.
  const veryRound = radialError < 0.11 && circularity > 0.78;
  const roundPolygon = radialError < 0.17 && circularity > 0.72 && corners.length >= 5;
  if ((veryRound || roundPolygon) && cornerArea / Math.max(1, hullArea) > 0.48) {
    const roundness = clamp(1 - radialError * 2.4, 0, 1);
    return {
      kind: 'ellipse',
      confidence: clamp(0.56 + circularity * 0.2 + roundness * 0.2, 0, 0.98),
      points: ellipsePoints(bounds),
    };
  }

  if (corners.length >= 3 && corners.length <= 4 && sharpTurn > 42 && fillRatio > 0.32 && fillRatio < 0.74) {
    const triangle = pickTriangleCorners(hull);
    if (triangle) {
      const triangleArea = Math.abs(polygonArea(triangle));
      const areaMatch = triangleArea / Math.max(1, hullArea);
      if (areaMatch > 0.76) {
        return {
          kind: 'triangle',
          confidence: clamp(0.55 + areaMatch * 0.28 + Math.min(0.1, Math.abs(sharpTurn - 60) / 300), 0, 0.97),
          points: [...triangle.map((point) => ({ ...point, p: 0.55 })), { ...triangle[0], p: 0.55 }],
        };
      }
    }
  }

  if (corners.length >= 4 && corners.length <= 6 && sharpTurn > 62 && fillRatio > 0.66) {
    return {
      kind: 'rectangle',
      confidence: clamp(0.58 + fillRatio * 0.22 + Math.min(0.12, (sharpTurn - 60) / 300), 0, 0.98),
      points: rectanglePoints(bounds),
    };
  }

  // A wobbly freehand loop can land just outside the strict ellipse checks.
  if (corners.length > 5 && fillRatio > 0.55 && radialError < 0.3 && circularity > 0.68) {
    return {
      kind: 'ellipse',
      confidence: clamp(0.52 + circularity * 0.22, 0, 0.9),
      points: ellipsePoints(bounds),
    };
  }

  return null;
}

function pickTriangleCorners(hull: readonly InkPoint[]): [InkPoint, InkPoint, InkPoint] | null {
  if (hull.length < 3) return null;
  let best: [InkPoint, InkPoint, InkPoint] | null = null;
  let bestArea = 0;
  for (let i = 0; i < hull.length - 2; i += 1) {
    for (let j = i + 1; j < hull.length - 1; j += 1) {
      for (let k = j + 1; k < hull.length; k += 1) {
        const area = Math.abs(polygonArea([hull[i], hull[j], hull[k]]));
        if (area > bestArea) {
          bestArea = area;
          best = [hull[i], hull[j], hull[k]];
        }
      }
    }
  }
  return best;
}

/** Build a corrected copy of the original stroke, preserving styling and id. */
export function snapStrokeToShape(stroke: Stroke, fit: ShapeFit): Stroke {
  const points = fit.points.map((point) => ({ ...point, p: 0.55 }));
  return {
    ...stroke,
    id: createId('shape'),
    seed: createSeed(),
    shape: fit.kind,
    points,
    createdAt: Date.now(),
  };
}

/** Used by the live preview before the stroke is committed. */
export function previewShapeStroke(stroke: Stroke, fit: ShapeFit): Stroke {
  return {
    ...stroke,
    shape: fit.kind,
    points: fit.points.map((point) => ({ ...point, p: 0.55 })),
  };
}

export function shapeLabelKey(kind: ShapeKind): string {
  return `shape.${kind}`;
}

/** Exported for tests and for analytics-free diagnostics. */
export { convexHull, polygonArea };
