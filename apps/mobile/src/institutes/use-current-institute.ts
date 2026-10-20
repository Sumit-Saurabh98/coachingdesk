import { useMe } from '@/auth/use-me';
import { usePreferences } from '@/stores/preferences';
import { pickCurrentInstitute } from './current-institute';

/**
 * The institute the app works in now (see pickCurrentInstitute), plus the user's whole list.
 * `me` is the underlying query: callers check me.isPending / me.isError for loading states.
 */
export function useCurrentInstitute() {
  const me = useMe();
  const savedId = usePreferences((state) => state.currentInstituteId);
  const institutes = me.data?.institutes ?? [];
  return { me, institutes, current: pickCurrentInstitute(institutes, savedId) };
}
