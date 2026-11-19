import { describe, expect, it } from 'vitest';
import {
  boundsForStrokes,
  cloneStrokes,
  finishStroke,
  hitTestStroke,
  makeSelection,
  moveStrokes,
  rotateStrokes,
  strokeIntersectsEraser,
  strokesInLasso,
} from './strokes';
import type { InkPoint, Stroke } from './types';

const point = (x: number, y: number, p = 0.5): InkPoint => ({ x, y, p });

function makeStroke(points: InkPoint[], overrides: Partial<Stroke> = {}): Stroke {
  return {
    id: 'stroke-1',
    tool: 'pen',
    variant: 'pen',
    color: '#1f6feb',
    size: 6,
    opacity: 1,
    points,
    seed: 12,
    createdAt: 1,
    ...overrides,
  };
}

describe('stroke operations', () => {
  it('finishes a stroke with a stable id and simplified points', () => {
    const points = Array.from({ length: 20 }, (_, index) => point(index * 4, 0));
    const stroke = finishStroke(points, {
      tool: 'pen',
      variant: 'pen',
      color: '#123456',
      size: 4,
      opacity: 1,
    });
    expect(stroke).not.toBeNull();
    expect(stroke?.id).toMatch(/^s_/);
    expect(stroke?.points.length).toBe(2);
    expect(stroke?.color).toBe('#123456');
  });

  it('turns a freehand highlighter into a straight line when requested', () => {
    const stroke = finishStroke([point(0, 0), point(50, 20), point(100, 5)], {
      tool: 'highlighter',
      variant: 'highlighter',
      color: '#ffd60a',
      size: 20,
      opacity: 0.32,
      mode: 'straight',
    });
    expect(stroke?.points).toEqual([point(0, 0), point(100, 5)]);
  });

  it('hits strokes with viewport slop but ignores eraser masks', () => {
    const stroke = makeStroke([point(0, 0), point(100, 0)]);
    expect(hitTestStroke(stroke, 50, 2)).toBe(true);
    expect(hitTestStroke(stroke, 50, 20)).toBe(false);
    expect(hitTestStroke(makeStroke(stroke.points, { tool: 'eraser', variant: 'pixel' }), 50, 0)).toBe(false);
  });

  it('selects strokes with a lasso', () => {
    const inside = makeStroke([point(10, 10), point(20, 20), point(30, 15)]);
    const outside = makeStroke([point(200, 200), point(250, 220)], { id: 'stroke-2' });
    const polygon = [point(0, 0), point(60, 0), point(60, 60), point(0, 60)];
    expect(strokesInLasso([inside, outside], polygon)).toEqual(['stroke-1']);
  });

  it('detects eraser crossings', () => {
    const stroke = makeStroke([point(0, 0), point(100, 0)]);
    expect(strokeIntersectsEraser(stroke, [point(50, 5)], 10)).toBe(true);
    expect(strokeIntersectsEraser(stroke, [point(50, 50)], 10)).toBe(false);
  });

  it('moves, rotates, clones and bounds selected strokes', () => {
    const stroke = makeStroke([point(0, 0), point(10, 0)]);
    const moved = moveStrokes([stroke], new Set(['stroke-1']), 5, 7);
    expect(moved[0].points[0]).toMatchObject({ x: 5, y: 7 });
    const rotated = rotateStrokes(moved, new Set(['stroke-1']), 5, 7, Math.PI);
    expect(rotated[0].points[0].x).toBeCloseTo(5);
    expect(rotated[0].points[0].y).toBeCloseTo(7);
    const clones = cloneStrokes([stroke], new Set(['stroke-1']), 2, 2);
    expect(clones[0].id).not.toBe(stroke.id);
    expect(clones[0].points[0]).toMatchObject({ x: 2, y: 2 });
    const bounds = boundsForStrokes([stroke]);
    expect(bounds?.maxX).toBeGreaterThan(10);
    const selection = makeSelection([stroke], ['stroke-1']);
    expect(selection?.ids).toEqual(['stroke-1']);
  });
});
