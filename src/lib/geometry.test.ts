import { describe, expect, it } from 'vitest';
import {
  boundsIntersect,
  clamp,
  distanceToSegmentSquared,
  pointInPolygon,
  pointsBounds,
  rotatePoint,
  simplifyPoints,
  unionBounds,
} from './geometry';
import { fitView } from './renderer';
import type { InkPoint } from './types';

const p = (x: number, y: number, pressure = 0.5): InkPoint => ({ x, y, p: pressure });

describe('geometry', () => {
  it('clamps finite numbers and falls back for NaN', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(Number.NaN, 3, 10)).toBe(3);
  });

  it('measures distance to a segment', () => {
    expect(distanceToSegmentSquared(5, 3, 0, 0, 10, 0)).toBe(9);
    expect(distanceToSegmentSquared(-3, 0, 0, 0, 10, 0)).toBe(9);
    expect(distanceToSegmentSquared(5, 0, 10, 10, 10, 10)).toBe(125);
  });

  it('builds and unions bounds', () => {
    expect(pointsBounds([p(2, 4), p(-3, 8), p(5, -1)])).toEqual({ minX: -3, minY: -1, maxX: 5, maxY: 8 });
    expect(unionBounds({ minX: 0, minY: 0, maxX: 2, maxY: 2 }, { minX: 1, minY: -2, maxX: 4, maxY: 1 }))
      .toEqual({ minX: 0, minY: -2, maxX: 4, maxY: 2 });
    expect(boundsIntersect({ minX: 0, minY: 0, maxX: 2, maxY: 2 }, { minX: 2, minY: 2, maxX: 4, maxY: 4 })).toBe(true);
    expect(boundsIntersect({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: 2, minY: 2, maxX: 4, maxY: 4 })).toBe(false);
  });

  it('tests a point against a polygon', () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, -1, square)).toBe(false);
  });

  it('simplifies a mostly straight line to its endpoints', () => {
    const points = Array.from({ length: 40 }, (_, index) => p(index, index % 2 === 0 ? 0 : 0.08));
    const simplified = simplifyPoints(points, 0.5);
    expect(simplified).toHaveLength(2);
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified[1]).toEqual(points[points.length - 1]);
  });

  it('rotates points around a centre', () => {
    const rotated = rotatePoint(1, 0, 0, 0, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
  });

  it('fits a view around a bounding box', () => {
    const view = fitView({ minX: -100, minY: -50, maxX: 100, maxY: 50 }, 800, 600, 40, 2, 0.1);
    expect(view.scale).toBeGreaterThan(0.1);
    expect(view.scale).toBeLessThanOrEqual(2);
    expect(view.x + 0 * view.scale).toBeCloseTo(400);
  });
});
