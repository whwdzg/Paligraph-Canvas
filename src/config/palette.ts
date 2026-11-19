/** Fluent-aligned ink palette. All colours are normalised hex for canvas and JSON export. */
export const PEN_COLORS = [
  '#1f6feb',
  '#111827',
  '#d75a4a',
  '#e08a00',
  '#168a63',
  '#7357d8',
  '#d6428e',
  '#0d94a8',
] as const;

export const HIGHLIGHTER_COLORS = [
  '#ffd60a',
  '#ffb020',
  '#7be3a1',
  '#6bdcff',
  '#d0a2ff',
  '#ff8fa3',
] as const;

export const PAPER_TINTS = [
  { value: '', label: 'auto' },
  { value: '#64748b', label: 'slate' },
  { value: '#2b7fff', label: 'blue' },
  { value: '#b7791f', label: 'amber' },
] as const;

export const APP_VERSION = __APP_VERSION__;
