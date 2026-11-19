import type { Bounds, InkPoint } from './types';

/** Small, dependency-free geometry helpers shared by the renderer and tests. */

export const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Squared distance from a point to a line segment, avoiding an extra sqrt in hit tests. */
export function distanceToSegmentSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const ddx = px - ax;
    const ddy = py - ay;
    return ddx * ddx + ddy * ddy;
  }
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  const ddx = px - (ax + t * dx);
  const ddy = py - (ay + t * dy);
  return ddx * ddx + ddy * ddy;
}

export function pointsBounds(points: readonly InkPoint[]): Bounds {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function expandBounds(bounds: Bounds, amount: number): Bounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function pointInPolygon(x: number, y: number, polygon: readonly InkPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Ramer–Douglas–Peucker simplification. Applied when a stroke ends to cut
 * redundant samples from pointer streams without visibly changing the line.
 */
export function simplifyPoints(points: readonly InkPoint[], tolerance = 0.45): InkPoint[] {
  if (points.length <= 2) return [...points];
  const toleranceSq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop() as [number, number];
    let maxDistance = toleranceSq;
    let farthest = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegmentSquared(
        points[i].x,
        points[i].y,
        points[start].x,
        points[start].y,
        points[end].x,
        points[end].y,
      );
      if (d > maxDistance) {
        maxDistance = d;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

/** Chaikin corner cutting for a soft, Apple Pencil-like curve. */
export function smoothPoints(points: readonly InkPoint[], iterations = 1): InkPoint[] {
  let result = [...points];
  for (let pass = 0; pass < iterations; pass += 1) {
    if (result.length < 3) return result;
    const next: InkPoint[] = [result[0]];
    for (let i = 0; i < result.length - 1; i += 1) {
      const a = result[i];
      const b = result[i + 1];
      next.push(
        { ...a, x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { ...a, x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
      );
    }
    next.push(result[result.length - 1]);
    result = next;
  }
  return result;
}

export function rotatePoint(x: number, y: number, cx: number, cy: number, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function rotateBoundsCorners(bounds: Bounds, angle: number): InkPoint[] {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return [
    { x: bounds.minX, y: bounds.minY, p: 0.5 },
    { x: bounds.maxX, y: bounds.minY, p: 0.5 },
    { x: bounds.maxX, y: bounds.maxY, p: 0.5 },
    { x: bounds.minX, y: bounds.maxY, p: 0.5 },
  ].map((point) => ({ ...point, ...rotatePoint(point.x, point.y, cx, cy, angle) }));
}

export function boundsCenter(bounds: Bounds): { x: number; y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** Decorative loops need a stable point count and never allocate huge arrays. */
export function makeWave(
  startX: number,
  startY: number,
  width: number,
  amplitude: number,
  count: number,
): InkPoint[] {
  const points: InkPoint[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    points.push({
      x: startX + width * t,
      y: startY + Math.sin(t * Math.PI * 4.2) * amplitude * (0.35 + t * 0.65),
      p: 0.45 + Math.sin(t * Math.PI * 2) * 0.22,
    });
  }
  return points;
}
