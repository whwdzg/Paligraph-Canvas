type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Friendly timestamps. Intl handles the date fallback so the sidebar respects
 * the active locale without shipping month names for every language.
 */
export function formatNoteTime(timestamp: number, language: string, t: Translate, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return t('time.justNow');
  if (delta < hour) return t('time.minutesAgo', { count: Math.floor(delta / minute) });
  if (delta < day) return t('time.hoursAgo', { count: Math.floor(delta / hour) });
  if (delta < day * 7) return t('time.daysAgo', { count: Math.floor(delta / day) });
  try {
    return new Intl.DateTimeFormat(language, {
      month: 'short',
      day: 'numeric',
      year: new Date(timestamp).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleDateString();
  }
}

export function formatFullDate(timestamp: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Compact byte count for storage readouts. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  const digits = index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
