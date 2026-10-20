// On-phone storage for small values (preferences), using MMKV.
// Why MMKV: it's SYNCHRONOUS. When the app starts, the saved theme is read immediately,
// before the first screen is drawn, so the app never flashes light and then turns dark.
// (Secrets like the login token do NOT go here: they go in the encrypted secure store, Step 27.)
import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

// One named storage file on the phone just for preferences.
export const preferencesStorage = createMMKV({ id: 'preferences' });

// Zustand's "persist" feature saves a store through an object with these three methods.
// This adapter connects it to MMKV.
export const zustandMMKVStorage: StateStorage = {
  getItem: (name) => preferencesStorage.getString(name) ?? null,
  setItem: (name, value) => preferencesStorage.set(name, value),
  removeItem: (name) => {
    preferencesStorage.remove(name);
  },
};
