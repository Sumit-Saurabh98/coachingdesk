import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginOverHttp } from '../../../test/test-app';

let app: FastifyInstance;

function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  return testApp;
}

afterEach(async () => {
  await app.close();
});

const createInstitute = (token: string | undefined, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: '/v1/institutes',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as Record<string, unknown>,
  });

describe('POST /v1/institutes', () => {
  it('returns 201 with the institute, the owner role and the trial', async () => {
    setup();
    const login = await loginOverHttp(app);

    const response = await createInstitute(login.accessToken, {
      name: 'Sharma Classes',
      type: 'tuition',
      city: 'Pune',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      institute: { name: 'Sharma Classes', type: 'tuition', city: 'Pune', billingDay: 1 },
      role: 'owner',
      subscription: { plan: 'pro', status: 'trialing', trialEndsAt: '2026-11-18T10:00:00.000Z' },
    });
  });

  it('then shows up in GET /v1/me', async () => {
    setup();
    const login = await loginOverHttp(app);
    const created = (
      await createInstitute(login.accessToken, { name: 'Sharma Classes', type: 'tuition' })
    ).json();

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${login.accessToken}` },
    });

    expect(me.json().institutes).toEqual([
      { id: created.institute.id, name: 'Sharma Classes', type: 'tuition', role: 'owner' },
    ]);
  });

  it('does not show one user’s institute to another user', async () => {
    setup();
    const neha = await loginOverHttp(app, '9876543210');
    const ravi = await loginOverHttp(app, '9123456789');
    await createInstitute(neha.accessToken, { name: 'Sharma Classes', type: 'tuition' });

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${ravi.accessToken}` },
    });

    expect(me.json().institutes).toEqual([]);
  });

  it.each([
    ['a missing type', { name: 'Sharma Classes' }],
    ['an unknown type', { name: 'Sharma Classes', type: 'school' }],
    ['a too-short name (entity rule)', { name: 'A', type: 'tuition' }],
    ['an unknown field', { name: 'Sharma Classes', type: 'tuition', plan: 'academy' }],
  ])('returns 422 for %s', async (_case, payload) => {
    setup();
    const login = await loginOverHttp(app);
    const response = await createInstitute(login.accessToken, payload);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 401 without a token', async () => {
    setup();
    expect(
      (await createInstitute(undefined, { name: 'X Classes', type: 'tuition' })).statusCode,
    ).toBe(401);
  });
});
