import { describe, expect, it } from 'vitest';
import { inkBlendMode } from './renderer';
import type { Stroke } from './types';

const stroke = (tool: Stroke['tool'], variant: Stroke['variant']): Pick<Stroke, 'tool' | 'variant'> => ({
  tool,
  variant,
});

describe('ink blend modes', () => {
  it('uses pigment mixing for pen and pencil', () => {
    expect(inkBlendMode(stroke('pen', 'pen'))).toBe('multiply');
    expect(inkBlendMode(stroke('pen', 'pencil'))).toBe('multiply');
  });

  it('gives wax and wet brush different overlap styles', () => {
    expect(inkBlendMode(stroke('pen', 'crayon'))).toBe('darken');
    expect(inkBlendMode(stroke('pen', 'brush'))).toBe('color-burn');
    expect(inkBlendMode(stroke('highlighter', 'highlighter'))).toBe('multiply');
  });

  it('keeps erasers destructive', () => {
    expect(inkBlendMode(stroke('eraser', 'pixel'))).toBe('destination-out');
  });
});
