import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  defaultSettingsDocument,
  normalizeSettings,
  parseSettingsJson,
  serializeSettings,
  settingsDocument,
} from './settingsJson';
import { parseLanguagePackJson, resolveSystemLanguage, BUILTIN_LANGUAGES } from './languagePacks';

describe('settings JSON', () => {
  it('loads documented defaults', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(DEFAULT_SETTINGS.penColor).toBe('#1f6feb');
    expect(DEFAULT_SETTINGS.defaultBackground.pattern).toBe('grid');
    expect(DEFAULT_SETTINGS.palmRejection).toBe(true);
    expect(DEFAULT_SETTINGS.shapeRecognition).toBe(true);
    expect(DEFAULT_SETTINGS.mathRecognition).toBe(true);
    expect(DEFAULT_SETTINGS.pressureStrength).toBe(1);
    expect(DEFAULT_SETTINGS.pressureAlgorithm).toBe(true);
  });

  it('exports a versioned object without store actions', () => {
    const document = settingsDocument(DEFAULT_SETTINGS);
    expect(document.version).toBe(1);
    expect('patch' in document.settings).toBe(false);
    expect(JSON.parse(serializeSettings(DEFAULT_SETTINGS)).settings.penVariant).toBe('pen');
  });

  it('imports wrappers and bare objects, clamping unsafe values', () => {
    const wrapped = parseSettingsJson(JSON.stringify({
      version: 1,
      settings: { theme: 'dark', penSize: 99, pressureSensitivity: -4, pressureStrength: 9, pressureAlgorithm: 'yes', penColor: 'red; url(x)' },
    }));
    expect(wrapped.settings.theme).toBe('dark');
    expect(wrapped.settings.penSize).toBe(36);
    expect(wrapped.settings.pressureSensitivity).toBe(0);
    expect(wrapped.settings.pressureStrength).toBe(2);
    expect(wrapped.settings.pressureAlgorithm).toBe(true);
    expect(wrapped.settings.penColor).toBe(DEFAULT_SETTINGS.penColor);

    const bare = parseSettingsJson(JSON.stringify({ theme: 'light', highlighterMode: 'straight', eraserMode: 'pixel' }));
    expect(bare.settings.theme).toBe('light');
    expect(bare.settings.highlighterMode).toBe('straight');
    expect(bare.settings.eraserMode).toBe('pixel');
  });

  it('rejects malformed, empty and future documents', () => {
    expect(() => parseSettingsJson('{')).toThrow(/Invalid JSON/);
    expect(() => parseSettingsJson('{}')).toThrow(/does not contain/);
    expect(() => parseSettingsJson(JSON.stringify({ version: 8, settings: { theme: 'dark' } }))).toThrow(/Unsupported/);
  });

  it('normalizes without leaking unknown keys', () => {
    const normalized = normalizeSettings({ theme: 'light', unknownSetting: true, defaultBackground: { pattern: 'dots' } });
    expect(normalized.theme).toBe('light');
    expect('unknownSetting' in normalized).toBe(false);
    expect(normalized.defaultBackground.pattern).toBe('dots');
    expect(normalized.defaultBackground.spacing).toBe(DEFAULT_SETTINGS.defaultBackground.spacing);
  });

  it('accepts default document as import', () => {
    expect(parseSettingsJson(JSON.stringify(defaultSettingsDocument())).settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });
});

describe('language packs', () => {
  it('parses the documented wrapper', () => {
    const pack = parseLanguagePackJson(JSON.stringify({
      version: 1,
      pack: {
        code: 'pt-BR',
        label: 'Português',
        nativeLabel: 'Português (Brasil)',
        translations: { 'app.tagline': 'Ideias, em tinta.' },
      },
    }));
    expect(pack.code).toBe('pt-BR');
    expect(pack.nativeLabel).toBe('Português (Brasil)');
    expect(pack.translations['app.tagline']).toBe('Ideias, em tinta.');
  });

  it('accepts a bare dictionary and supplies the code from the filename', () => {
    const pack = parseLanguagePackJson(JSON.stringify({ 'app.tagline': 'Wan idei.' }), 'tpi.json');
    expect(pack.code).toBe('tpi');
    expect(pack.translations['app.tagline']).toBe('Wan idei.');
  });

  it('rejects unsafe codes, empty dictionaries and malformed JSON', () => {
    expect(() => parseLanguagePackJson('{')).toThrow(/Invalid JSON/);
    expect(() => parseLanguagePackJson(JSON.stringify({ code: '../evil', translations: { a: 'x' } }))).toThrow(/code/);
    expect(() => parseLanguagePackJson(JSON.stringify({ code: 'xx', translations: {} }))).toThrow(/translations/);
  });

  it('resolves browser languages with traditional Chinese support', () => {
    expect(resolveSystemLanguage(['zh-HK'], BUILTIN_LANGUAGES)).toBe('zh-TW');
    expect(resolveSystemLanguage(['zh-SG'], BUILTIN_LANGUAGES)).toBe('zh-CN');
    expect(resolveSystemLanguage(['ja-JP'], BUILTIN_LANGUAGES)).toBe('ja');
    expect(resolveSystemLanguage(['en-GB'], BUILTIN_LANGUAGES)).toBe('en');
    expect(resolveSystemLanguage(['de-DE'], BUILTIN_LANGUAGES)).toBe('en');
  });
});
