import type { ImportedLanguagePack, LanguagePack } from './types';

/**
 * Imported locale packs are validated then stored in localStorage. Only plain
 * strings are kept; no scripts, HTML or functions can enter the dictionary.
 * Built-in locale files are fetched lazily from /locales.
 */
export const IMPORTED_LANGUAGE_PACKS_KEY = 'paligraph-language-packs';
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

export const BUILTIN_LANGUAGES: LanguagePack[] = [
  { code: 'zh-CN', label: '简体中文', nativeLabel: '简体中文', file: 'zh-CN.json', source: 'builtin' },
  { code: 'zh-TW', label: '繁體中文', nativeLabel: '繁體中文', file: 'zh-TW.json', source: 'builtin' },
  { code: 'en', label: 'English', nativeLabel: 'English', file: 'en.json', source: 'builtin' },
  { code: 'ja', label: '日本語', nativeLabel: '日本語', file: 'ja.json', source: 'builtin' },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function validTranslations(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const translations: Record<string, string> = {};
  for (const [key, text] of Object.entries(source)) {
    if (typeof text === 'string' && key.trim()) translations[key] = text;
  }
  return translations;
}

/** Accepts both `{code,label,translations}` and a bare key/value dictionary. */
export function parseLanguagePackJson(source: string, fallbackCode = ''): ImportedLanguagePack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = asRecord(parsed);
  const candidate = root.pack && typeof root.pack === 'object' ? root.pack : parsed;
  const pack = asRecord(candidate);
  const code = (typeof pack.code === 'string' ? pack.code.trim() : fallbackCode.trim().replace(/\.json$/i, ''));
  const translations = validTranslations(pack.translations);
  if (!Object.keys(translations).length) {
    const flat = validTranslations(root);
    delete flat.code;
    delete flat.label;
    delete flat.nativeLabel;
    delete flat.version;
    Object.assign(translations, flat);
  }
  const label = (typeof pack.label === 'string' ? pack.label.trim() : '') || code.toUpperCase();
  const nativeLabel = typeof pack.nativeLabel === 'string' ? pack.nativeLabel.trim() : undefined;
  if (!LANGUAGE_CODE_PATTERN.test(code)) {
    throw new Error('`code` must look like "ja", "ko" or "pt-BR".');
  }
  if (!label) throw new Error('A language label or filename-based code is required.');
  if (!Object.keys(translations).length) throw new Error('`translations` must contain at least one string entry.');
  return { code, label, nativeLabel, translations, importedAt: Date.now() };
}

export function toLanguagePack(pack: ImportedLanguagePack): LanguagePack {
  return {
    code: pack.code,
    label: pack.label,
    nativeLabel: pack.nativeLabel,
    file: `imported:${pack.code}.json`,
    translations: pack.translations,
    source: 'imported',
  };
}

export function loadImportedLanguagePacks(): ImportedLanguagePack[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(IMPORTED_LANGUAGE_PACKS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ImportedLanguagePack | null => {
        const pack = asRecord(item);
        const code = typeof pack.code === 'string' ? pack.code : '';
        const label = typeof pack.label === 'string' ? pack.label : '';
        const translations = validTranslations(pack.translations);
        if (!LANGUAGE_CODE_PATTERN.test(code) || !label || !Object.keys(translations).length) return null;
        return {
          code,
          label,
          nativeLabel: typeof pack.nativeLabel === 'string' ? pack.nativeLabel : undefined,
          translations,
          importedAt: typeof pack.importedAt === 'number' ? pack.importedAt : Date.now(),
        } satisfies ImportedLanguagePack;
      })
      .filter((pack): pack is ImportedLanguagePack => pack !== null);
  } catch {
    return [];
  }
}

export function saveImportedLanguagePacks(packs: ImportedLanguagePack[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(IMPORTED_LANGUAGE_PACKS_KEY, JSON.stringify(packs));
  } catch {
    // Storage can be unavailable in private mode; the in-memory pack still works.
  }
}

export function mergeLanguagePacks(base: LanguagePack[], imported: ImportedLanguagePack[]): LanguagePack[] {
  const byCode = new Map(base.map((language) => [language.code, language]));
  for (const pack of imported) byCode.set(pack.code, toLanguagePack(pack));
  return [...byCode.values()];
}

/** Match browser languages to the closest available pack, with a stable fallback. */
export function resolveSystemLanguage(languages: readonly string[], available: LanguagePack[]): string {
  if (!available.length) return 'en';
  const codes = available.map((item) => item.code);
  for (const language of languages) {
    const lower = language.toLowerCase();
    const exact = codes.find((code) => code.toLowerCase() === lower);
    if (exact) return exact;
    if (lower.startsWith('zh')) {
      const traditional = /hant|tw|hk|mo/.test(lower);
      const desired = traditional ? 'zh-TW' : 'zh-CN';
      if (codes.includes(desired)) return desired;
      const zh = codes.find((code) => code.toLowerCase().startsWith('zh'));
      if (zh) return zh;
    }
    if (lower.startsWith('en') && codes.includes('en')) return 'en';
    if (lower.startsWith('ja') && codes.includes('ja')) return 'ja';
    const base = codes.find((code) => code.toLowerCase().split('-')[0] === lower.split('-')[0]);
    if (base) return base;
  }
  return codes.includes('en') ? 'en' : codes[0];
}
