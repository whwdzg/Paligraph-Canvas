import type { NoteTextStyle } from './types';
import type { PreparedImage } from './media';

export interface TextFontOption {
  id: string;
  labelKey: string;
  stack: string;
}

/** Font stacks shared by the editor, the canvas renderer and re-editing. */
export const TEXT_FONTS: TextFontOption[] = [
  {
    id: 'sans',
    labelKey: 'text.fonts.sans',
    stack: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif',
  },
  {
    id: 'serif',
    labelKey: 'text.fonts.serif',
    stack: 'Georgia, "Songti SC", SimSun, "Times New Roman", serif',
  },
  {
    id: 'mono',
    labelKey: 'text.fonts.mono',
    stack: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace',
  },
  {
    id: 'hand',
    labelKey: 'text.fonts.hand',
    stack: '"Segoe Print", "Ink Free", "Bradley Hand", KaiTi, cursive',
  },
  {
    id: 'rounded',
    labelKey: 'text.fonts.rounded',
    stack: '"Segoe UI Variable Display", "Microsoft YaHei UI", "Arial Rounded MT Bold", sans-serif',
  },
];

export function isTextFontId(value: string): boolean {
  return TEXT_FONTS.some((font) => font.id === value);
}

export function textFontStack(id: string): string {
  return TEXT_FONTS.find((font) => font.id === id)?.stack ?? TEXT_FONTS[0].stack;
}

export const DEFAULT_TEXT_STYLE: NoteTextStyle = {
  text: '',
  fontId: 'sans',
  fontSize: 28,
  color: '#1f2937',
  bold: false,
  italic: false,
};

function fitTextStyle(style: NoteTextStyle): NoteTextStyle {
  const text = style.text.replace(/\r\n?/g, '\n').slice(0, 2000);
  return {
    text,
    fontId: isTextFontId(style.fontId) ? style.fontId : 'sans',
    fontSize: Math.round(Math.max(10, Math.min(120, Number.isFinite(style.fontSize) ? style.fontSize : 28))),
    color: /^#[0-9a-f]{6}$/i.test(style.color) ? style.color.toLowerCase() : '#1f2937',
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
  };
}

function wrapParagraph(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let line = '';
  for (const char of Array.from(text)) {
    const candidate = line + char;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line.replace(/\s+$/, ''));
      line = char.trimStart();
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Renders a text block to a transparent PNG plus its world-space dimensions.
 * The bitmap is rendered at up to 3× so it stays crisp on high-DPI displays,
 * while the original style/text stays in the note for re-editing.
 */
export function renderTextImage(input: NoteTextStyle): PreparedImage {
  const style = fitTextStyle(input);
  if (!style.text.trim()) throw new Error('Text is empty.');
  const maxTextWidth = 560;
  const padding = 12;
  const lineHeight = style.fontSize * 1.32;
  const family = textFontStack(style.fontId);
  const fontWeight = style.bold ? '700' : '400';
  const fontStyle = style.italic ? 'italic' : 'normal';
  const font = `${fontStyle} ${fontWeight} ${style.fontSize}px ${family}`;

  const measure = document.createElement('canvas');
  const measureCtx = measure.getContext('2d');
  if (!measureCtx) throw new Error('Canvas 2D is not available.');
  measureCtx.font = font;
  const lines = style.text.split('\n').flatMap((paragraph) => wrapParagraph(measureCtx, paragraph, maxTextWidth));
  let textWidth = 1;
  for (const line of lines) textWidth = Math.max(textWidth, measureCtx.measureText(line).width);
  const worldWidth = Math.ceil(Math.min(maxTextWidth, textWidth) + padding * 2);
  const worldHeight = Math.ceil(lines.length * lineHeight + padding * 2);
  const pixelScale = Math.min(3, 4096 / worldWidth, 4096 / worldHeight);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(worldWidth * pixelScale));
  canvas.height = Math.max(1, Math.round(worldHeight * pixelScale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available.');
  ctx.scale(pixelScale, pixelScale);
  ctx.font = font;
  ctx.fillStyle = style.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line, padding, padding + index * lineHeight);
  });

  return {
    src: canvas.toDataURL('image/png'),
    name: style.text.replace(/\s+/g, ' ').trim().slice(0, 56) || 'Text',
    mime: 'image/png',
    width: worldWidth,
    height: worldHeight,
    text: style,
  };
}
