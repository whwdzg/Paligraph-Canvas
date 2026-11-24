import { clamp, distance } from './geometry';

export interface SyntheticPressureState {
  /** Smoothed 0–1 signal carried between samples. */
  value: number;
  lastTime: number;
  lastX: number;
  lastY: number;
}

export function createSyntheticPressure(time: number, x: number, y: number): SyntheticPressureState {
  return { value: 0.58, lastTime: time, lastX: x, lastY: y };
}

/**
 * Estimates pressure for a pointer without a pressure sensor. Slow, deliberate
 * movement and dwells produce heavier ink; fast flicks produce lighter ink.
 * The signal is smoothed so mouse jitter does not produce a visibly noisy edge.
 */
export function nextSyntheticPressure(
  state: SyntheticPressureState,
  time: number,
  x: number,
  y: number,
): { state: SyntheticPressureState; pressure: number } {
  const dt = Math.max(1, time - state.lastTime);
  const moved = distance(state.lastX, state.lastY, x, y);
  const speed = moved / dt;
  const pause = dt > 80 ? clamp((dt - 80) / 160, 0, 1) : 0;
  const target = clamp(0.82 - clamp(speed / 1.4, 0, 1) * 0.45 + pause * 0.1, 0.2, 0.9);
  const value = clamp(state.value * 0.62 + target * 0.38, 0, 1);
  return {
    state: { value, lastTime: time, lastX: x, lastY: y },
    pressure: value,
  };
}

/**
 * Applies the user-facing strength and sensitivity. `strength` is the overall
 * gain; `sensitivity` is the base response curve. A gain of zero produces a
 * neutral 0.5 pressure (uniform strokes).
 */
export function shapePressure(raw: number, sensitivity: number, strength: number): number {
  const gain = clamp(sensitivity, 0, 1) * clamp(strength, 0, 2);
  return clamp(0.5 + (clamp(raw, 0, 1) - 0.5) * gain, 0, 1);
}
