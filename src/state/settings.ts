/**
 * Persisted user preferences. The public JSON interchange format lives in
 * `lib/settingsJson.ts`; this store only adds immediate patch/reset actions and
 * normalises values as they are hydrated from localStorage.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  SETTINGS_STORAGE_KEY,
} from '../lib/settingsJson';
import type { Settings } from '../lib/types';

interface SettingsState extends Settings {
  patch: (patch: Partial<Settings>) => void;
  replaceSettings: (settings: Settings) => void;
  resetSettings: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      patch: (patch) => set((state) => ({ ...normalizeSettings({ ...state, ...patch }, state) })),
      replaceSettings: (settings) => set(normalizeSettings(settings)),
      resetSettings: () => set(normalizeSettings(DEFAULT_SETTINGS)),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      // normalizeSettings returns only the documented, serialisable fields.
      partialize: (state) => normalizeSettings(state),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeSettings(persisted, current),
      }),
    },
  ),
);

export { DEFAULT_SETTINGS } from '../lib/settingsJson';
