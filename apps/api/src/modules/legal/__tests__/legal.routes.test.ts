import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TERMS_VERSION } from '@coachingdesk/shared';
import { buildTestApp, loginOverHttp, TEST_OTP } from '../../../test/test-app';

let app: FastifyInstance;

function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  return testApp;
}

afterEach(async () => {
  await app.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const termsAccepted = async (token: string) =>
  (await app.inject({ method: 'GET', url: '/v1/me', headers: auth(token) })).json().termsAccepted;
const acceptTerms = (payload: unknown, token?: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/me/terms',
    headers: token ? auth(token) : {},
    payload: payload as Record<string, unknown>,
  });

async function verify(phone: string, extra: Record<string, unknown> = {}) {
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  return app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { phone, otp: TEST_OTP, ...extra },
  });
}

describe('accepting the terms at login (KB #54)', () => {
  it('the tick on the login screen is recorded: /me says termsAccepted', async () => {
    const { termsAcceptanceRepository } = setup();
    const response = await verify('9876543210', { acceptedTerms: TERMS_VERSION });

    expect(response.statusCode).toBe(200);
    const { accessToken, user } = response.json();
    expect(await termsAccepted(accessToken)).toBe(true);
    expect(await termsAcceptanceRepository.latestVersion(user.id)).toBe(TERMS_VERSION);
  });

  it('logging in without it (an older app) works, but /me says not accepted yet', async () => {
    setup();
    const login = await loginOverHttp(app);
    expect(await termsAccepted(login.accessToken)).toBe(false);
  });

  it('outdated terms -> 409 TERMS_OUTDATED, and the code is NOT used up', async () => {
    setup();
    const stale = await verify('9876543210', { acceptedTerms: '2020-01-01' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: 'TERMS_OUTDATED',
      details: { currentVersion: TERMS_VERSION },
    });

    // Same code, current terms: still works.
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone: '9876543210', otp: TEST_OTP, acceptedTerms: TERMS_VERSION },
    });
    expect(retry.statusCode).toBe(200);
  });
});

describe('POST /v1/me/terms', () => {
  it('accepts the current terms -> 204; /me then says accepted', async () => {
    setup();
    const login = await loginOverHttp(app);

    const response = await acceptTerms({ version: TERMS_VERSION }, login.accessToken);

    expect(response.statusCode).toBe(204);
    expect(await termsAccepted(login.accessToken)).toBe(true);
  });

  it('an old version -> 409 TERMS_OUTDATED, nothing recorded', async () => {
    setup();
    const login = await loginOverHttp(app);

    const response = await acceptTerms({ version: '2020-01-01' }, login.accessToken);

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('TERMS_OUTDATED');
    expect(await termsAccepted(login.accessToken)).toBe(false);
  });

  it('a bad body -> 422; not logged in -> 401', async () => {
    setup();
    const login = await loginOverHttp(app);

    expect((await acceptTerms({}, login.accessToken)).statusCode).toBe(422);
    expect(
      (await acceptTerms({ version: TERMS_VERSION, extra: 1 }, login.accessToken)).statusCode,
    ).toBe(422);
    expect((await acceptTerms({ version: TERMS_VERSION })).statusCode).toBe(401);
  });

  it('deleting the account deletes the acceptances', async () => {
    const { termsAcceptanceRepository } = setup();
    const login = await loginOverHttp(app);
    await acceptTerms({ version: TERMS_VERSION }, login.accessToken);

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: auth(login.accessToken),
    });

    expect(deleted.statusCode).toBe(204);
    expect(await termsAcceptanceRepository.latestVersion(login.user.id)).toBeNull();
  });
});
