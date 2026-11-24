import {
  boundsCenter,
  boundsIntersect,
  clamp,
  expandBounds,
  pointsBounds,
  rotatePoint,
} from './geometry';
import { isOpenShape } from './shapes';
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

function niceAxisStep(scale: number, targetPixels = 64): number {
  const raw = targetPixels / Math.max(0.1, scale);
  const exponent = Math.floor(Math.log10(raw));
  const magnitude = 10 ** exponent;
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function minorAxisStep(scale: number): number {
  // At 600% one world unit is 6 screen pixels. Keep a real 1-unit grid there
  // instead of jumping to 10/20-unit graph paper.
  if (scale >= 5.5) return 1;
  return Math.max(1, niceAxisStep(scale, 12));
}

function formatAxisNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0)) return '0';
  if (Math.abs(rounded) >= 10000) return rounded.toExponential(1).replace('e+', 'e');
  return String(rounded);
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  background: BackgroundSettings,
  theme: ResolvedTheme,
  view: ViewTransform,
  width: number,
  height: number,
): void {
  const originX = view.x;
  const originY = view.y;
  const onScreenX = originX >= -1 && originX <= width + 1;
  const onScreenY = originY >= -1 && originY <= height + 1;
  if (!onScreenX && !onScreenY) return;

  const color = background.color || (theme === 'light' ? '#53657d' : '#cad7e7');
  const alpha = clamp(background.opacity + 0.26, 0.28, 0.86);
  const minor = minorAxisStep(view.scale);
  const major = minor * 5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.setLineDash([]);
  ctx.font = '10px "Segoe UI Variable", "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';

  const leftWorld = (0 - view.x) / view.scale;
  const rightWorld = (width - view.x) / view.scale;
  const topWorld = (0 - view.y) / view.scale;
  const bottomWorld = (height - view.y) / view.scale;
  const firstMinorX = Math.ceil(leftWorld / minor) * minor;
  const firstMinorY = Math.ceil(topWorld / minor) * minor;
  const firstMajorX = Math.ceil(leftWorld / major) * major;
  const firstMajorY = Math.ceil(topWorld / major) * major;

  // A real straight-line grid under the axes. At 600% this is a 1-unit grid,
  // with every fifth line promoted to a major line.
  ctx.globalAlpha = clamp(alpha * 0.34, 0.08, 0.38);
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  for (let value = firstMinorX; value <= rightWorld + minor * 0.01; value += minor) {
    if (Math.abs(value) < minor * 0.001) continue;
    const x = view.x + value * view.scale;
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let value = firstMinorY; value <= bottomWorld + minor * 0.01; value += minor) {
    if (Math.abs(value) < minor * 0.001) continue;
    const y = view.y + value * view.scale;
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();

  ctx.globalAlpha = clamp(alpha * 0.58, 0.14, 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let value = firstMajorX; value <= rightWorld + major * 0.01; value += major) {
    if (Math.abs(value) < major * 0.001) continue;
    const x = view.x + value * view.scale;
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let value = firstMajorY; value <= bottomWorld + major * 0.01; value += major) {
    if (Math.abs(value) < major * 0.001) continue;
    const y = view.y + value * view.scale;
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();

  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.35;
  if (onScreenY) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(originY) + 0.5);
    ctx.lineTo(width, Math.round(originY) + 0.5);
    ctx.stroke();
  }
  if (onScreenX) {
    ctx.beginPath();
    ctx.moveTo(Math.round(originX) + 0.5, 0);
    ctx.lineTo(Math.round(originX) + 0.5, height);
    ctx.stroke();
  }

  // Unit ticks along each axis; numbers only at major intervals so they never
  // collide when the 1-unit grid is visible.
  ctx.lineWidth = 1;
  ctx.globalAlpha = clamp(alpha * 0.9, 0.2, 0.82);
  if (onScreenY) {
    for (let value = firstMinorX; value <= rightWorld + minor * 0.01; value += minor) {
      if (Math.abs(value) < minor * 0.001) continue;
      const x = view.x + value * view.scale;
      const isMajor = Math.abs(value / major - Math.round(value / major)) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(x, originY - (isMajor ? 5 : 2.5));
      ctx.lineTo(x, originY + (isMajor ? 5 : 2.5));
      ctx.stroke();
    }
  }
  if (onScreenX) {
    for (let value = firstMinorY; value <= bottomWorld + minor * 0.01; value += minor) {
      if (Math.abs(value) < minor * 0.001) continue;
      const y = view.y + value * view.scale;
      const isMajor = Math.abs(value / major - Math.round(value / major)) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(originX - (isMajor ? 5 : 2.5), y);
      ctx.lineTo(originX + (isMajor ? 5 : 2.5), y);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = alpha;
  if (onScreenY) {
    for (let value = firstMajorX; value <= rightWorld + major * 0.01; value += major) {
      if (Math.abs(value) < major * 0.001) continue;
      if (originY + 16 >= height) continue;
      const x = view.x + value * view.scale;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(formatAxisNumber(value), x, originY + 9);
      ctx.textBaseline = 'middle';
    }
  }
  if (onScreenX) {
    for (let value = firstMajorY; value <= bottomWorld + major * 0.01; value += major) {
      if (Math.abs(value) < major * 0.001) continue;
      if (originX - 8 <= 8) continue;
      const y = view.y + value * view.scale;
      ctx.textAlign = 'right';
      ctx.fillText(formatAxisNumber(value), originX - 7, y);
    }
  }

  // Direction arrowheads and axis labels.
  if (onScreenY) {
    const tipX = width - 9;
    ctx.beginPath();
    ctx.moveTo(tipX, originY);
    ctx.lineTo(tipX - 7, originY - 4);
    ctx.lineTo(tipX - 7, originY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('x', width - 4, originY - 7);
  }
  if (onScreenX) {
    const tipY = 9;
    ctx.beginPath();
    ctx.moveTo(originX, tipY);
    ctx.lineTo(originX - 4, tipY + 7);
    ctx.lineTo(originX + 4, tipY + 7);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('y', originX + 7, 4);
  }

  if (onScreenX && onScreenY) {
    ctx.beginPath();
    ctx.arc(originX, originY, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('O', originX + 6, originY + 7);
  }

  ctx.restore();
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

  if (background.pattern === 'axes') {
    drawAxes(ctx, background, theme, view, width, height);
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

function traceRibbon(
  ctx: CanvasRenderingContext2D,
  points: readonly InkPoint[],
  baseWidth: number,
  seed: number,
  rough = 0,
  taper = 0,
): void {
  if (!points.length) return;
  const left: InkPoint[] = [];
  const right: InkPoint[] = [];
  const widths: number[] = [];
  const angles: number[] = [];
  const count = points.length;
  const taperSpan = Math.min(5, Math.max(1, count - 1));
  for (let i = 0; i < count; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(count - 1, i + 1)];
    let nx = -(next.y - prev.y);
    let ny = next.x - prev.x;
    const length = Math.hypot(nx, ny) || 1;
    nx /= length;
    ny /= length;
    const edge = Math.min(i, count - 1 - i);
    // A gentle tip taper makes pen and brush strokes feel like ink deposited
    // by a moving nib instead of a constant-width tube.
    const taperFactor = count > 4 && taper > 0
      ? (1 - taper) + taper * Math.min(1, edge / taperSpan)
      : 1;
    const width = Math.max(0.7, baseWidth * (0.38 + clamp(points[i].p, 0, 1) * 0.92) * taperFactor);
    widths.push(width);
    angles.push(Math.atan2(ny, nx));
    // Keep the very first/last cross-section symmetrical so the round cap can
    // be a true semicircle centred exactly on the input point.
    const jitter = rough && i > 0 && i < count - 1 ? seeded(seed, i, 1) * rough : 0;
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
  const endPoint = points[count - 1];
  const endAngle = angles[angles.length - 1];
  // The old implementation centred the cap on the offset edge, which shifted
  // the last few pixels sideways. A semicircle around the actual endpoint
  // joins the two ribbon edges exactly.
  ctx.arc(endPoint.x, endPoint.y, widths[widths.length - 1] / 2, endAngle, endAngle + Math.PI, true);
  for (let i = right.length - 2; i > 0; i -= 1) {
    const midX = (right[i].x + right[i + 1].x) / 2;
    const midY = (right[i].y + right[i + 1].y) / 2;
    ctx.quadraticCurveTo(right[i].x, right[i].y, midX, midY);
  }
  ctx.lineTo(right[0].x, right[0].y);
  const startPoint = points[0];
  const startAngle = angles[0];
  // From the right edge around the tail (not through the stroke body) to the
  // left edge; this is the mirror of the end cap above.
  ctx.arc(startPoint.x, startPoint.y, widths[0] / 2, startAngle + Math.PI, startAngle, true);
  ctx.closePath();
}

function ribbonPath(
  ctx: CanvasRenderingContext2D,
  points: readonly InkPoint[],
  baseWidth: number,
  seed: number,
  rough = 0,
  taper = 0,
): void {
  traceRibbon(ctx, points, baseWidth, seed, rough, taper);
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
  options: { base?: number; dash?: readonly [number, number] } = {},
): void {
  // Grain lives inside the tip caps. Including the exact endpoints would make
  // several translucent hairs converge on one pixel and leave a dark speck.
  const start = points.length > 3 ? 1 : 0;
  const end = points.length > 3 ? points.length - 1 : points.length;
  if (end - start < 2) return;
  ctx.beginPath();
  for (let i = start; i < end; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
    const nx = -(next.y - prev.y) / length;
    const ny = (next.x - prev.x) / length;
    const edge = Math.min(i, points.length - 1 - i);
    const edgeFactor = Math.min(1, edge / 2);
    const offset = (options.base ?? 0) + seeded(seed, i, 2) * amount * edgeFactor;
    const x = points[i].x + nx * offset;
    const y = points[i].y + ny * offset;
    if (i === start) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(options.dash ? [...options.dash] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Same-hue ink shade used for grooves and graphite flecks. Canvas alpha alone
 * cannot make texture visible on an already opaque body, because compositing
 * the same colour over itself is a no-op.
 */
function shadeColor(color: string, factor: number): string {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return color;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map((part) => part + part).join('');
  const value = Number.parseInt(hex, 16);
  const target = factor < 1 ? 0 : 255;
  const amount = factor < 1 ? 1 - factor : factor - 1;
  const channel = (shift: number): number => {
    const base = (value >> shift) & 0xff;
    return Math.round(clamp(base + (target - base) * amount, 0, 255));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function strokeLength(points: readonly InkPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

interface StrokeSample {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}

function sampleStrokeAt(
  points: readonly InkPoint[],
  cumulative: readonly number[],
  distance: number,
): StrokeSample {
  let segment = 1;
  while (segment < cumulative.length - 1 && cumulative[segment] < distance) segment += 1;
  const start = points[Math.max(0, segment - 1)];
  const end = points[Math.min(points.length - 1, segment)];
  const span = Math.max(0.001, cumulative[segment] - cumulative[segment - 1]);
  const t = clamp((distance - cumulative[segment - 1]) / span, 0, 1);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: start.x + dx * t,
    y: start.y + dy * t,
    tx: dx / length,
    ty: dy / length,
    nx: -dy / length,
    ny: dx / length,
  };
}

/** Short, direction-following graphite/wax flecks. */
function textureDashes(
  ctx: CanvasRenderingContext2D,
  points: readonly InkPoint[],
  seed: number,
  count: number,
  dashLength: number,
  dashWidth: number,
  spread: number,
): void {
  const cumulative: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      ),
    );
  }
  const total = cumulative[cumulative.length - 1];
  if (total < 1) return;
  ctx.beginPath();
  for (let index = 0; index < count; index += 1) {
    const along = total * (0.08 + ((index + 0.35 + seeded(seed, index, 8) * 0.3) / count) * 0.84);
    const sample = sampleStrokeAt(points, cumulative, along);
    const offset = (seeded(seed, index, 9) - 0.5) * 2 * spread;
    const x = sample.x + sample.nx * offset;
    const y = sample.y + sample.ny * offset;
    const length = dashLength * (0.55 + seeded(seed, index, 10) * 0.9);
    const tilt = (seeded(seed, index, 11) - 0.5) * 0.32;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const dx = (sample.tx * cos - sample.ty * sin) * length * 0.5;
    const dy = (sample.tx * sin + sample.ty * cos) * length * 0.5;
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
  }
  ctx.lineWidth = dashWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Deterministic graphite/wax dust inside the body. */
function textureSpeckles(
  points: readonly InkPoint[],
  ctx: CanvasRenderingContext2D,
  seed: number,
  spread: number,
  radius: number,
  count: number,
): void {
  const cumulative: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      ),
    );
  }
  const total = cumulative[cumulative.length - 1];
  if (total < 1) return;
  ctx.beginPath();
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    const distance = total * (0.08 + (index / Math.max(1, count - 1)) * 0.84);
    while (segment < cumulative.length - 1 && cumulative[segment] < distance) segment += 1;
    const start = points[Math.max(0, segment - 1)];
    const end = points[Math.min(points.length - 1, segment)];
    const span = Math.max(0.001, cumulative[segment] - cumulative[segment - 1]);
    const t = clamp((distance - cumulative[segment - 1]) / span, 0, 1);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = seeded(seed, index, 6) * spread;
    const x = start.x + dx * t - (dy / length) * offset;
    const y = start.y + dy * t + (dx / length) * offset;
    const r = Math.max(0.22, radius * (0.7 + seeded(seed, index, 7) * 0.7));
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * Each brush mixes overlapping pigments differently. Multiply keeps pen and
 * graphite clean, darken preserves wax saturation and color-burn pools brush
 * pigment where wet strokes cross. Erasers are handled separately.
 */
export function inkBlendMode(stroke: Pick<Stroke, 'tool' | 'variant'>): GlobalCompositeOperation {
  if (stroke.tool === 'eraser') return 'destination-out';
  if (stroke.tool === 'highlighter') return 'multiply';
  if (stroke.variant === 'crayon') return 'darken';
  if (stroke.variant === 'brush') return 'color-burn';
  return 'multiply';
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
    ctx.globalCompositeOperation = inkBlendMode(stroke);
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

  ctx.globalCompositeOperation = inkBlendMode(stroke);

  if (stroke.tool === 'highlighter') {
    const opacity = clamp(stroke.opacity, 0.08, 0.55);
    if (points.length === 1) {
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // A barely visible wider pass suggests the soft bleed at the edge of a
      // felt-tip highlighter; the crisp pass keeps the centre legible.
      ctx.globalAlpha = opacity * 0.16;
      ctx.lineWidth = stroke.size * 1.08;
      traceSmoothPath(ctx, points);
      ctx.stroke();
      ctx.globalAlpha = opacity;
      ctx.lineWidth = stroke.size;
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
    if (stroke.shape === 'cross') {
      // A cross is stored as two independent diagonals: TL→BR and TR→BL.
      if (points.length >= 4) {
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.moveTo(points[2].x, points[2].y);
        ctx.lineTo(points[3].x, points[3].y);
      }
    } else if (stroke.shape === 'ellipse' || stroke.shape === 'circle') {
      for (let i = 0; i < points.length; i += 1) {
        if (i === 0) ctx.moveTo(points[i].x, points[i].y);
        else ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
    } else {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
      if (!isOpenShape(stroke.shape)) ctx.closePath();
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
    // Graphite: a light tooth body, short dark flecks, then dust. Dashes stay
    // short so the result reads as paper tooth rather than a wire mesh.
    ctx.globalAlpha = clamp(stroke.opacity * 0.54, 0.12, 0.72);
    ribbonPath(ctx, points, stroke.size, stroke.seed, stroke.size * 0.09);
    ctx.globalAlpha = clamp(stroke.opacity * 0.22, 0.08, 0.38);
    ribbonPath(ctx, points, stroke.size * 0.66, stroke.seed + 17, stroke.size * 0.06);
    ctx.save();
    traceRibbon(ctx, points, stroke.size, stroke.seed, stroke.size * 0.09);
    ctx.clip();
    ctx.strokeStyle = shadeColor(stroke.color, 0.46);
    ctx.globalAlpha = clamp(stroke.opacity * 0.42, 0.14, 0.58);
    textureDashes(
      ctx,
      points,
      stroke.seed + 619,
      Math.round(clamp(strokeLength(points) / 5, 32, 100)),
      Math.max(0.35, stroke.size * 0.18),
      Math.max(0.3, stroke.size * 0.04),
      stroke.size * 0.22,
    );
    ctx.strokeStyle = shadeColor(stroke.color, 0.56);
    ctx.globalAlpha = clamp(stroke.opacity * 0.18, 0.06, 0.32);
    for (let pass = 0; pass < 3; pass += 1) {
      jitterPath(
        ctx,
        points,
        stroke.seed + 919 + pass * 37,
        stroke.size * 0.16,
        Math.max(0.4, stroke.size * 0.035),
        {
          dash: [
            Math.max(0.35, stroke.size * (0.18 + pass * 0.04)),
            Math.max(0.4, stroke.size * 0.16),
          ],
        },
      );
    }
    ctx.strokeStyle = shadeColor(stroke.color, 0.7);
    ctx.globalAlpha = clamp(stroke.opacity * 0.1, 0.03, 0.2);
    ctx.lineWidth = Math.max(0.45, stroke.size * 0.05);
    traceSmoothPath(ctx, points);
    ctx.stroke();
    ctx.fillStyle = shadeColor(stroke.color, 0.4);
    ctx.globalAlpha = clamp(stroke.opacity * 0.55, 0.16, 0.7);
    textureSpeckles(
      points,
      ctx,
      stroke.seed + 311,
      stroke.size * 0.24,
      Math.max(0.24, stroke.size * 0.036),
      Math.round(clamp(strokeLength(points) / 4, 42, 120)),
    );
    ctx.restore();
  } else if (stroke.variant === 'crayon') {
    // Crayon: broad wax body, uneven bands, broken streaks and coarse dust.
    ctx.globalAlpha = clamp(stroke.opacity * 0.46, 0.12, 0.68);
    ribbonPath(ctx, points, stroke.size * 1.06, stroke.seed, stroke.size * 0.27);
    ctx.save();
    traceRibbon(ctx, points, stroke.size * 1.06, stroke.seed, stroke.size * 0.27);
    ctx.clip();
    ctx.strokeStyle = shadeColor(stroke.color, 0.7);
    ctx.globalAlpha = clamp(stroke.opacity * 0.24, 0.08, 0.44);
    for (let pass = 0; pass < 4; pass += 1) {
      jitterPath(
        ctx,
        points,
        stroke.seed + pass * 61,
        stroke.size * 0.15,
        Math.max(0.7, stroke.size * 0.22),
        {
          base: (-0.32 + pass * 0.21) * stroke.size,
          dash: [Math.max(1.2, stroke.size * (1.2 + pass * 0.3)), Math.max(0.6, stroke.size * 0.18)],
        },
      );
    }
    ctx.strokeStyle = shadeColor(stroke.color, 0.58);
    ctx.globalAlpha = clamp(stroke.opacity * 0.26, 0.1, 0.46);
    textureDashes(
      ctx,
      points,
      stroke.seed + 733,
      Math.round(clamp(strokeLength(points) / 6, 26, 70)),
      Math.max(0.8, stroke.size * 0.62),
      Math.max(0.5, stroke.size * 0.07),
      stroke.size * 0.29,
    );
    ctx.fillStyle = shadeColor(stroke.color, 0.52);
    ctx.globalAlpha = clamp(stroke.opacity * 0.36, 0.1, 0.52);
    textureSpeckles(
      points,
      ctx,
      stroke.seed + 401,
      stroke.size * 0.27,
      Math.max(0.32, stroke.size * 0.055),
      Math.round(clamp(strokeLength(points) / 8, 24, 60)),
    );
    ctx.restore();
  } else if (stroke.variant === 'brush') {
    // Brush: tapered ink body with separated bristle hairs and a darker spine.
    ctx.globalAlpha = clamp(stroke.opacity * 0.12, 0.03, 0.18);
    ribbonPath(ctx, points, stroke.size * 1.28, stroke.seed, stroke.size * 0.11, 0.5);
    ctx.globalAlpha = clamp(stroke.opacity, 0.15, 1);
    ribbonPath(ctx, points, stroke.size * 1.16, stroke.seed, stroke.size * 0.05, 0.55);
    ctx.save();
    traceRibbon(ctx, points, stroke.size * 1.16, stroke.seed, stroke.size * 0.05, 0.55);
    ctx.clip();
    ctx.strokeStyle = shadeColor(stroke.color, 0.56);
    ctx.globalAlpha = clamp(stroke.opacity * 0.4, 0.12, 0.55);
    for (let pass = 0; pass < 9; pass += 1) {
      jitterPath(
        ctx,
        points,
        stroke.seed + 131 + pass * 73,
        stroke.size * 0.035,
        Math.max(0.7, stroke.size * (0.04 + (pass % 3) * 0.016)),
        {
          // Continuous bristle grooves; dashed hairs looked like ladder rungs.
          base: (-0.44 + pass * 0.11) * stroke.size,
        },
      );
    }
    ctx.strokeStyle = shadeColor(stroke.color, 1.28);
    ctx.globalAlpha = clamp(stroke.opacity * 0.13, 0.04, 0.2);
    for (let pass = 0; pass < 3; pass += 1) {
      jitterPath(
        ctx,
        points,
        stroke.seed + 811 + pass * 47,
        stroke.size * 0.03,
        Math.max(0.55, stroke.size * 0.05),
        { base: (-0.22 + pass * 0.22) * stroke.size },
      );
    }
    ctx.strokeStyle = shadeColor(stroke.color, 0.66);
    ctx.globalAlpha = clamp(stroke.opacity * 0.2, 0.06, 0.32);
    ctx.lineWidth = Math.max(0.5, stroke.size * 0.26);
    traceSmoothPath(ctx, points);
    ctx.stroke();
    ctx.restore();
  } else {
    // Pen: a soft ink bleed, dense body and a slightly darker moist core.
    ctx.globalAlpha = clamp(stroke.opacity * 0.12, 0.03, 0.2);
    ribbonPath(ctx, points, stroke.size * 1.12, stroke.seed, stroke.size * 0.035, 0.24);
    ctx.globalAlpha = clamp(stroke.opacity, 0.15, 1);
    ribbonPath(ctx, points, stroke.size, stroke.seed, stroke.size * 0.018, 0.24);
    ctx.strokeStyle = shadeColor(stroke.color, 0.82);
    ctx.globalAlpha = clamp(stroke.opacity * 0.16, 0.04, 0.24);
    ctx.lineWidth = Math.max(0.55, stroke.size * 0.28);
    traceSmoothPath(ctx, points);
    ctx.stroke();
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
