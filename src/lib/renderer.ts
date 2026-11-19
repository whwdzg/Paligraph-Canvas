import {
  boundsCenter,
  boundsIntersect,
  clamp,
  expandBounds,
  pointsBounds,
  rotatePoint,
} from './geometry';
import { strokeBounds } from './strokes';
import type {
  BackgroundSettings,
  Bounds,
  InkPoint,
  Selection,
  Stroke,
  ViewTransform,
} from './types';

/** Palette shared with the CSS design tokens. */
export const INK_ACCENT = '#2b7fff';

export type ResolvedTheme = 'light' | 'dark';

export interface SceneOptions {
  width: number;
  height: number;
  dpr: number;
  view: ViewTransform;
  background: BackgroundSettings;
  theme: ResolvedTheme;
  strokes: readonly Stroke[];
  hiddenIds?: ReadonlySet<string>;
}

const PAPER_LIGHT = '#fbfcff';
const PAPER_DARK = '#151b25';

const hash = (n: number): number => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  return (Math.imul(x, 0xc2b2ae35) ^ (x >>> 16)) >>> 0;
};

const seeded = (seed: number, index: number, channel = 0): number =>
  (hash(seed + index * 374761393 + channel * 668265263) / 0xffffffff) * 2 - 1;

/** Resets a canvas backing store only when its CSS/DPR size changed. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
): CanvasRenderingContext2D {
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

export function applyView(ctx: CanvasRenderingContext2D, view: ViewTransform): void {
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
}

export function screenToWorld(view: ViewTransform, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale };
}

export function worldToScreen(view: ViewTransform, x: number, y: number): { x: number; y: number } {
  return { x: x * view.scale + view.x, y: y * view.scale + view.y };
}

export function viewportWorldBounds(view: ViewTransform, width: number, height: number): Bounds {
  const a = screenToWorld(view, 0, 0);
  const b = screenToWorld(view, width, height);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

export function fitView(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 96,
  maximumScale = 1.8,
  minimumScale = 0.15,
): ViewTransform {
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clamp(
    Math.min((width - padding * 2) / boundsWidth, (height - padding * 2) / boundsHeight),
    minimumScale,
    maximumScale,
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale, x: width / 2 - cx * scale, y: height / 2 - cy * scale };
}

function paperColor(theme: ResolvedTheme): string {
  return theme === 'light' ? PAPER_LIGHT : PAPER_DARK;
}

/**
 * Draws the infinite paper. Patterns are generated in screen space so lines
 * stay perfectly crisp at every zoom level; the spacing snaps to powers of two
 * when shrinking so dense grids never turn into a performance sink.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  background: BackgroundSettings,
  theme: ResolvedTheme,
  view: ViewTransform,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.fillStyle = paperColor(theme);
  ctx.fillRect(0, 0, width, height);

  // A nearly invisible wash gives the flat paper depth without a bitmap texture.
  const wash = ctx.createRadialGradient(width * 0.32, height * 0.2, 0, width * 0.32, height * 0.2, Math.max(width, height));
  if (theme === 'light') {
    wash.addColorStop(0, 'rgba(255,255,255,0.72)');
    wash.addColorStop(0.55, 'rgba(244,247,252,0.2)');
    wash.addColorStop(1, 'rgba(226,233,244,0.28)');
  } else {
    wash.addColorStop(0, 'rgba(38,48,65,0.34)');
    wash.addColorStop(0.55, 'rgba(20,26,36,0.08)');
    wash.addColorStop(1, 'rgba(9,13,20,0.24)');
  }
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  if (background.pattern === 'blank') {
    ctx.restore();
    return;
  }

  const baseSpacing = clamp(background.spacing || 32, 8, 160);
  let screenSpacing = baseSpacing * view.scale;
  // Detail level of two: keep the pattern legible and cheap when zoomed out.
  while (screenSpacing < 12) screenSpacing *= 2;
  while (screenSpacing > 220) screenSpacing /= 2;

  const color = background.color || (theme === 'light' ? '#53657d' : '#cad7e7');
  const opacity = clamp(background.opacity, 0, 0.6);
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(background.lineStyle === 'dashed' ? [4, 6] : []);

  const offsetX = ((view.x % screenSpacing) + screenSpacing) % screenSpacing;
  const offsetY = ((view.y % screenSpacing) + screenSpacing) % screenSpacing;

  if (background.pattern === 'grid') {
    ctx.beginPath();
    for (let x = offsetX; x <= width + screenSpacing; x += screenSpacing) {
      const crisp = Math.round(x) + 0.5;
      ctx.moveTo(crisp, 0);
      ctx.lineTo(crisp, height);
    }
    for (let y = offsetY; y <= height + screenSpacing; y += screenSpacing) {
      const crisp = Math.round(y) + 0.5;
      ctx.moveTo(0, crisp);
      ctx.lineTo(width, crisp);
    }
    ctx.stroke();
  } else if (background.pattern === 'ruled') {
    ctx.beginPath();
    for (let y = offsetY; y <= height + screenSpacing; y += screenSpacing) {
      const crisp = Math.round(y) + 0.5;
      ctx.moveTo(0, crisp);
      ctx.lineTo(width, crisp);
    }
    ctx.stroke();
  } else if (background.pattern === 'dots') {
    const radius = clamp(view.scale * 1.1, 0.9, 2.1);
    ctx.beginPath();
    for (let x = offsetX; x <= width + screenSpacing; x += screenSpacing) {
      for (let y = offsetY; y <= height + screenSpacing; y += screenSpacing) {
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  ctx.restore();
}

function ribbonPath(
  ctx: CanvasRenderingContext2D,
  points: readonly InkPoint[],
  baseWidth: number,
  seed: number,
  rough = 0,
): void {
  if (!points.length) return;
  const left: InkPoint[] = [];
  const right: InkPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let nx = -(next.y - prev.y);
    let ny = next.x - prev.x;
    const length = Math.hypot(nx, ny) || 1;
    nx /= length;
    ny /= length;
    const width = Math.max(0.7, baseWidth * (0.38 + clamp(points[i].p, 0, 1) * 0.92));
    const jitter = rough ? seeded(seed, i, 1) * rough : 0;
    left.push({ ...points[i], x: points[i].x + nx * (width * 0.5 + jitter), y: points[i].y + ny * (width * 0.5 + jitter) });
    right.push({ ...points[i], x: points[i].x - nx * (width * 0.5 - jitter), y: points[i].y - ny * (width * 0.5 - jitter) });
  }

  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  if (left.length > 2) {
    for (let i = 1; i < left.length - 1; i += 1) {
      const midX = (left[i].x + left[i + 1].x) / 2;
      const midY = (left[i].y + left[i + 1].y) / 2;
      ctx.quadraticCurveTo(left[i].x, left[i].y, midX, midY);
    }
  }
  const lastLeft = left[left.length - 1];
  ctx.lineTo(lastLeft.x, lastLeft.y);
  const lastRight = right[right.length - 1];
  const capWidth = baseWidth * (0.38 + clamp(points[points.length - 1].p, 0, 1) * 0.92);
  // Rounded cap on the far end.
  ctx.arc(lastLeft.x, lastLeft.y, capWidth / 2, 0, Math.PI, false);
  ctx.lineTo(lastRight.x, lastRight.y);
  for (let i = right.length - 2; i > 0; i -= 1) {
    const midX = (right[i].x + right[i + 1].x) / 2;
    const midY = (right[i].y + right[i + 1].y) / 2;
    ctx.quadraticCurveTo(right[i].x, right[i].y, midX, midY);
  }
  ctx.lineTo(right[0].x, right[0].y);
  const firstWidth = baseWidth * (0.38 + clamp(points[0].p, 0, 1) * 0.92);
  ctx.arc(right[0].x, right[0].y, firstWidth / 2, Math.PI, Math.PI * 2, false);
  ctx.closePath();
  ctx.fill();
}

function traceSmoothPath(ctx: CanvasRenderingContext2D, points: readonly InkPoint[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    ctx.lineTo(points[0].x + 0.01, points[0].y);
    return;
  }
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
}

function jitterPath(
  ctx: CanvasRenderingContext2D,
  points: readonly InkPoint[],
  seed: number,
  amount: number,
  width: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
    const nx = -(next.y - prev.y) / length;
    const ny = (next.x - prev.x) / length;
    const offset = seeded(seed, i, 2) * amount;
    const x = points[i].x + nx * offset;
    const y = points[i].y + ny * offset;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Paints one stroke. Pixel erasers are rendered with destination-out. */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const points = stroke.points;
  if (!points.length) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = stroke.color;
  ctx.strokeStyle = stroke.color;

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
      ctx.lineWidth = stroke.size;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = clamp(stroke.opacity, 0.08, 0.55);
    ctx.lineWidth = stroke.size;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      traceSmoothPath(ctx, points);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // Corrected shapes use the stored polygon/ellipse points directly. This
  // keeps their corners crisp and still rotates/moves correctly because the
  // points themselves are transformed by the selection tools.
  if (stroke.shape) {
    ctx.globalAlpha = clamp(stroke.opacity, 0.15, 1);
    ctx.lineWidth = Math.max(0.8, stroke.size);
    ctx.beginPath();
    if (stroke.shape === 'ellipse') {
      for (let i = 0; i < points.length; i += 1) {
        if (i === 0) ctx.moveTo(points[i].x, points[i].y);
        else ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
    } else {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
      if (stroke.shape !== 'line') ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.globalAlpha = clamp(stroke.opacity, 0.15, 1);
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, Math.max(0.9, stroke.size / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (stroke.variant === 'pencil') {
    // Graphite: a soft body with three deterministic, offset grain lines.
    ctx.globalAlpha = clamp(stroke.opacity * 0.72, 0.12, 0.8);
    ribbonPath(ctx, points, stroke.size, stroke.seed, stroke.size * 0.06);
    ctx.globalAlpha = clamp(stroke.opacity * 0.14, 0.05, 0.4);
    for (let pass = 0; pass < 3; pass += 1) {
      jitterPath(ctx, points, stroke.seed + pass * 97, stroke.size * (0.14 + pass * 0.11), Math.max(0.55, stroke.size * 0.11));
    }
  } else if (stroke.variant === 'crayon') {
    ctx.globalAlpha = clamp(stroke.opacity * 0.56, 0.12, 0.72);
    ribbonPath(ctx, points, stroke.size, stroke.seed, stroke.size * 0.16);
    ctx.globalAlpha = clamp(stroke.opacity * 0.16, 0.06, 0.45);
    for (let pass = 0; pass < 5; pass += 1) {
      jitterPath(ctx, points, stroke.seed + pass * 53, stroke.size * (0.18 + pass * 0.08), Math.max(0.7, stroke.size * 0.13));
    }
  } else {
    // Pen and ink brush use a pressure-sensitive filled ribbon.
    ctx.globalAlpha = clamp(stroke.opacity, 0.15, 1);
    ribbonPath(ctx, points, stroke.size * (stroke.variant === 'brush' ? 1.22 : 1), stroke.seed, 0);
  }
  ctx.restore();
}

export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  hiddenIds?: ReadonlySet<string>,
  viewport?: Bounds,
): void {
  for (const stroke of strokes) {
    if (hiddenIds?.has(stroke.id)) continue;
    if (viewport && !boundsIntersect(strokeBounds(stroke), viewport)) continue;
    drawStroke(ctx, stroke);
  }
}

/** Full committed-ink pass. Only strokes intersecting the viewport are drawn. */
export function renderInk(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
  includeBackground = false,
): CanvasRenderingContext2D {
  const ctx = prepareCanvas(canvas, options.width, options.height, options.dpr);
  if (includeBackground) drawBackground(ctx, options.background, options.theme, options.view, options.width, options.height);
  const viewport = viewportWorldBounds(options.view, options.width, options.height);
  ctx.save();
  applyView(ctx, options.view);
  drawStrokes(ctx, options.strokes, options.hiddenIds, expandBounds(viewport, 48));
  ctx.restore();
  return ctx;
}

export function renderBackgroundLayer(canvas: HTMLCanvasElement, options: SceneOptions): void {
  const ctx = prepareCanvas(canvas, options.width, options.height, options.dpr);
  drawBackground(ctx, options.background, options.theme, options.view, options.width, options.height);
}

export interface SelectionPreview {
  dx: number;
  dy: number;
  rotation: number;
}

export interface OverlayOptions {
  selection: Selection | null;
  preview?: SelectionPreview | null;
  lasso?: readonly InkPoint[] | null;
  accent?: string;
}

export interface SelectionScreenGeometry {
  corners: Array<{ x: number; y: number }>;
  topMid: { x: number; y: number };
  rotateHandle: { x: number; y: number };
}

/** Shared by hit-testing and painting so the rotate handle is always clickable. */
export function selectionScreenGeometry(
  selection: Selection,
  view: ViewTransform,
  preview?: SelectionPreview | null,
): SelectionScreenGeometry {
  const state = preview ?? { dx: 0, dy: 0, rotation: selection.rotation };
  const corners = rotatedBoundsCorners(selection.bounds, state.rotation, state.dx, state.dy).map((point) =>
    worldToScreen(view, point.x, point.y),
  );
  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const center = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
  let ux = topMid.x - center.x;
  let uy = topMid.y - center.y;
  const length = Math.hypot(ux, uy);
  if (length < 0.01) {
    ux = 0;
    uy = -1;
  } else {
    ux /= length;
    uy /= length;
  }
  return {
    corners,
    topMid,
    rotateHandle: { x: topMid.x + ux * 34, y: topMid.y + uy * 34 },
  };
}

export function rotatedBoundsCorners(bounds: Bounds, angle: number, dx: number, dy: number): InkPoint[] {
  const center = boundsCenter(bounds);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((point) => {
    const rotated = rotatePoint(point.x, point.y, center.x, center.y, angle);
    return { ...rotated, x: rotated.x + dx, y: rotated.y + dy, p: 0.5 };
  });
}

/**
 * Selection chrome and lasso preview live on their own canvas, so moving a
 * selection doesn't force a full document repaint.
 */
export function renderOverlay(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
  view: ViewTransform,
  options: OverlayOptions,
): void {
  const ctx = prepareCanvas(canvas, width, height, dpr);
  const accent = options.accent ?? INK_ACCENT;

  if (options.lasso && options.lasso.length > 1) {
    ctx.save();
    ctx.beginPath();
    const first = worldToScreen(view, options.lasso[0].x, options.lasso[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < options.lasso.length; i += 1) {
      const p = worldToScreen(view, options.lasso[i].x, options.lasso[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(43,127,255,0.08)';
    ctx.fill();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.restore();
  }

  if (!options.selection) return;
  const { corners, topMid, rotateHandle } = selectionScreenGeometry(options.selection, view, options.preview);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(43,127,255,0.055)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accent;
  ctx.setLineDash([]);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(topMid.x, topMid.y);
  ctx.lineTo(rotateHandle.x, rotateHandle.y);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;

  for (const corner of corners) {
    ctx.beginPath();
    ctx.arc(corner.x, corner.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = accent;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(rotateHandle.x, rotateHandle.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rotateHandle.x, rotateHandle.y, 3, 0.35, Math.PI * 1.65);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

/** Utility used by the export pipeline to measure a document's ink footprint. */
export function visibleInkBounds(strokes: readonly Stroke[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const stroke of strokes) {
    if (stroke.tool === 'eraser') continue;
    const strokeBox = pointsBounds(stroke.points);
    bounds = bounds ? {
      minX: Math.min(bounds.minX, strokeBox.minX),
      minY: Math.min(bounds.minY, strokeBox.minY),
      maxX: Math.max(bounds.maxX, strokeBox.maxX),
      maxY: Math.max(bounds.maxY, strokeBox.maxY),
    } : strokeBox;
  }
  return bounds;
}

export function viewportForExport(bounds: Bounds, width: number, height: number, padding: number): ViewTransform {
  return fitView(bounds, width, height, padding, 4, 0.02);
}

export function renderScene(
  canvas: HTMLCanvasElement,
  options: Omit<SceneOptions, 'dpr'> & { dpr?: number },
): void {
  const dpr = options.dpr ?? 1;
  const full = { ...options, dpr };
  renderInk(canvas, full, true);
}

/** Exposed for the thumbnail generator and deterministic unit tests. */
export { paperColor };
