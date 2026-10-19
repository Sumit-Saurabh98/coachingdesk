import type { InjectOptions } from 'fastify';
import type { MemberRole } from '../modules/institutes/institute.repository';
import { type buildTestApp, loginOverHttp } from './test-app';

export const OWNER_PHONE = '9876543210';
export const OTHER_PHONE = '9123456789';
export const MEMBER_PHONE = '9988776655';

/**
 * HTTP helpers for tests of tenant routes (/v1/institutes/:instituteId/...).
 * Shared by every module's route tests, so "log in, create an institute, add a teacher"
 * is written once.
 */
export function tenantHttp(testApp: ReturnType<typeof buildTestApp>) {
  const { app } = testApp;

  /** One request; `token: undefined` sends no Authorization header. */
  const call = (
    token: string | undefined,
    method: InjectOptions['method'],
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  /** Logs in and creates an institute over HTTP; the caller is its owner. */
  async function ownerWithInstitute(phone = OWNER_PHONE) {
    const login = await loginOverHttp(app, phone);
    const created = await call(login.accessToken, 'POST', '/v1/institutes', {
      name: 'Sharma Classes',
      type: 'tuition',
    });
    const instituteId: string = created.json().institute.id;
    return { token: login.accessToken, instituteId, url: `/v1/institutes/${instituteId}` };
  }

  /** Adds a teacher/staff member (no members API yet, so straight into the in-memory repo). */
  async function memberWithRole(instituteId: string, role: MemberRole, phone = MEMBER_PHONE) {
    const login = await loginOverHttp(app, phone);
    testApp.instituteRepository.addMember({ instituteId, userId: login.user.id, role });
    return login.accessToken;
  }

  return { call, ownerWithInstitute, memberWithRole };
}
