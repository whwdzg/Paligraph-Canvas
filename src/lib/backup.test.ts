import { describe, expect, it } from 'vitest';
import { BACKUP_STROKE_THRESHOLD, inkStrokeCount, shouldSuggestBackup } from './backup';
import type { Stroke } from './types';

const stroke = (id: string, tool: Stroke['tool'] = 'pen'): Stroke => ({
  id,
  tool,
  variant: tool === 'eraser' ? 'pixel' : 'pen',
  color: '#000000',
  size: 4,
  opacity: 1,
  points: [{ x: 0, y: 0, p: 0.5 }],
  seed: 1,
  createdAt: 1,
});

describe('backup reminders', () => {
  it('counts visible ink but ignores eraser masks', () => {
    const strokes = [stroke('a'), stroke('b', 'eraser'), stroke('c', 'highlighter')];
    expect(inkStrokeCount(strokes)).toBe(2);
    expect(shouldSuggestBackup(strokes)).toBe(false);
  });

  it('suggests a backup only after exceeding the threshold', () => {
    const exactly = Array.from({ length: BACKUP_STROKE_THRESHOLD }, (_, index) => stroke(`s${index}`));
    expect(shouldSuggestBackup(exactly)).toBe(false);
    expect(shouldSuggestBackup([...exactly, stroke('extra')])).toBe(true);
  });
});
