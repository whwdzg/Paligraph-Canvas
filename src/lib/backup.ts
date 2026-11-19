import type { Stroke } from './types';

/** Start gently reminding about editable-file backups after this many ink strokes. */
export const BACKUP_STROKE_THRESHOLD = 100;

export function inkStrokeCount(strokes: readonly Stroke[]): number {
  return strokes.filter((stroke) => stroke.tool !== 'eraser').length;
}

export function shouldSuggestBackup(strokes: readonly Stroke[]): boolean {
  return inkStrokeCount(strokes) > BACKUP_STROKE_THRESHOLD;
}
