import type { InkPoint, Note, Stroke } from './types';
import { createId, createSeed } from './strokes';

/**
 * First-run note. A small ink monogram demonstrates the brush engine without
 * requiring any network asset, and gives the empty workspace a friendly face.
 */
function cubic(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  count: number,
  pressure: (t: number) => number,
): InkPoint[] {
  const points: InkPoint[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const u = 1 - t;
    points.push({
      x: u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      y: u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      p: pressure(t),
    });
  }
  return points;
}

function loop(centerX: number, centerY: number, radiusX: number, radiusY: number, turns = 1.25, count = 50): InkPoint[] {
  const points: InkPoint[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const angle = -Math.PI * 0.75 + t * Math.PI * 2 * turns;
    const scale = 1 - t * 0.18;
    points.push({
      x: centerX + Math.cos(angle) * radiusX * scale,
      y: centerY + Math.sin(angle) * radiusY * scale,
      p: 0.2 + Math.sin(t * Math.PI) * 0.8,
    });
  }
  return points;
}

function stroke(
  points: InkPoint[],
  options: Pick<Stroke, 'tool' | 'variant' | 'color' | 'size' | 'opacity' | 'mode'>,
): Stroke {
  return {
    id: createId('welcome'),
    seed: createSeed(),
    points,
    createdAt: Date.now(),
    ...options,
  };
}

export function createWelcomeNote(title: string): Note {
  const now = Date.now();
  const ink = '#1f4fa8';
  const coral = '#d75a4a';
  const gold = '#ffcf4a';

  const strokes: Stroke[] = [
    stroke(
      [
        { x: -318, y: 128, p: 0.3 },
        { x: -214, y: 58, p: 0.45 },
        { x: -104, y: 30, p: 0.58 },
        { x: 4, y: 38, p: 0.66 },
        { x: 136, y: 84, p: 0.58 },
        { x: 276, y: 136, p: 0.4 },
      ],
      { tool: 'highlighter', variant: 'highlighter', color: gold, size: 24, opacity: 0.2, mode: 'free' },
    ),
    stroke(
      cubic([-236, -166], [-210, -214], [-150, -220], [-118, -166], 46, (t) => 0.32 + 0.55 * (1 - t)),
      { tool: 'pen', variant: 'brush', color: ink, size: 10, opacity: 1, mode: 'free' },
    ),
    stroke(
      [
        { x: -118, y: -166, p: 0.74 },
        { x: -118, y: -38, p: 0.7 },
        { x: -116, y: 84, p: 0.6 },
        { x: -116, y: 188, p: 0.35 },
      ],
      { tool: 'pen', variant: 'brush', color: ink, size: 10, opacity: 1, mode: 'free' },
    ),
    stroke(
      cubic([-118, -162], [-8, -214], [112, -174], [112, -76], 54, (t) => 0.3 + Math.sin(t * Math.PI) * 0.6),
      { tool: 'pen', variant: 'brush', color: ink, size: 10, opacity: 1, mode: 'free' },
    ),
    stroke(
      cubic([112, -76], [112, 16], [-10, 16], [-118, 18], 42, (t) => 0.64 - t * 0.24),
      { tool: 'pen', variant: 'brush', color: ink, size: 10, opacity: 1, mode: 'free' },
    ),
    stroke(
      cubic([-316, 208], [-214, 188], [-154, 236], [-92, 212], 34, () => 0.48),
      { tool: 'pen', variant: 'pencil', color: ink, size: 3.2, opacity: 0.8, mode: 'free' },
    ),
    stroke(
      [
        { x: 208, y: -152, p: 0.55 },
        { x: 210, y: -212, p: 0.55 },
        { x: 206, y: -154, p: 0.55 },
        { x: 166, y: -184, p: 0.55 },
        { x: 206, y: -164, p: 0.55 },
        { x: 246, y: -202, p: 0.55 },
      ],
      { tool: 'pen', variant: 'pen', color: coral, size: 3.6, opacity: 0.95, mode: 'free' },
    ),
    stroke(loop(294, 82, 44, 34, 1.02), {
      tool: 'pen',
      variant: 'pencil',
      color: coral,
      size: 2.4,
      opacity: 0.72,
      mode: 'free',
    }),
  ];

  return {
    id: createId('note'),
    title,
    markdown: '',
    strokes,
    background: { pattern: 'dots', lineStyle: 'solid', spacing: 32, opacity: 0.18, color: '' },
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  };
}
