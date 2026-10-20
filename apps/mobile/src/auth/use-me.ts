import { useQuery } from '@tanstack/react-query';
import { getMe } from './auth-api';

/** The cache key for GET /v1/me: one constant, so every reader and updater uses the same. */
export const ME_KEY = ['me'] as const;
export type MeData = Awaited<ReturnType<typeof getMe>>;

/**
 * Who is logged in, and their institutes. Many screens read it; TanStack Query fetches it
 * ONCE and shares the answer (same key = same cache entry).
 */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: ({ signal }) => getMe(signal) });
}
