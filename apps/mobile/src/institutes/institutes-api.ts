import type { CreateInstituteBody } from '@coachingdesk/shared';
import { api } from '@/api';

export interface CreatedInstitute {
  institute: { id: string; name: string; type: 'tuition' | 'academy' | 'home_tutor' };
  role: 'owner';
  trialEndsAt: string;
}

/**
 * POST /v1/institutes: the caller becomes the OWNER, and the 30-day Pro trial starts.
 * The body type comes from packages/shared: the same shape the API validates.
 */
export function createInstitute(body: CreateInstituteBody): Promise<CreatedInstitute> {
  return api.post('/v1/institutes', body);
}
