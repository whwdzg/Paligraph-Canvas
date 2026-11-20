import {
  applyView,
  drawBackground,
  fitView,
  prepareCanvas,
  renderInk,
  visibleInkBounds,
} from './renderer';
import { normalizeObsidianMarkdown } from './markdown';
import { downloadBlob, safeFilename } from './download';
import { drawNoteImage, ensureImage, imageBounds } from './media';
import { unionBounds } from './geometry';
import { serializeEditableNote } from './editable';
import { isOpenShape } from './shapes';
import { strokeToPath } from './strokes';
import type { Bounds, Note, Stroke } from './types';

/**
 * Export pipeline.
 *
 * PDF pages are painted to an offscreen canvas using the system UI fonts. That
 * guarantees CJK glyphs render correctly without embedding a multi-megabyte
 * font in the bundle, and it lets us share the exact ink renderer used by the
 * editor. jsPDF is imported lazily only when the user exports.
 */

const PDF_WIDTH = 1240;
const PDF_HEIGHT = 1754;
const PDF_MARGIN = 104;

export interface ExportLabels {
  inkHeading: string;
  page: string;
  createdWith: string;
  emptyNote: string;
}

function contentBounds(note: Note): Bounds | null {
  let bounds = visibleInkBounds(note.strokes);
  for (const image of note.images ?? []) bounds = unionBounds(bounds, imageBounds(image));
  return bounds;
}

async function contentCanvas(note: Note, maxEdge = 1800): Promise<HTMLCanvasElement> {
  const bounds = contentBounds(note) ?? { minX: -600, minY: -400, maxX: 600, maxY: 400 };
  const aspect = Math.max(0.2, (bounds.maxX - bounds.minX) / Math.max(1, bounds.maxY - bounds.minY));
  let width = maxEdge;
  let height = Math.round(width / aspect);
  if (height > maxEdge) {
    height = maxEdge;
    width = Math.round(height * aspect);
  }
  width = Math.max(480, width);
  height = Math.max(320, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const view = fitView(bounds, width, height, 64, 3, 0.05);
  const ctx = prepareCanvas(canvas, width, height, 1);
  drawBackground(ctx, note.background, 'light', view, width, height);
  const images = await Promise.all((note.images ?? []).map(async (image) => ({ image, element: await ensureImage(image.src) })));
  ctx.save();
  applyView(ctx, view);
  for (const { image, element } of images) {
    if (element) drawNoteImage(ctx, image, element);
  }
  ctx.restore();
  const inkCanvas = document.createElement('canvas');
  inkCanvas.width = width;
  inkCanvas.height = height;
  renderInk(inkCanvas, {
    width,
    height,
    dpr: 1,
    view,
    background: note.background,
    theme: 'light',
    strokes: note.strokes,
  });
  ctx.drawImage(inkCanvas, 0, 0);
  return canvas;
}

function canvasDataUrl(canvas: HTMLCanvasElement, type = 'image/png'): string {
  return canvas.toDataURL(type, 0.92);
}

/** Markdown source plus an embedded snapshot when the note also contains ink. */
export async function noteToMarkdown(note: Note, labels: ExportLabels): Promise<string> {
  const parts: string[] = [];
  const source = note.markdown.trim();
  if (source) parts.push(source);
  else parts.push(`# ${note.title}`);
  const hasCanvas = Boolean(contentBounds(note));
  if (hasCanvas) {
    const drawing = await contentCanvas(note, 1400);
    parts.push(`\n\n---\n\n## ${labels.inkHeading}\n\n![${labels.inkHeading}](${canvasDataUrl(drawing)})`);
  }
  if (!source && !hasCanvas) parts.push(`\n\n_${labels.emptyNote}_`);
  parts.push(`\n\n<!-- ${labels.createdWith} · Paligraph Canvas -->\n`);
  return parts.join('');
}

export async function exportMarkdownFile(note: Note, labels: ExportLabels): Promise<void> {
  const blob = new Blob([await noteToMarkdown(note, labels)], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(safeFilename(note.title, 'md'), blob);
}

/* ------------------------------------------------------------------ PDF layout */

interface TextBlock {
  kind: 'heading' | 'paragraph' | 'bullets' | 'quote' | 'code' | 'rule' | 'image';
  level?: number;
  text: string;
  items?: string[];
  ordered?: boolean;
}

function stripInline(value: string): string {
  return value
    .replace(/!\[\[[^\]]+\]\]/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * Small, deliberate Markdown parser for print layout. It supports the
 * structures that read well on paper (headings, paragraphs, lists, quotes,
 * code, rules) while leaving unusual extensions as readable text.
 */
export function parsePrintBlocks(source: string): TextBlock[] {
  const text = normalizeObsidianMarkdown(source);
  const lines = text.split('\n');
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let inFence = false;
  let fence: string[] = [];
  let quote: string[] = [];
  let bullets: string[] = [];
  let ordered = false;

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    const value = stripInline(paragraph.join(' '));
    if (value) blocks.push({ kind: 'paragraph', text: value });
    paragraph = [];
  };
  const flushQuote = (): void => {
    if (!quote.length) return;
    blocks.push({ kind: 'quote', text: stripInline(quote.join(' ')) });
    quote = [];
  };
  const flushList = (): void => {
    if (!bullets.length) return;
    blocks.push({ kind: 'bullets', items: bullets.map(stripInline), text: '', ordered });
    bullets = [];
  };
  const flushAll = (): void => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      if (inFence) {
        blocks.push({ kind: 'code', text: fence.join('\n') });
        fence = [];
        inFence = false;
      } else {
        flushAll();
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fence.push(raw);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushAll();
      blocks.push({ kind: 'heading', level: heading[1].length, text: stripInline(heading[2]) });
      continue;
    }
    if (/^([-*_])\s*\1\s*\1[\s\S]*$/.test(line)) {
      flushAll();
      blocks.push({ kind: 'rule', text: '' });
      continue;
    }
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }
    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      const isOrdered = /^\d/.test(listMatch[1]);
      if (bullets.length && ordered !== isOrdered) flushList();
      ordered = isOrdered;
      bullets.push(listMatch[2]);
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (image) {
      flushAll();
      blocks.push({ kind: 'image', text: image[1] || 'Image' });
      continue;
    }
    flushQuote();
    flushList();
    paragraph.push(line);
  }
  flushAll();
  if (inFence && fence.length) blocks.push({ kind: 'code', text: fence.join('\n') });
  return blocks;
}

