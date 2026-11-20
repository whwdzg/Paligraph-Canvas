import { rotatePoint } from './geometry';
import type { Bounds, InkPoint, NoteImage, NoteTextStyle } from './types';

/**
 * Canvas media helpers. Images are stored as data URLs so a note remains a
 * single portable document and exports can be produced offline. Decoded
 * HTMLImageElements are cached with a hard cap because a photo can occupy
 * several megabytes once expanded in memory.
 */

const MAX_CACHED_IMAGES = 24;
const decoded = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  const cached = decoded.get(src);
  if (cached) return cached;
  if (decoded.size >= MAX_CACHED_IMAGES) {
    const oldest = decoded.keys().next().value;
    if (oldest) decoded.delete(oldest);
  }
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  decoded.set(src, promise);
  return promise;
}

const loaded = new Map<string, HTMLImageElement>();

export async function ensureImage(src: string): Promise<HTMLImageElement | null> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const image = await loadImageElement(src);
  if (image) loaded.set(src, image);
  return image;
}

export function imageCenter(image: NoteImage): { x: number; y: number } {
  return { x: image.x + image.width / 2, y: image.y + image.height / 2 };
}

export function imageCorners(image: NoteImage): InkPoint[] {
  const cx = image.x + image.width / 2;
  const cy = image.y + image.height / 2;
  const corners = [
    [image.x, image.y],
    [image.x + image.width, image.y],
    [image.x + image.width, image.y + image.height],
    [image.x, image.y + image.height],
  ];
  return corners.map(([x, y]) => {
    const rotated = rotatePoint(x, y, cx, cy, image.rotation);
    return { ...rotated, p: 0.5 };
  });
}

export function imageBounds(image: NoteImage): Bounds {
  const corners = imageCorners(image);
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

export function hitTestImage(image: NoteImage, x: number, y: number, slop = 0): boolean {
  const center = imageCenter(image);
  const inverse = rotatePoint(x, y, center.x, center.y, -image.rotation);
  return (
    inverse.x >= image.x - slop &&
    inverse.x <= image.x + image.width + slop &&
    inverse.y >= image.y - slop &&
    inverse.y <= image.y + image.height + slop
  );
}

export function drawNoteImage(ctx: CanvasRenderingContext2D, image: NoteImage, element: HTMLImageElement): void {
  const center = imageCenter(image);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(image.rotation);
  ctx.drawImage(element, -image.width / 2, -image.height / 2, image.width, image.height);
  ctx.restore();
}

export function transformImage(
  image: NoteImage,
  dx: number,
  dy: number,
  angle: number,
  around: { x: number; y: number },
): NoteImage {
  const center = imageCenter(image);
  const rotated = rotatePoint(center.x, center.y, around.x, around.y, angle);
  return {
    ...image,
    x: rotated.x + dx - image.width / 2,
    y: rotated.y + dy - image.height / 2,
    rotation: image.rotation + angle,
  };
}

export function cloneNoteImage(image: NoteImage): NoteImage {
  return { ...image };
}

export function imagePlaceholder(
  ctx: CanvasRenderingContext2D,
  image: NoteImage,
  accent: string,
): void {
  const center = imageCenter(image);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(image.rotation);
  ctx.fillStyle = 'rgba(127, 140, 158, 0.15)';
  ctx.strokeStyle = 'rgba(127, 140, 158, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(-image.width / 2, -image.height / 2, image.width, image.height);
  ctx.strokeRect(-image.width / 2, -image.height / 2, image.width, image.height);
  ctx.beginPath();
  ctx.moveTo(-image.width * 0.32, image.height * 0.2);
  ctx.lineTo(-image.width * 0.04, -image.height * 0.12);
  ctx.lineTo(image.width * 0.15, image.height * 0.06);
  ctx.lineTo(image.width * 0.34, -image.height * 0.16);
  ctx.lineTo(image.width * 0.36, image.height * 0.22);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.restore();
}

export interface PreparedImage {
  src: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  /** Present for generated text blocks, so they remain re-editable. */
  text?: NoteTextStyle;
}

const MAX_SOURCE_BYTES = 18 * 1024 * 1024;
const MAX_RASTER_EDGE = 2400;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

function loadImageSource(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be decoded.'));
    image.src = src;
  });
}

/**
 * Normalises an imported image for the canvas. Raster photos are downscaled
 * and re-encoded as WebP; SVG remains vector so it stays sharp when resized.
 */
export async function prepareImageFile(file: File): Promise<PreparedImage> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Image is larger than 18 MB.');
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  const dataUrl = await readAsDataUrl(file);
  const element = await loadImageSource(dataUrl);
  let naturalWidth = element.naturalWidth || 800;
  let naturalHeight = element.naturalHeight || 600;
  let src = dataUrl;
  let mime = file.type || 'image/png';

  if (!isSvg) {
    const scale = Math.min(1, MAX_RASTER_EDGE / Math.max(naturalWidth, naturalHeight));
    if (scale < 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
        src = canvas.toDataURL('image/webp', 0.86);
        mime = 'image/webp';
        naturalWidth = canvas.width;
        naturalHeight = canvas.height;
      }
    }
  }

  return {
    src,
    name: file.name || 'Imported image',
    mime,
    width: naturalWidth,
    height: naturalHeight,
  };
}

export { MAX_RASTER_EDGE };
