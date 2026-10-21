import type { CreateInstituteBody } from '@coachingdesk/shared';
import { api } from '@/api';
import type { InstituteDetail, InstituteUpdate } from './settings-rules';
import type { Member } from './team-rules';

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

/** Cache keys for the current institute's own details (settings, entitlements). */
export const instituteKeys = {
  detail: (instituteId: string) => ['institutes', instituteId, 'detail'] as const,
};

export interface InstituteResponse {
  institute: InstituteDetail & {
    type: 'tuition' | 'academy' | 'home_tutor';
    timezone: string;
    deletion: { requestedAt: string; purgeAfter: string | null } | null;
  };
  role: 'owner' | 'teacher' | 'staff';
  entitlements: {
    plan: string;
    maxActiveStudents: number | null;
    maxMembers: number | null;
    monthlyMessages: number;
    features: string[];
  };
}

/** GET /v1/institutes/:id (any member): the institute, its settings, and what the plan allows. */
export function getInstitute(
  instituteId: string,
  signal?: AbortSignal,
): Promise<InstituteResponse> {
  return api.get(`/v1/institutes/${instituteId}`, { signal });
}

/** PATCH /v1/institutes/:id (owner): only the fields that change. */
export async function updateInstitute(
  instituteId: string,
  body: InstituteUpdate,
): Promise<InstituteResponse['institute']> {
  const result = await api.patch<{ institute: InstituteResponse['institute'] }>(
    `/v1/institutes/${instituteId}`,
    body,
  );
  return result.institute;
}

export const memberKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'members'] as const,
};

/** GET .../members (owner): the team. */
export async function listMembers(instituteId: string, signal?: AbortSignal): Promise<Member[]> {
  const result = await api.get<{ members: Member[] }>(`/v1/institutes/${instituteId}/members`, {
    signal,
  });
  return result.members;
}

/**
 * POST .../members (owner): adds a teacher or staff member by phone. They get access when they
 * next log in with that number. 402 over the plan's team size; 409 already in the team.
 */
export async function addMember(
  instituteId: string,
  body: { phone: string; name: string; role: 'teacher' | 'staff' },
): Promise<Member> {
  const result = await api.post<{ member: Member }>(`/v1/institutes/${instituteId}/members`, body);
  return result.member;
}

/** DELETE .../members/:userId (owner): they lose access at once. */
export async function removeMember(instituteId: string, userId: string): Promise<void> {
  await api.delete(`/v1/institutes/${instituteId}/members/${userId}`);
}
