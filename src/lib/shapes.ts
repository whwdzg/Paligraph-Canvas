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

const OPEN_SHAPES = new Set<ShapeKind>(['line', 'arrow', 'check', 'cross']);

export function isOpenShape(kind: ShapeKind): boolean {
  return OPEN_SHAPES.has(kind);
}

function polarPoints(
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  count: number,
  offset = -Math.PI / 2,
): InkPoint[] {
  const points: InkPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = offset + (index / count) * Math.PI * 2;
    points.push({ x: cx + Math.cos(angle) * radiusX, y: cy + Math.sin(angle) * radiusY, p: 0.55 });
  }
  return points;
}

/** Builds exact points for the shape picker and auto-snap geometry. */
export function createShapePoints(kind: ShapeKind, bounds: { minX: number; minY: number; maxX: number; maxY: number }): InkPoint[] {
  const { minX, minY, maxX, maxY } = bounds;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const radius = Math.min(width, height) / 2;
  const point = (x: number, y: number): InkPoint => ({ x, y, p: 0.55 });

  switch (kind) {
    case 'line':
      return [point(minX, cy), point(maxX, cy)];
    case 'arrow':
      return [point(minX, cy), point(maxX, cy), point(maxX - width * 0.2, cy - height * 0.16), point(maxX, cy), point(maxX - width * 0.2, cy + height * 0.16)];
    case 'rectangle':
      return [point(minX, minY), point(maxX, minY), point(maxX, maxY), point(minX, maxY), point(minX, minY)];
    case 'square':
      return [point(cx - radius, cy - radius), point(cx + radius, cy - radius), point(cx + radius, cy + radius), point(cx - radius, cy + radius), point(cx - radius, cy - radius)];
    case 'ellipse':
      return polarPoints(cx, cy, width / 2, height / 2, 96);
    case 'circle':
      return polarPoints(cx, cy, radius, radius, 96);
    case 'triangle':
      return [point(minX, maxY), point(cx, minY), point(maxX, maxY), point(minX, maxY)];
    case 'equilateralTriangle': {
      const size = Math.min(width, height * 1.15);
      const h = size * (Math.sqrt(3) / 2);
      return [point(cx - size / 2, cy + h / 2), point(cx + size / 2, cy + h / 2), point(cx, cy - h / 2), point(cx - size / 2, cy + h / 2)];
    }
    case 'diamond':
      return [point(cx, minY), point(maxX, cy), point(cx, maxY), point(minX, cy), point(cx, minY)];
    case 'star': {
      const points: InkPoint[] = [];
      const inner = radius * 0.42;
      for (let index = 0; index < 10; index += 1) {
        const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;
        const r = index % 2 === 0 ? radius : inner;
        points.push(point(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r));
      }
      points.push(points[0]);
      return points;
    }
    case 'pentagon':
      return polarPoints(cx, cy, radius, radius, 5);
    case 'hexagon':
      return polarPoints(cx, cy, radius, radius, 6, 0);
    case 'check':
      return [point(minX, minY + height * 0.38), point(minX + width * 0.38, maxY), point(maxX, minY + height * 0.12)];
    case 'cross':
      return [point(minX, minY), point(maxX, maxY), point(maxX, minY), point(minX, maxY)];
    default:
      return [];
  }
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
    const checkPoints = simplifyPoints(points, diagonal * 0.09);
    if (checkPoints.length >= 3) {
      const lowIndex = checkPoints.reduce((best, point, index) => (point.y > checkPoints[best].y ? index : best), 0);
      const low = checkPoints[lowIndex];
      const left = checkPoints[0];
      const right = checkPoints[checkPoints.length - 1];
      if (
        lowIndex > 0 &&
        lowIndex < checkPoints.length - 1 &&
        Math.min(left.y, right.y) < low.y - height * 0.16 &&
        Math.max(left.x, right.x) - Math.min(left.x, right.x) > width * 0.55
      ) {
        return {
          kind: 'check',
          confidence: 0.78,
          points: [
            { x: left.x, y: left.y, p: 0.55 },
            { x: low.x, y: low.y, p: 0.55 },
            { x: right.x, y: right.y, p: 0.55 },
          ],
        };
      }
    }
    if (polylineSelfIntersects(checkPoints) && width > 18 && height > 18) {
      return { kind: 'cross', confidence: 0.76, points: createShapePoints('cross', bounds) };
    }

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

  // Five-point star: the radius alternates between outer peaks and inner
  // valleys five times while the path remains closed.
  const radii = corners.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const maxRadius = Math.max(1, ...radii);
  let peaks = 0;
  let valleys = 0;
  for (let index = 0; index < radii.length; index += 1) {
    const previous = radii[(index - 1 + radii.length) % radii.length];
    const next = radii[(index + 1) % radii.length];
    if (radii[index] > maxRadius * 0.72 && radii[index] >= previous && radii[index] >= next) peaks += 1;
    if (radii[index] < maxRadius * 0.58 && radii[index] <= previous && radii[index] <= next) valleys += 1;
  }
  if (peaks >= 4 && peaks <= 6 && valleys >= 4 && normalized.length >= 8) {
    return {
      kind: 'star',
      confidence: clamp(0.62 + peaks * 0.045, 0, 0.94),
      points: createShapePoints('star', bounds),
    };
  }

  // A diamond has four equal-ish edges but a hollow, rotated-square silhouette.
  // Test it before circles: four corner points can still have a low radial
  // error, and a circle snap would destroy the intentional points.
  if (corners.length === 4 && fillRatio > 0.34 && fillRatio < 0.64) {
    const sides = corners.map((corner, index) =>
      distance(corner.x, corner.y, corners[(index + 1) % corners.length].x, corners[(index + 1) % corners.length].y),
    );
    const shortest = Math.min(...sides);
    const longest = Math.max(...sides);
    if (shortest > 1 && longest / shortest < 1.35) {
      return { kind: 'diamond', confidence: 0.76, points: createShapePoints('diamond', bounds) };
    }
  }

  // Circles and ellipses must be tested before rectangles: both can simplify
  // to a handful of corners, but the normalized radius of a circle stays very
  // close to one. This prevents a round sketch from being squared off.
  const veryRound = radialError < 0.11 && circularity > 0.78;
  const roundPolygon = radialError < 0.17 && circularity > 0.72 && corners.length >= 5;
  if ((veryRound || roundPolygon) && cornerArea / Math.max(1, hullArea) > 0.48) {
    const roundness = clamp(1 - radialError * 2.4, 0, 1);
    const circle = Math.abs(width - height) / Math.max(width, height) < 0.17;
    const points = circle ? createShapePoints('circle', bounds) : ellipsePoints(bounds);
    return {
      kind: circle ? 'circle' : 'ellipse',
      confidence: clamp(0.56 + circularity * 0.2 + roundness * 0.2, 0, 0.98),
      points,
    };
  }

  if (corners.length >= 3 && corners.length <= 4 && sharpTurn > 42 && fillRatio > 0.32 && fillRatio < 0.74) {
    const triangle = pickTriangleCorners(hull);
    if (triangle) {
      const triangleArea = Math.abs(polygonArea(triangle));
      const areaMatch = triangleArea / Math.max(1, hullArea);
      if (areaMatch > 0.76) {
        const sides = [
          distance(triangle[0].x, triangle[0].y, triangle[1].x, triangle[1].y),
          distance(triangle[1].x, triangle[1].y, triangle[2].x, triangle[2].y),
          distance(triangle[2].x, triangle[2].y, triangle[0].x, triangle[0].y),
        ];
        const equilateral = Math.max(...sides) / Math.max(1, Math.min(...sides)) < 1.22;
        return {
          kind: equilateral ? 'equilateralTriangle' : 'triangle',
          confidence: clamp(0.55 + areaMatch * 0.28 + Math.min(0.1, Math.abs(sharpTurn - 60) / 300), 0, 0.97),
          points: equilateral
            ? createShapePoints('equilateralTriangle', bounds)
            : [...triangle.map((point) => ({ ...point, p: 0.55 })), { ...triangle[0], p: 0.55 }],
        };
      }
    }
  }

  if (corners.length >= 4 && corners.length <= 6 && sharpTurn > 62 && fillRatio > 0.66) {
    const square = Math.abs(width - height) / Math.max(width, height) < 0.12;
    return {
      kind: square ? 'square' : 'rectangle',
      confidence: clamp(0.58 + fillRatio * 0.22 + Math.min(0.12, (sharpTurn - 60) / 300), 0, 0.98),
      points: square ? createShapePoints('square', bounds) : rectanglePoints(bounds),
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

function segmentIntersection(a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint): boolean {
  const cross = (p: InkPoint, q: InkPoint, r: InkPoint): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function polylineSelfIntersects(points: readonly InkPoint[]): boolean {
  for (let i = 1; i < points.length; i += 1) {
    for (let j = i + 2; j < points.length; j += 1) {
      if (segmentIntersection(points[i - 1], points[i], points[j - 1], points[j])) return true;
    }
  }
  return false;
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
