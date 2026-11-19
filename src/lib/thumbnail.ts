import { fitView, renderScene, visibleInkBounds, type ResolvedTheme } from './renderer';
import type { Note } from './types';

/**
 * Notes list previews are generated from vector data and Markdown metadata,
 * not from a DOM screenshot. Fingerprint-sized WebP files stay sharp at every
 * density, work offline, and avoid rasterising four full-screen editor layers
 * for every note in the library.
 */
export const THUMBNAIL_WIDTH = 384;
export const THUMBNAIL_HEIGHT = 240;

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function plainMarkdown(source: string): string {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[`*_~=]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const char of text) {
    const next = current + char;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current.trimEnd());
      current = char === ' ' ? '' : char;
      if (lines.length === maxLines) break;
    } else {
      current = next;
    }
  }
  if (lines.length < maxLines && current.trim()) lines.push(current.trimEnd());
  if (lines.length === maxLines && text.length > lines.join('').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[，。,.!?;:、…]+$/, '')}…`;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function loadImage(source: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(source);
  if (cached) return cached;
  if (imageCache.size > 12) imageCache.clear();
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
  imageCache.set(source, promise);
  return promise;
}

function firstDataImage(note: Note): string | null {
  for (const value of Object.values(note.assets ?? {})) {
    if (value.startsWith('data:image/')) return value;
  }
  const inline = note.markdown.match(/!\[[^\]]*\]\((data:image\/[^)\s]+)/);
  return inline?.[1] ?? null;
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!image.naturalWidth || !image.naturalHeight) return;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.save();
  roundRect(ctx, x, y, width, height, 5);
  ctx.clip();
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  ctx.restore();
}

async function markdownThumbnail(note: Note, theme: ResolvedTheme): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = theme === 'dark' ? '#0f151f' : '#e8edf5';
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  const wash = ctx.createRadialGradient(80, 0, 0, 80, 0, 360);
  wash.addColorStop(0, theme === 'dark' ? 'rgba(76,194,255,0.11)' : 'rgba(255,255,255,0.7)');
  wash.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

  ctx.save();
  ctx.shadowColor = theme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(31,48,74,0.24)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#fcfbf6';
  roundRect(ctx, 10, 8, 364, 224, 8);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, 10, 8, 364, 224, 8);
  ctx.clip();

  // A warm paper edge and hairline keep the preview legible on dark glass.
  const paperWash = ctx.createLinearGradient(10, 8, 374, 232);
  paperWash.addColorStop(0, 'rgba(255,255,255,0.42)');
  paperWash.addColorStop(0.55, 'rgba(255,255,255,0)');
  paperWash.addColorStop(1, 'rgba(221,224,218,0.28)');
  ctx.fillStyle = paperWash;
  ctx.fillRect(10, 8, 364, 224);

  const imageSource = firstDataImage(note);
  const image = imageSource ? await loadImage(imageSource) : null;
  const contentWidth = 314;
  const left = 35;
  let y = 40;

  ctx.font = '700 19px "Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei UI", sans-serif';
  ctx.fillStyle = '#182033';
  const titleLines = wrapCanvasText(ctx, note.title.trim() || 'Untitled note', contentWidth, 2);
  for (const line of titleLines) {
    ctx.fillText(line, left, y);
    y += 22;
  }

  ctx.fillStyle = 'rgba(43,127,255,0.8)';
  roundRect(ctx, left, y - 4, 28, 3, 2);
  ctx.fill();
  y += image ? 15 : 20;

  ctx.font = '400 11px "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif';
  ctx.fillStyle = '#697586';
  const excerpt = plainMarkdown(note.markdown);
  const textLines = wrapCanvasText(ctx, excerpt, contentWidth, image ? 2 : 6);
  for (const line of textLines) {
    ctx.fillText(line, left, y);
    y += 15;
  }

  if (image) {
    drawImageCover(ctx, image, 25, 152, 334, 84);
    ctx.strokeStyle = 'rgba(31,46,68,0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, 25.5, 152.5, 333, 83, 5);
    ctx.stroke();
  }

  // A miniature type badge in the corner of the paper.
  ctx.fillStyle = 'rgba(43,127,255,0.1)';
  roundRect(ctx, 319, 23, 38, 17, 4);
  ctx.fill();
  ctx.fillStyle = '#2b7fff';
  ctx.font = '700 9px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MD', 338, 35);
  ctx.textAlign = 'left';
  ctx.restore();

  ctx.strokeStyle = 'rgba(20,32,50,0.09)';
  ctx.lineWidth = 1;
  roundRect(ctx, 10.5, 8.5, 363, 223, 8);
  ctx.stroke();
  return canvas;
}

export async function generateThumbnail(note: Note, theme: ResolvedTheme): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined;
  try {
    let canvas: HTMLCanvasElement;
    if (note.markdown) {
      canvas = await markdownThumbnail(note, theme);
    } else {
      canvas = document.createElement('canvas');
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
    }
    return canvas.toDataURL('image/webp', 0.74);
  } catch {
    try {
      const fallback = document.createElement('canvas');
      fallback.width = THUMBNAIL_WIDTH;
      fallback.height = THUMBNAIL_HEIGHT;
      return fallback.toDataURL('image/webp', 0.6);
    } catch {
      return undefined;
    }
  }
}
