import { useEffect, useState } from 'react';
import { useSettingsStore } from '../state/settings';

/**
 * System colour-scheme subscription. Kept outside React context because the
 * canvas renderer only needs a resolved light/dark string and should not
 * re-render for unrelated settings changes.
 */
export function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setPrefersDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return prefersDark;
}

export function useResolvedTheme(): 'light' | 'dark' {
  const choice = useSettingsStore((state) => state.theme);
  const prefersDark = useSystemPrefersDark();
  if (choice === 'light' || choice === 'dark') return choice;
  return prefersDark ? 'dark' : 'light';
}

/** Applies the theme/glass/motion attributes before content paints. */
export function useThemeSync(): 'light' | 'dark' {
  const resolved = useResolvedTheme();
  const liquidGlass = useSettingsStore((state) => state.liquidGlass);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.glass = liquidGlass ? 'on' : 'off';
    root.dataset.motion = reduceMotion ? 'reduced' : 'full';
    root.style.colorScheme = resolved;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#0c1119' : '#eef2f8';
  }, [resolved, liquidGlass, reduceMotion]);

  return resolved;
}
