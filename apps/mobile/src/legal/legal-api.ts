import { TERMS_VERSION } from '@coachingdesk/shared';
import { api } from '@/api';

/** POST /v1/me/terms: the logged-in user accepts the current terms (KB #54). */
export async function acceptTerms(): Promise<void> {
  await api.post('/v1/me/terms', { version: TERMS_VERSION });
}
