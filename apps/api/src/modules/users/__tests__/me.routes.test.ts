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

const getMe = (token?: string) =>
  app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const patchMe = (token: string, payload: unknown) =>
  app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Record<string, unknown>,
  });

describe('GET /v1/me', () => {
  it('returns the logged-in user', async () => {
    setup();
    const login = await loginOverHttp(app);

    const response = await getMe(login.accessToken);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: login.user.id, name: null, locale: 'en' },
      institutes: [],
    });
  });

  it('returns 401 without a token', async () => {
    setup();
    const response = await getMe();
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 once the access token has expired (15 min)', async () => {
    const { clock } = setup();
    const login = await loginOverHttp(app);

    clock.advanceMinutes(15);

    expect((await getMe(login.accessToken)).statusCode).toBe(401);
  });

  it('shows each user only their own profile', async () => {
    setup();
    const neha = await loginOverHttp(app, '9876543210');
    const ravi = await loginOverHttp(app, '9123456789');

    expect((await getMe(neha.accessToken)).json().user.id).toBe(neha.user.id);
    expect((await getMe(ravi.accessToken)).json().user.id).toBe(ravi.user.id);
  });
});

describe('PATCH /v1/me', () => {
  it('updates name and language, and GET shows the change', async () => {
    setup();
    const login = await loginOverHttp(app);

    const response = await patchMe(login.accessToken, { name: '  Neha  Sharma ', locale: 'hi' });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ name: 'Neha Sharma', locale: 'hi' });
    expect((await getMe(login.accessToken)).json().user).toMatchObject({
      name: 'Neha Sharma',
      locale: 'hi',
    });
  });

  it.each([
    ['an empty body', {}],
    ['an unsupported language', { locale: 'fr' }],
    ['a phone change (not allowed here)', { name: 'Neha', phone: '9123456789' }],
    ['a blank name (entity rule)', { name: '   ' }],
  ])('returns 422 for %s', async (_case, payload) => {
    setup();
    const login = await loginOverHttp(app);

    const response = await patchMe(login.accessToken, payload);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 401 without a token', async () => {
    setup();
    const response = await app.inject({ method: 'PATCH', url: '/v1/me', payload: { name: 'X' } });
    expect(response.statusCode).toBe(401);
  });
});
