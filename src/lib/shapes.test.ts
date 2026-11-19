import { describe, expect, it } from 'vitest';
import { recognizeShape, snapStrokeToShape } from './shapes';
import type { InkPoint, Stroke } from './types';

const point = (x: number, y: number): InkPoint => ({ x, y, p: 0.5 });

function circle(cx: number, cy: number, rx: number, ry: number, wobble = 0): InkPoint[] {
  const points: InkPoint[] = [];
  for (let i = 0; i <= 64; i += 1) {
    const angle = (i / 64) * Math.PI * 2;
    const factor = 1 + Math.sin(i * 0.7) * wobble;
    points.push(point(cx + Math.cos(angle) * rx * factor, cy + Math.sin(angle) * ry * factor));
  }
  return points;
}

function rectangle(x: number, y: number, width: number, height: number): InkPoint[] {
  const points: InkPoint[] = [];
  const corners = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    [x, y],
  ];
  for (let segment = 0; segment < 4; segment += 1) {
    const [ax, ay] = corners[segment];
    const [bx, by] = corners[segment + 1];
    for (let i = 0; i < 16; i += 1) {
      const t = i / 16;
      points.push(point(ax + (bx - ax) * t + Math.sin(i * 1.7) * 1.2, ay + (by - ay) * t + Math.cos(i * 1.3) * 1.2));
    }
  }
  points.push(point(x, y));
  return points;
}

function triangle(cx: number, cy: number, radius: number): InkPoint[] {
  const vertices = [0, 1, 2].map((index) => {
    const angle = -Math.PI / 2 + (index / 3) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
  });
  return polygon(vertices);
}

function polygon(vertices: ReadonlyArray<readonly [number, number]>, closed = true): InkPoint[] {
  const points: InkPoint[] = [];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const [ax, ay] = vertices[segment];
    const [bx, by] = vertices[(segment + 1) % vertices.length];
    for (let i = 0; i < 14; i += 1) {
      const t = i / 14;
      points.push(point(ax + (bx - ax) * t, ay + (by - ay) * t));
    }
  }
  if (closed) points.push(point(vertices[0][0], vertices[0][1]));
  return points;
}

function star(cx: number, cy: number, outer: number): InkPoint[] {
  const vertices = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;
    const radius = index % 2 === 0 ? outer : outer * 0.42;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
  });
  return polygon(vertices);
}

describe('shape recognition', () => {
  it('snaps a rough straight line', () => {
    const points = Array.from({ length: 20 }, (_, index) => point(index * 12, Math.sin(index) * 1.6));
    const fit = recognizeShape(points);
    expect(fit?.kind).toBe('line');
    expect(fit?.points).toHaveLength(2);
  });

  it('recognises an ellipse and a perfect circle', () => {
    expect(recognizeShape(circle(120, 80, 60, 38, 0.025))?.kind).toBe('ellipse');
    expect(recognizeShape(circle(120, 80, 50, 50, 0.012))?.kind).toBe('circle');
  });

  it('recognises rectangles and squares', () => {
    const rectangleFit = recognizeShape(rectangle(20, 30, 140, 90));
    expect(rectangleFit?.kind).toBe('rectangle');
    expect(rectangleFit?.points.length).toBeGreaterThanOrEqual(5);
    expect(recognizeShape(rectangle(20, 30, 110, 110))?.kind).toBe('square');
  });

  it('recognises regular and equilateral triangles', () => {
    const fit = recognizeShape(triangle(100, 100, 75));
    expect(fit?.kind).toBe('equilateralTriangle');
    expect(fit?.points).toHaveLength(4);
  });

  it('recognises a diamond and a five-point star', () => {
    const diamond = polygon([[100, 20], [160, 80], [100, 140], [40, 80]]);
    expect(recognizeShape(diamond)?.kind).toBe('diamond');
    expect(recognizeShape(star(100, 100, 70))?.kind).toBe('star');
  });

  it('recognises check marks and crosses', () => {
    const check = polygon([[20, 62], [58, 96], [112, 26]], false);
    expect(recognizeShape(check)?.kind).toBe('check');
    const cross = polygon([[20, 20], [110, 110], [110, 20], [20, 110]], false);
    expect(recognizeShape(cross)?.kind).toBe('cross');
  });

  it('does not snap a dot or short flick', () => {
    expect(recognizeShape([point(0, 0), point(2, 2), point(4, 1)])).toBeNull();
  });

  it('preserves styling when producing the corrected stroke', () => {
    const source: Stroke = {
      id: 'x',
      tool: 'pen',
      variant: 'pencil',
      color: '#123456',
      size: 5,
      opacity: 0.9,
      points: rectangle(0, 0, 100, 60),
      seed: 4,
      createdAt: 1,
    };
    const fit = recognizeShape(source.points);
    const snapped = snapStrokeToShape(source, fit!);
    expect(snapped.shape).toBe('rectangle');
    expect(snapped.color).toBe('#123456');
    expect(snapped.variant).toBe('pencil');
    expect(snapped.points.length).toBeGreaterThan(2);
  });
});
