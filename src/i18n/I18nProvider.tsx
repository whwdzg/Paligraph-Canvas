import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  BUILTIN_LANGUAGES,
  loadImportedLanguagePacks,
  mergeLanguagePacks,
  resolveSystemLanguage,
  saveImportedLanguagePacks,
} from '../lib/languagePacks';
import type { ImportedLanguagePack, LanguagePack } from '../lib/types';
import { useSettingsStore } from '../state/settings';

/**
 * Runtime i18n. Locale files are static JSON under /locales so adding a
 * translation never requires a code change; imported packs are validated and
 * kept in localStorage. The fallback layer is English, matching the other
 * Paligraph data formats.
 */

interface I18nValue {
  t: (key: string, values?: Record<string, string | number>) => string;
  language: string;
  preference: string;
  languages: LanguagePack[];
  setLanguage: (code: string) => void;
  importLanguagePack: (pack: ImportedLanguagePack) => void;
  refresh: () => void;
  loading: boolean;
  error: string | null;
}

const I18nContext = createContext<I18nValue | null>(null);
const dictionaries = new Map<string, Record<string, string>>();
const requests = new Map<string, Promise<Record<string, string>>>();

function localeFileUrl(file: string): string {
  return `${new URL(`locales/${file}`, document.baseURI).href}${document.location.search.includes('__update') ? `?__update=${Date.now()}` : ''}`;
}

async function fetchLocale(file: string): Promise<Record<string, string>> {
  let request = requests.get(file);
  if (!request) {
    request = fetch(localeFileUrl(file), { credentials: 'same-origin' }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Record<string, string>;
    });
    requests.set(file, request);
    request.finally(() => requests.delete(file)).catch(() => {});
  }
  return request;
}

function currentSystemLanguages(): string[] {
  if (typeof navigator === 'undefined') return ['en'];
  return navigator.languages?.length ? [...navigator.languages] : [navigator.language || 'en'];
}

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const preference = useSettingsStore((state) => state.language);
  const patch = useSettingsStore((state) => state.patch);
  const [importedPacks, setImportedPacks] = useState<ImportedLanguagePack[]>(loadImportedLanguagePacks);
  const [systemLanguages, setSystemLanguages] = useState<string[]>(currentSystemLanguages);
  const [remotes, setRemotes] = useState<LanguagePack[]>(BUILTIN_LANGUAGES);
  const languages = useMemo(() => mergeLanguagePacks(remotes, importedPacks), [remotes, importedPacks]);
  const [dictionary, setDictionary] = useState<Record<string, string> | null>(null);
  const [fallback, setFallback] = useState<Record<string, string> | null>(() => dictionaries.get('en') ?? null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const language = useMemo(() => {
    if (preference !== 'system' && languages.some((item) => item.code === preference)) return preference;
    return resolveSystemLanguage(systemLanguages, languages);
  }, [preference, languages, systemLanguages]);

  const activePack = useMemo(
    () => languages.find((item) => item.code === language) ?? languages[0],
    [language, languages],
  );

  useEffect(() => {
    let cancelled = false;
    fetchLocale('manifest.json')
      .then((manifest) => {
        const list = (manifest as unknown as { languages?: LanguagePack[] }).languages;
        if (!cancelled && Array.isArray(list) && list.length) setRemotes(list);
      })
      .catch(() => {
        // The bundled four languages keep the app usable without a manifest.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const update = (): void => setSystemLanguages(currentSystemLanguages());
    window.addEventListener('languagechange', update);
    return () => window.removeEventListener('languagechange', update);
  }, []);

  // English is only requested after the active language is on screen. This
  // keeps the first paint to one small JSON file.
  useEffect(() => {
    if (fallback || !dictionary || language === 'en') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchLocale('en.json')
        .then((payload) => {
          if (cancelled) return;
          dictionaries.set('en', payload);
          setFallback(payload);
        })
        .catch(() => {});
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dictionary, fallback, language]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const cached = dictionaries.get(language);
    if (cached) {
      setDictionary(cached);
      return () => {
        cancelled = true;
      };
    }
    const pack = activePack;
    if (pack?.translations) {
      dictionaries.set(language, pack.translations);
      setDictionary(pack.translations);
      return () => {
        cancelled = true;
      };
    }
    const file = pack?.file ?? 'en.json';
    const early =
      window.__PALIGRAPH_LOCALE && window.__PALIGRAPH_LOCALE_CODE === language
        ? window.__PALIGRAPH_LOCALE
        : null;
    const request = early ?? fetchLocale(file);
    request
      .then((payload) => {
        if (cancelled) return;
        dictionaries.set(language, payload);
        setDictionary(payload);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [activePack, language, reloadToken]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string => {
      let text = dictionary?.[key] ?? fallback?.[key] ?? key;
      if (values) {
        for (const [name, value] of Object.entries(values)) text = text.split(`{${name}}`).join(String(value));
      }
      return text;
    },
    [dictionary, fallback],
  );

  const setLanguage = useCallback(
    (code: string) => {
      patch({ language: code });
    },
    [patch],
  );

  const importLanguagePack = useCallback(
    (pack: ImportedLanguagePack): void => {
      setImportedPacks((current) => {
        const next = [...current.filter((item) => item.code !== pack.code), pack];
        saveImportedLanguagePacks(next);
        return next;
      });
      dictionaries.set(pack.code, pack.translations);
      setDictionary(pack.translations);
      patch({ language: pack.code });
    },
    [patch],
  );

  const value = useMemo<I18nValue>(
    () => ({
      t,
      language,
      preference,
      languages,
      setLanguage,
      importLanguagePack,
      refresh: () => setReloadToken((token) => token + 1),
      loading: !dictionary,
      error,
    }),
    [t, language, preference, languages, setLanguage, importLanguagePack, dictionary, error],
  );

  if (error && !dictionary) {
    return (
      <div className="boot-screen">
        <img className="boot-logo" src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width={64} height={64} />
        <h1>Paligraph Canvas</h1>
        <p className="boot-error">The language file could not be loaded. Please check the connection and try again.</p>
        <p className="boot-detail">{error}</p>
        <button type="button" className="fluent-button primary" onClick={() => setReloadToken((token) => token + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (!dictionary) {
    return (
      <div className="boot-screen" aria-live="polite">
        <img className="boot-logo" src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width={64} height={64} />
        <h1>Paligraph Canvas</h1>
        <div className="boot-progress" aria-hidden="true"><span /></div>
      </div>
    );
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
