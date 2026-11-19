import { fitView, renderScene, visibleInkBounds, type ResolvedTheme } from './renderer';
import type { Note } from './types';

/**
 * Notes list thumbnails are generated from vector data rather than captured
 * DOM, which keeps them sharp, tiny (WebP) and available offline. They are
 * created lazily after an edit; new empty notes use a CSS placeholder.
 */
export const THUMBNAIL_WIDTH = 384;
export const THUMBNAIL_HEIGHT = 240;

export function generateThumbnail(note: Note, theme: ResolvedTheme): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const inkBounds = visibleInkBounds(note.strokes.filter((stroke) => stroke.tool !== 'eraser'));
  const view = inkBounds
    ? fitView(inkBounds, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, 34, 1.2, 0.08)
    : { scale: 0.4, x: THUMBNAIL_WIDTH / 2, y: THUMBNAIL_HEIGHT / 2 };

  renderScene(canvas, {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    dpr: 1,
    view,
    background: note.background,
    theme,
    strokes: note.strokes,
  });

  // Imported notes without ink get a minimal "paper" mark over the backdrop.
  if (!inkBounds && note.markdown) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = theme === 'dark' ? 'rgba(21,27,37,0.94)' : 'rgba(255,255,255,0.94)';
      ctx.fillRect(58, 32, 268, 176);
      ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(15,27,44,0.09)';
      ctx.lineWidth = 1;
      ctx.strokeRect(58.5, 32.5, 267, 175);
      ctx.fillStyle = theme === 'dark' ? 'rgba(255,255,255,0.42)' : 'rgba(15,27,44,0.4)';
      for (let i = 0; i < 5; i += 1) {
        ctx.fillRect(80, 62 + i * 24, i === 0 ? 148 : 214 - (i % 2) * 52, 5);
      }
    }
  }

  try {
    return canvas.toDataURL('image/webp', 0.72);
  } catch {
    return canvas.toDataURL('image/png');
  }
}
