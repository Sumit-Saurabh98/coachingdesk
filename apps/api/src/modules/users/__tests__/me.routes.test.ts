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
      termsAccepted: false, // loginOverHttp doesn't tick the terms (KB #54)
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

describe('DELETE /v1/me', () => {
  const deleteMe = (token?: string) =>
    app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('204: the account is gone; its refresh token no longer works', async () => {
    setup();
    const login = await loginOverHttp(app);

    expect((await deleteMe(login.accessToken)).statusCode).toBe(204);

    expect((await getMe(login.accessToken)).statusCode).toBe(401);
    const refresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: login.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('the same phone can sign up again afterwards, as a NEW user', async () => {
    setup();
    const first = await loginOverHttp(app);
    await deleteMe(first.accessToken);

    const again = await loginOverHttp(app);

    expect(again.user.id).not.toBe(first.user.id);
  });

  it('409 OWNER_OF_INSTITUTES while the user owns an institute; nothing is deleted', async () => {
    setup();
    const login = await loginOverHttp(app);
    await app.inject({
      method: 'POST',
      url: '/v1/institutes',
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: { name: 'Sharma Classes', type: 'tuition' },
    });

    const response = await deleteMe(login.accessToken);

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('OWNER_OF_INSTITUTES');
    expect((await getMe(login.accessToken)).statusCode).toBe(200);
  });

  it('a teacher can delete their account; they leave the institute', async () => {
    const { instituteRepository } = setup();
    const owner = await loginOverHttp(app);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/institutes',
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { name: 'Sharma Classes', type: 'tuition' },
    });
    const instituteId: string = created.json().institute.id;
    const teacher = await loginOverHttp(app, '9123456789');
    instituteRepository.addMember({ instituteId, userId: teacher.user.id, role: 'teacher' });

    expect((await deleteMe(teacher.accessToken)).statusCode).toBe(204);

    expect(await instituteRepository.findMembership(instituteId, teacher.user.id)).toBeNull();
  });

  it('401 without a token', async () => {
    setup();
    expect((await deleteMe()).statusCode).toBe(401);
  });
});
