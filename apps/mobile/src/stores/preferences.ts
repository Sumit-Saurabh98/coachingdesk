// The user's app preferences, remembered on THIS phone (TECH_STACK: Zustand for UI state).
// Not stored on the server: a teacher may want dark mode on her phone and light on another.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { zustandMMKVStorage } from '@/lib/storage';

// 'system' = follow the phone's own setting (the default).
export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'system' | 'en' | 'hi';

interface PreferencesState {
  theme: ThemePreference;
  language: LanguagePreference;
  /** The 10 digits that last logged in on this phone: prefilled on the login screen. */
  lastPhone: string | null;
  /** The institute the app works in on this phone (several possible: owner + teacher). */
  currentInstituteId: string | null;
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: LanguagePreference) => void;
  setLastPhone: (phone: string) => void;
  setCurrentInstitute: (instituteId: string) => void;
}

// A Zustand store is a hook. A component reads ONE piece of it, e.g.
//   const theme = usePreferences((state) => state.theme);
// and re-draws only when that piece changes.
export const usePreferences = create<PreferencesState>()(
  // persist(...) saves the store after every change and loads it when the app starts.
  persist(
    (set) => ({
      theme: 'system',
      language: 'system',
      lastPhone: null,
      currentInstituteId: null,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setLastPhone: (lastPhone) => set({ lastPhone }),
      setCurrentInstitute: (currentInstituteId) => set({ currentInstituteId }),
    }),
    {
      name: 'preferences', // the key in storage
      // If the SHAPE of this store changes one day, bump this and add a `migrate` function,
      // so phones with the old saved shape upgrade instead of crashing. (ADDING a field, like
      // lastPhone, needs no bump: persist merges the saved values over these defaults.)
      version: 1,
      storage: createJSONStorage(() => zustandMMKVStorage),
      // Save only the values, not the functions.
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        lastPhone: state.lastPhone,
        currentInstituteId: state.currentInstituteId,
      }),
    },
  ),
);
