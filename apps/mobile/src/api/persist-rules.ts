// Pure TypeScript: which cached answers are saved on the phone, unit-tested in Node.

/** Saved answers older than this are thrown away when the app starts. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // attendance can be edited 7 days back

/**
 * Change this when the SHAPE of saved answers changes (a new app version reading old data
 * would break): the phone then starts with an empty cache instead.
 */
export const CACHE_VERSION = '1';

/**
 * Only successful answers from the server. Not the attendance queue: it lives in SQLite
 * already, and the copy in the cache is just for re-drawing screens.
 */
export function shouldPersistQuery(queryKey: readonly unknown[], status: string): boolean {
  return status === 'success' && queryKey[0] !== 'attendance-outbox';
}
