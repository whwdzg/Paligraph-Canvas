import { describe, expect, it } from 'vitest';
import { createSyntheticPressure, nextSyntheticPressure, shapePressure } from './pressure';

describe('pressure', () => {
  it('scales pressure deviation with strength', () => {
    expect(shapePressure(0.2, 0.72, 0)).toBe(0.5);
    const normal = shapePressure(0.2, 0.72, 1);
    const strong = shapePressure(0.2, 0.72, 2);
    expect(normal).toBeLessThan(0.5);
    expect(strong).toBeLessThan(normal);
    expect(shapePressure(0.8, 0.72, 2)).toBeGreaterThan(0.8);
  });

  it('infers heavier pressure for slow movement and pauses', () => {
    const start = createSyntheticPressure(0, 0, 0);
    const slow = nextSyntheticPressure(start, 100, 10, 0).pressure;
    const fast = nextSyntheticPressure(start, 10, 100, 0).pressure;
    expect(slow).toBeGreaterThan(fast);
    expect(slow).toBeGreaterThan(0.5);
    expect(fast).toBeLessThan(0.7);
  });

  it('keeps the inferred signal bounded and carries sample state', () => {
    let state = createSyntheticPressure(0, 0, 0);
    for (let index = 1; index <= 40; index += 1) {
      const next = nextSyntheticPressure(state, index * 16, index * 2, 0);
      state = next.state;
      expect(next.pressure).toBeGreaterThanOrEqual(0);
      expect(next.pressure).toBeLessThanOrEqual(1);
    }
    expect(state.lastX).toBe(80);
    expect(state.lastTime).toBe(640);
  });
});
