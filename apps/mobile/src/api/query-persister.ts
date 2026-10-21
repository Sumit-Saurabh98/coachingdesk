// Saves TanStack Query's cache on the phone, so screens open with the last data even with no
// internet (NFR-3), and then refresh when they can. Its own MMKV file, apart from preferences.
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { createMMKV } from 'react-native-mmkv';

const cacheStorage = createMMKV({ id: 'query-cache' });

export const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => cacheStorage.getString(key) ?? null,
    setItem: (key, value) => cacheStorage.set(key, value),
    removeItem: (key) => {
      cacheStorage.remove(key);
    },
  },
  throttleTime: 1000, // at most one write a second, however many answers arrive
});