const PDF_FONT = '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const PDF_DISPLAY = '"Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let current = '';
    let lastBreak = -1;
    for (const char of paragraph) {
      const next = current + char;
      if (ctx.measureText(next).width > maxWidth && current) {
        if (lastBreak > Math.floor(current.length * 0.45)) {
          lines.push(current.slice(0, lastBreak).trimEnd());
          current = `${current.slice(lastBreak).trimStart()}${char}`;
        } else {
          lines.push(current.trimEnd());
          current = char === ' ' ? '' : char;
        }
        lastBreak = -1;
      } else {
        current = next;
        if (char === ' ' || /[，。！？、；：,.!?;:]/.test(char)) lastBreak = current.length;
      }
    }
    if (current.trim()) lines.push(current.trimEnd());
  }
  return lines;
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  maxY: number,
  color?: string,
): number {
  ctx.fillStyle = color ?? '#202631';
  for (const line of lines) {
    if (y + lineHeight > maxY) break;
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

interface PageContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  pageNumber: number;
  y: number;
}

function newPage(title: string, labels: ExportLabels): PageContext {
  const canvas = document.createElement('canvas');
  canvas.width = PDF_WIDTH;
  canvas.height = PDF_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.fillStyle = '#fcfcfa';
  ctx.fillRect(0, 0, PDF_WIDTH, PDF_HEIGHT);
  ctx.fillStyle = 'rgba(31,111,235,0.9)';
  ctx.fillRect(0, 0, PDF_WIDTH, 8);
  ctx.font = `600 17px ${PDF_FONT}`;
  ctx.fillStyle = '#7a8598';
  ctx.fillText(title.slice(0, 70), PDF_MARGIN, 58);
  ctx.textAlign = 'right';
  ctx.fillText('PALIGRAPH', PDF_WIDTH - PDF_MARGIN, 58);
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(31,42,58,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PDF_MARGIN, 80.5);
  ctx.lineTo(PDF_WIDTH - PDF_MARGIN, 80.5);
  ctx.stroke();
  ctx.font = `15px ${PDF_FONT}`;
  ctx.fillStyle = '#8a95a6';
  ctx.fillText(labels.page.replace('{page}', '1'), PDF_MARGIN, PDF_HEIGHT - 42);
  return { canvas, ctx, pageNumber: 1, y: 132 };
}

function addPage(context: PageContext, title: string, labels: ExportLabels): PageContext {
  const next = newPage(title, labels);
  next.pageNumber = context.pageNumber + 1;
  next.ctx.font = `15px ${PDF_FONT}`;
  next.ctx.fillStyle = '#8a95a6';
  next.ctx.fillText(labels.page.replace('{page}', String(next.pageNumber)), PDF_MARGIN, PDF_HEIGHT - 42);
  return next;
}

function ensureSpace(context: PageContext, needed: number, title: string, labels: ExportLabels): PageContext {
  if (context.y + needed <= PDF_HEIGHT - 94) return context;
  return addPage(context, title, labels);
}

function drawBlocks(context: PageContext, blocks: TextBlock[], note: Note, labels: ExportLabels): PageContext {
  let page = context;
  const contentWidth = PDF_WIDTH - PDF_MARGIN * 2;
  const bottom = PDF_HEIGHT - 110;

  for (const block of blocks) {
    const { ctx } = page;
    if (block.kind === 'heading') {
      const size = block.level === 1 ? 40 : block.level === 2 ? 31 : block.level === 3 ? 25 : 21;
      ctx.font = `650 ${size}px ${PDF_DISPLAY}`;
      const lines = wrapText(ctx, block.text, contentWidth);
      const height = lines.length * size * 1.3 + 22;
      page = ensureSpace(page, height + 18, note.title, labels);
      page.ctx.font = `650 ${size}px ${PDF_DISPLAY}`;
      page.ctx.fillStyle = '#172033';
      page.y = drawTextLines(page.ctx, lines, PDF_MARGIN, page.y + 12, size * 1.3, bottom);
      page.y += size * 0.45;
    } else if (block.kind === 'paragraph') {
      page.ctx.font = `21px ${PDF_FONT}`;
      const lines = wrapText(page.ctx, block.text, contentWidth);
      const lineHeight = 35;
      for (const line of lines) {
        page = ensureSpace(page, lineHeight, note.title, labels);
        page.ctx.font = `21px ${PDF_FONT}`;
        page.ctx.fillStyle = '#293445';
        page.y = drawTextLines(page.ctx, [line], PDF_MARGIN, page.y + 26, lineHeight, bottom);
      }
      page.y += 14;
    } else if (block.kind === 'bullets' && block.items) {
      const checklist = block.items.every((item) => /^\[[ xX]\]\s+/.test(item));
      for (let index = 0; index < block.items.length; index += 1) {
        page.ctx.font = `20px ${PDF_FONT}`;
        const item = block.items[index].replace(/^\[([ xX])\]\s+/, (_match, mark: string) => (mark.toLowerCase() === 'x' ? '☑ ' : '☐ '));
        const prefix = block.ordered ? `${index + 1}.` : checklist ? '' : '•';
        const textIndent = prefix ? 42 : 26;
        const lines = wrapText(page.ctx, item, contentWidth - textIndent);
        page = ensureSpace(page, 34 * Math.min(lines.length, 3), note.title, labels);
        page.ctx.font = `20px ${PDF_FONT}`;
        page.ctx.fillStyle = '#2c6fd6';
        if (prefix) page.ctx.fillText(prefix, PDF_MARGIN, page.y + 28);
        page.ctx.fillStyle = '#293445';
        let lineY = page.y + 28;
        for (const line of lines) {
          if (lineY > bottom) {
            page = addPage(page, note.title, labels);
            page.ctx.font = `20px ${PDF_FONT}`;
            page.ctx.fillStyle = '#293445';
            lineY = page.y + 28;
          }
          page.ctx.fillText(line, PDF_MARGIN + textIndent, lineY);
          lineY += 32;
        }
        page.y = lineY - 8;
      }
      page.y += 10;
    } else if (block.kind === 'quote') {
      page.ctx.font = `italic 20px ${PDF_FONT}`;
      const lines = wrapText(page.ctx, block.text, contentWidth - 36);
      page = ensureSpace(page, 34 * lines.length + 18, note.title, labels);
      const height = lines.length * 33 + 26;
      page.ctx.fillStyle = 'rgba(31,111,235,0.08)';
      page.ctx.fillRect(PDF_MARGIN, page.y + 6, 6, height);
      page.ctx.font = `italic 20px ${PDF_FONT}`;
      page.ctx.fillStyle = '#536177';
      page.ctx.fillText(lines[0] ?? '', PDF_MARGIN + 26, page.y + 34);
      for (let i = 1; i < lines.length; i += 1) page.ctx.fillText(lines[i], PDF_MARGIN + 26, page.y + 34 + i * 33);
      page.y += height + 20;
    } else if (block.kind === 'code') {
      page.ctx.font = `17px "Cascadia Code", "SFMono-Regular", Consolas, monospace`;
      const lines = block.text.split('\n').flatMap((line) => wrapText(page.ctx, line, contentWidth - 48));
      page = ensureSpace(page, 30 * lines.length + 36, note.title, labels);
      const height = lines.length * 28 + 34;
      page.ctx.fillStyle = '#f1f3f7';
      page.ctx.fillRect(PDF_MARGIN, page.y + 4, contentWidth, height);
      page.ctx.fillStyle = '#334155';
      for (let i = 0; i < lines.length; i += 1) page.ctx.fillText(lines[i], PDF_MARGIN + 24, page.y + 38 + i * 28);
      page.y += height + 24;
    } else if (block.kind === 'rule') {
      page.ctx.strokeStyle = 'rgba(31,42,58,0.16)';
      page.ctx.beginPath();
      page.ctx.moveTo(PDF_MARGIN, page.y + 14.5);
      page.ctx.lineTo(PDF_WIDTH - PDF_MARGIN, page.y + 14.5);
      page.ctx.stroke();
      page.y += 32;
    } else if (block.kind === 'image') {
      page.ctx.font = `italic 18px ${PDF_FONT}`;
      page.ctx.fillStyle = '#768397';
      page.y = drawTextLines(page.ctx, [`[ ${block.text} ]`], PDF_MARGIN, page.y + 28, 30, bottom) + 10;
    }
  }
  return page;
}

export interface PdfExportResult {
  pages: number;
  filename: string;
}

/* ----------------------------------------------------------- PNG/SVG/editable */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shapePathData(stroke: Stroke): string {
  if (!stroke.points.length || !stroke.shape) return '';
  const points = stroke.points;
  const coordinate = (point: Stroke['points'][number]): string => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  if (stroke.shape === 'cross' && points.length >= 4) {
    return `M${coordinate(points[0])} L${coordinate(points[1])} M${coordinate(points[2])} L${coordinate(points[3])}`;
  }
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${coordinate(point)}`).join(' ');
  return `${path}${isOpenShape(stroke.shape) ? '' : ' Z'}`;
}

export async function exportPngFile(note: Note): Promise<void> {
  const canvas = await contentCanvas(note, 2600);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode PNG.');
  downloadBlob(safeFilename(note.title, 'png'), blob);
}

function axesSvg(
  minX: number,
  minY: number,
  width: number,
  height: number,
  color: string,
  opacity: number,
  spacing: number,
): string {
  const step = Math.max(20, spacing);
  const parts: string[] = [`<g opacity="${opacity.toFixed(2)}" fill="none" stroke="${escapeXml(color)}" stroke-width="1.2">`];
  const showX = minY <= 0 && 0 <= minY + height;
  const showY = minX <= 0 && 0 <= minX + width;
  if (showX) parts.push(`<line x1="${minX}" y1="0" x2="${minX + width}" y2="0"/>`);
  if (showY) parts.push(`<line x1="0" y1="${minY}" x2="0" y2="${minY + height}"/>`);

  const labelParts: string[] = [];
  if (showX) {
    const first = Math.ceil(minX / step) * step;
    for (let value = first; value <= minX + width; value += step) {
      if (Math.abs(value) < 0.001) continue;
      parts.push(`<line x1="${value}" y1="-4" x2="${value}" y2="4"/>`);
      labelParts.push(`<text x="${value}" y="15" text-anchor="middle">${value}</text>`);
    }
  }
  if (showY) {
    const first = Math.ceil(minY / step) * step;
    for (let value = first; value <= minY + height; value += step) {
      if (Math.abs(value) < 0.001) continue;
      parts.push(`<line x1="-4" y1="${value}" x2="4" y2="${value}"/>`);
      labelParts.push(`<text x="-8" y="${value + 3}" text-anchor="end">${value}</text>`);
    }
  }
  parts.push('</g>');
  if (labelParts.length) {
    parts.push(`<g fill="${escapeXml(color)}" font-family="Segoe UI, sans-serif" font-size="11" opacity="${opacity.toFixed(2)}">${labelParts.join('')}</g>`);
  }
  if (showX) {
    const tip = minX + width;
    parts.push(`<path d="M${tip - 8} -4 L${tip} 0 L${tip - 8} 4 Z" fill="${escapeXml(color)}" stroke="none"/>`);
    parts.push(`<text x="${tip - 5}" y="-8" text-anchor="end" fill="${escapeXml(color)}" stroke="none" font-family="Segoe UI, sans-serif" font-size="11">x</text>`);
  }
  if (showY) {
    parts.push(`<path d="M-4 ${minY + 8} L0 ${minY} L4 ${minY + 8} Z" fill="${escapeXml(color)}" stroke="none"/>`);
    parts.push(`<text x="7" y="${minY + 12}" fill="${escapeXml(color)}" stroke="none" font-family="Segoe UI, sans-serif" font-size="11">y</text>`);
  }
  if (showX && showY) {
    parts.push(`<g fill="${escapeXml(color)}" opacity="${opacity.toFixed(2)}"><circle cx="0" cy="0" r="2.2"/><text x="7" y="16" font-family="Segoe UI, sans-serif" font-size="11">O</text></g>`);
  }
  return parts.join('');
}

/** Vector export for the canvas content. Pixel erasers become an SVG mask. */
export function exportSvgFile(note: Note): void {
  const bounds = contentBounds(note) ?? { minX: -600, minY: -400, maxX: 600, maxY: 400 };
  const padding = 64;
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  const displayWidth = Math.min(1800, Math.max(480, Math.round(width)));
  const displayHeight = Math.max(1, Math.round((displayWidth / width) * height));
  const bg = note.background;
  const bgColor = bg.color || '#53657d';
  const bgOpacity = Math.max(0, Math.min(0.6, bg.opacity));
  const dash = bg.lineStyle === 'dashed' ? ' stroke-dasharray="4 6"' : '';
  const spacing = Math.max(8, bg.spacing);
  const pattern =
    bg.pattern === 'blank' || bg.pattern === 'axes'
      ? ''
      : `<pattern id="paperPattern" patternUnits="userSpaceOnUse" width="${spacing}" height="${spacing}">` +
        (bg.pattern === 'grid'
          ? `<path d="M ${spacing} 0 L 0 0 0 ${spacing}" fill="none" stroke="${bgColor}" stroke-width="1"${dash}/>`
          : bg.pattern === 'ruled'
            ? `<path d="M 0 ${spacing} L ${spacing} ${spacing}" fill="none" stroke="${bgColor}" stroke-width="1"${dash}/>`
            : `<circle cx="${spacing / 2}" cy="${spacing / 2}" r="1.3" fill="${bgColor}"/>`) +
        `</pattern>`;
  const axes = bg.pattern === 'axes'
    ? axesSvg(minX, minY, width, height, bgColor, Math.max(0.28, bgOpacity + 0.26), spacing)
    : '';
  const background = `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#fbfcff"/>` +
    (pattern ? `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#paperPattern)" opacity="${bgOpacity}"/>` : '') +
    axes;

  const pixelErasers = note.strokes.filter((stroke) => stroke.tool === 'eraser');
  const visibleStrokes = note.strokes.filter((stroke) => stroke.tool !== 'eraser');
  const ink = visibleStrokes.map((stroke) => {
    const path = stroke.shape ? shapePathData(stroke) : strokeToPath(stroke);
    if (!path) return '';
    const opacity = stroke.tool === 'highlighter' ? Math.min(0.55, stroke.opacity) : stroke.opacity;
    return `<path d="${path}" fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.size.toFixed(2)}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const eraseMaskPaths = pixelErasers.map((stroke) => {
    const path = shapePathData(stroke) || strokeToPath(stroke);
    return path
      ? `<path d="${path}" fill="none" stroke="#000" stroke-width="${stroke.size.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`
      : '';
  }).join('');
  const mask = pixelErasers.length
    ? `<mask id="inkMask" maskUnits="userSpaceOnUse" x="${minX}" y="${minY}" width="${width}" height="${height}"><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#fff"/>${eraseMaskPaths}</mask>`
    : '';
  const inkGroup = ink
    ? `<g ${pixelErasers.length ? 'mask="url(#inkMask)"' : ''}>${ink}</g>`
    : '';
  const images = (note.images ?? []).map((image) => {
    const cx = image.x + image.width / 2;
    const cy = image.y + image.height / 2;
    const rotate = image.rotation ? ` transform="rotate(${((image.rotation * 180) / Math.PI).toFixed(3)} ${cx} ${cy})"` : '';
    return `<image href="${escapeXml(image.src)}" x="${image.x}" y="${image.y}" width="${image.width}" height="${image.height}" preserveAspectRatio="none"${rotate}/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="${escapeXml(note.title)}">
<title>${escapeXml(note.title)}</title>
<defs>${pattern}${mask}</defs>
${background}
${images}
${inkGroup}
</svg>
`;
  downloadBlob(safeFilename(note.title, 'svg'), new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
}

export function exportEditableFile(note: Note): void {
  downloadBlob(
    safeFilename(note.title, 'paligraph'),
    new Blob([serializeEditableNote(note)], { type: 'application/x-paligraph+json;charset=utf-8' }),
  );
}

export async function exportPdf(note: Note, labels: ExportLabels): Promise<PdfExportResult> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pages: HTMLCanvasElement[] = [];
  const source = note.markdown.trim();

  if (source) {
    let page = newPage(note.title, labels);
    const blocks = parsePrintBlocks(source);
    page = drawBlocks(page, blocks, note, labels);
    pages.push(page.canvas);
    const drawing = contentBounds(note) ? await contentCanvas(note, 1700) : null;
    if (drawing) {
      let inkPage = addPage(page, `${note.title} — ${labels.inkHeading}`, labels);
      const availableWidth = PDF_WIDTH - PDF_MARGIN * 2;
      const availableHeight = PDF_HEIGHT - 240;
      const ratio = Math.min(availableWidth / drawing.width, availableHeight / drawing.height);
      const drawWidth = drawing.width * ratio;
      const drawHeight = drawing.height * ratio;
      const x = (PDF_WIDTH - drawWidth) / 2;
      const y = 150 + (availableHeight - drawHeight) / 2;
      inkPage.ctx.drawImage(drawing, x, y, drawWidth, drawHeight);
      inkPage.ctx.font = `650 30px ${PDF_DISPLAY}`;
      inkPage.ctx.fillStyle = '#172033';
      inkPage.ctx.fillText(labels.inkHeading, PDF_MARGIN, 126);
      pages.push(inkPage.canvas);
    }
  } else {
    const page = newPage(note.title, labels);
    const drawing = contentBounds(note) ? await contentCanvas(note, 1800) : null;
    if (drawing) {
      const availableWidth = PDF_WIDTH - PDF_MARGIN * 2;
      const availableHeight = PDF_HEIGHT - 240;
      const ratio = Math.min(availableWidth / drawing.width, availableHeight / drawing.height);
      const drawWidth = drawing.width * ratio;
      const drawHeight = drawing.height * ratio;
      page.ctx.drawImage(drawing, (PDF_WIDTH - drawWidth) / 2, 150 + (availableHeight - drawHeight) / 2, drawWidth, drawHeight);
    } else {
      page.ctx.font = `italic 22px ${PDF_FONT}`;
      page.ctx.fillStyle = '#7a8598';
      page.ctx.fillText(labels.emptyNote, PDF_MARGIN, 200);
    }
    pages.push(page.canvas);
  }

  for (let i = 0; i < pages.length; i += 1) {
    if (i > 0) doc.addPage();
    const image = canvasDataUrl(pages[i], 'image/jpeg');
    doc.addImage(image, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
  }
  doc.setProperties({
    title: note.title,
    // jsPDF's built-in metadata is WinAnsi; keep the subject ASCII to avoid
    // mojibake in the PDF properties pane. The visible footer is localized.
    subject: 'Created with Paligraph Canvas',
    creator: 'Paligraph Canvas',
    author: 'Paligraph Canvas',
  });
  const filename = safeFilename(note.title, 'pdf');
  doc.save(filename);
  return { pages: pages.length, filename };
}
