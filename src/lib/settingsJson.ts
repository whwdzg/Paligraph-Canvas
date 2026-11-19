import defaultsFile from '../config/default-settings.json';
import { clamp } from './geometry';
import type {
  BackgroundSettings,
  EraserMode,
  HighlighterMode,
  PenVariant,
  Settings,
  SettingsJsonDocument,
  ThemeChoice,
} from './types';

/**
 * Settings are persisted by the Zustand store but the public interchange
 * format is the versioned JSON document in `src/config/default-settings.json`.
 * Importing is intentionally forgiving (unknown keys ignored, numbers clamped)
 * so files from older or future builds can still be opened safely.
 */
export const SETTINGS_JSON_VERSION = 1;
const STORAGE_KEY = 'paligraph-settings';

const THEMES = new Set<ThemeChoice>(['system', 'light', 'dark']);
const PEN_VARIANTS = new Set<PenVariant>(['pen', 'pencil', 'crayon', 'brush']);
const HIGHLIGHTER_MODES = new Set<HighlighterMode>(['free', 'straight']);
const ERASER_MODES = new Set<EraserMode>(['stroke', 'pixel']);
const PATTERNS = new Set<BackgroundSettings['pattern']>(['blank', 'grid', 'dots', 'ruled']);
const LINE_STYLES = new Set<BackgroundSettings['lineStyle']>(['solid', 'dashed']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const FALLBACK_BACKGROUND: BackgroundSettings = {
  pattern: 'grid',
  lineStyle: 'solid',
  spacing: 32,
  opacity: 0.14,
  color: '',
};

export const FALLBACK_SETTINGS: Settings = {
  theme: 'system',
  language: 'system',
  liquidGlass: true,
  reduceMotion: false,
  palmRejection: true,
  shapeRecognition: true,
  mathRecognition: true,
  pressureSensitivity: 0.72,
  penVariant: 'pen',
  penColor: '#1f6feb',
  penSize: 4,
  highlighterColor: '#ffd60a',
  highlighterSize: 22,
  highlighterMode: 'free',
  eraserMode: 'stroke',
  eraserSize: 24,
  defaultBackground: FALLBACK_BACKGROUND,
  showCanvasHints: true,
};

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : {};
}

function oneOf<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function normalizeBackground(value: unknown, fallback: BackgroundSettings): BackgroundSettings {
  const raw = record(value);
  return {
    pattern: oneOf(raw.pattern, PATTERNS, fallback.pattern),
    lineStyle: oneOf(raw.lineStyle, LINE_STYLES, fallback.lineStyle),
    spacing: Math.round(number(raw.spacing, fallback.spacing, 8, 96)),
    opacity: Math.round(number(raw.opacity, fallback.opacity, 0, 0.6) * 100) / 100,
    color: raw.color === '' || raw.color === undefined ? '' : color(raw.color, fallback.color),
  };
}

/** Coerces unknown JSON/localStorage into a complete, bounded settings object. */
export function normalizeSettings(input: unknown, base: Settings = FALLBACK_SETTINGS): Settings {
  const raw = record(input);
  return {
    theme: oneOf(raw.theme, THEMES, base.theme),
    language: typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : base.language,
    liquidGlass: bool(raw.liquidGlass, base.liquidGlass),
    reduceMotion: bool(raw.reduceMotion, base.reduceMotion),
    palmRejection: bool(raw.palmRejection, base.palmRejection),
    shapeRecognition: bool(raw.shapeRecognition, base.shapeRecognition),
    mathRecognition: bool(raw.mathRecognition, base.mathRecognition),
    pressureSensitivity: number(raw.pressureSensitivity, base.pressureSensitivity, 0, 1),
    penVariant: oneOf(raw.penVariant, PEN_VARIANTS, base.penVariant),
    penColor: color(raw.penColor, base.penColor),
    penSize: number(raw.penSize, base.penSize, 0.75, 36),
    highlighterColor: color(raw.highlighterColor, base.highlighterColor),
    highlighterSize: number(raw.highlighterSize, base.highlighterSize, 6, 64),
    highlighterMode: oneOf(raw.highlighterMode, HIGHLIGHTER_MODES, base.highlighterMode),
    eraserMode: oneOf(raw.eraserMode, ERASER_MODES, base.eraserMode),
    eraserSize: number(raw.eraserSize, base.eraserSize, 6, 96),
    defaultBackground: normalizeBackground(raw.defaultBackground, base.defaultBackground),
    showCanvasHints: bool(raw.showCanvasHints, base.showCanvasHints),
  };
}

/** Built-in defaults, validated through the same path as imported files. */
export const DEFAULT_SETTINGS: Settings = normalizeSettings(record(defaultsFile).settings);

export function settingsDocument(settings: Settings): SettingsJsonDocument {
  return {
    version: SETTINGS_JSON_VERSION,
    settings: {
      theme: settings.theme,
      language: settings.language,
      liquidGlass: settings.liquidGlass,
      reduceMotion: settings.reduceMotion,
      palmRejection: settings.palmRejection,
      shapeRecognition: settings.shapeRecognition,
      mathRecognition: settings.mathRecognition,
      pressureSensitivity: settings.pressureSensitivity,
      penVariant: settings.penVariant,
      penColor: settings.penColor,
      penSize: settings.penSize,
      highlighterColor: settings.highlighterColor,
      highlighterSize: settings.highlighterSize,
      highlighterMode: settings.highlighterMode,
      eraserMode: settings.eraserMode,
      eraserSize: settings.eraserSize,
      defaultBackground: { ...settings.defaultBackground },
      showCanvasHints: settings.showCanvasHints,
    },
  };
}

export function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settingsDocument(settings), null, 2)}\n`;
}

export function defaultSettingsDocument(): SettingsJsonDocument {
  return settingsDocument(DEFAULT_SETTINGS);
}

export function parseSettingsJson(source: string): { settings: Settings; version: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = record(parsed);
  const version = typeof root.version === 'number' ? root.version : SETTINGS_JSON_VERSION;
  if (version > SETTINGS_JSON_VERSION) {
    throw new Error(`Unsupported settings version ${version}; this build understands version ${SETTINGS_JSON_VERSION}.`);
  }
  const candidate = root.settings && typeof root.settings === 'object' ? root.settings : parsed;
  const candidateRecord = record(candidate);
  if (!Object.keys(candidateRecord).length) throw new Error('The settings file does not contain any settings.');
  return { version, settings: normalizeSettings(candidateRecord) };
}

export { STORAGE_KEY as SETTINGS_STORAGE_KEY };
