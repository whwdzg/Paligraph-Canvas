import { describe, expect, it } from 'vitest';
import { hitTestImage, imageBounds, imageCenter, transformImage } from './media';
import type { NoteImage } from './types';

const image: NoteImage = {
  id: 'image-1',
  src: 'data:image/png;base64,AA==',
  name: 'dot.png',
  mime: 'image/png',
  x: -40,
  y: -20,
  width: 80,
  height: 40,
  rotation: 0,
};

describe('canvas images', () => {
  it('hit-tests unrotated and rotated images', () => {
    expect(imageCenter(image)).toEqual({ x: 0, y: 0 });
    expect(hitTestImage(image, 0, 0)).toBe(true);
    expect(hitTestImage(image, 41, 0)).toBe(false);
    const rotated = { ...image, rotation: Math.PI / 2 };
    expect(hitTestImage(rotated, 0, 35)).toBe(true);
    expect(hitTestImage(rotated, 35, 0)).toBe(false);
  });

  it('computes axis-aligned bounds for a rotated image', () => {
    const bounds = imageBounds({ ...image, rotation: Math.PI / 4 });
    const half = (80 + 40) / (2 * Math.SQRT2);
    expect(bounds.minX).toBeCloseTo(-half, 5);
    expect(bounds.maxX).toBeCloseTo(half, 5);
  });

  it('rotates the centre around a selection pivot and adds image rotation', () => {
    const moved = transformImage(image, 10, 5, Math.PI / 2, { x: 100, y: 100 });
    expect(moved.rotation).toBeCloseTo(Math.PI / 2);
    expect(moved.x + moved.width / 2).toBeCloseTo(210);
    expect(moved.y + moved.height / 2).toBeCloseTo(5);
  });
});
