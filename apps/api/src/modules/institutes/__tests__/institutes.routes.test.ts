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

describe('tenancy: /v1/institutes/:instituteId', () => {
  const get = (token: string, id: string) =>
    app.inject({
      method: 'GET',
      url: `/v1/institutes/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
  const patch = (token: string, id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/v1/institutes/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  async function ownerWithInstitute() {
    const owner = await loginOverHttp(app, '9876543210');
    const created = await createInstitute(owner.accessToken, {
      name: 'Sharma Classes',
      type: 'tuition',
    });
    return { owner, instituteId: created.json().institute.id as string };
  }

  it('lets a member read their institute, with their role', async () => {
    setup();
    const { owner, instituteId } = await ownerWithInstitute();

    const response = await get(owner.accessToken, instituteId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      institute: { id: instituteId, name: 'Sharma Classes' },
      role: 'owner',
    });
  });

  // THE most important test in the app: one institute's data never leaks to another user.
  it('answers 404 to a non-member, exactly like an institute that does not exist', async () => {
    setup();
    const { instituteId } = await ownerWithInstitute();
    const stranger = await loginOverHttp(app, '9123456789');

    const someoneElses = await get(stranger.accessToken, instituteId);
    const nonExistent = await get(stranger.accessToken, '00000000-0000-7000-8000-00000000ffff');

    expect(someoneElses.statusCode).toBe(404);
    expect(nonExistent.statusCode).toBe(404);
    // Same body shape and message: nothing tells the stranger which one actually exists.
    expect(someoneElses.json().error).toEqual(nonExistent.json().error);
  });

  it('also blocks non-members from editing', async () => {
    setup();
    const { instituteId } = await ownerWithInstitute();
    const stranger = await loginOverHttp(app, '9123456789');

    expect((await patch(stranger.accessToken, instituteId, { name: 'Hacked' })).statusCode).toBe(
      404,
    );
  });

  it('answers 404 (not 500) for an id that is not even a UUID', async () => {
    setup();
    const owner = await loginOverHttp(app);
    expect((await get(owner.accessToken, 'not-a-uuid')).statusCode).toBe(404);
  });

  it('lets the owner change settings, with the entity rules applied', async () => {
    setup();
    const { owner, instituteId } = await ownerWithInstitute();

    const ok = await patch(owner.accessToken, instituteId, { billingDay: 5, city: ' Pune ' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().institute).toMatchObject({
      billingDay: 5,
      city: 'Pune',
      name: 'Sharma Classes',
    });

    const bad = await patch(owner.accessToken, instituteId, { billingDay: 31 });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details).toEqual({ field: 'billingDay' });
  });

  it('the owner changes settings (absence alerts, language, reminder days); bad days -> 422', async () => {
    setup();
    const { owner, instituteId } = await ownerWithInstitute();
    const token = owner.accessToken;

    const changed = await patch(token, instituteId, {
      settings: { absenceAlerts: false, reminderOffsets: [2, 0] },
    });
    const bad = await patch(token, instituteId, { settings: { reminderOffsets: [1, 1] } });

    expect(changed.statusCode).toBe(200);
    expect(changed.json().institute.settings).toEqual({
      absenceAlerts: false,
      messageLanguage: 'en',
      reminderOffsets: [2, 0],
      showUpiInReminders: false,
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details).toEqual({ field: 'settings.reminderOffsets' });
  });

  it('the owner sets a UPI ID and turns the reminder line on in one request; bad IDs -> 422', async () => {
    setup();
    const { owner, instituteId } = await ownerWithInstitute();
    const token = owner.accessToken;

    const tooEarly = await patch(token, instituteId, { settings: { showUpiInReminders: true } });
    const bad = await patch(token, instituteId, { upiId: 'sharma classes' });
    const ok = await patch(token, instituteId, {
      upiId: ' Sharma@OkAxis ',
      settings: { showUpiInReminders: true },
    });
    const removed = await patch(token, instituteId, { upiId: null });

    expect(tooEarly.statusCode).toBe(422);
    expect(tooEarly.json().error.details).toEqual({ field: 'settings.showUpiInReminders' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details).toEqual({ field: 'upiId' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().institute).toMatchObject({
      upiId: 'sharma@okaxis',
      settings: { showUpiInReminders: true },
    });
    expect(removed.json().institute).toMatchObject({
      upiId: null,
      settings: { showUpiInReminders: false },
    });
  });

  it('lets a teacher read but not change settings (403)', async () => {
    const { instituteRepository } = setup();
    const { instituteId } = await ownerWithInstitute();
    const teacher = await loginOverHttp(app, '9123456789');
    instituteRepository.addMember({ instituteId, userId: teacher.user.id, role: 'teacher' });

    const read = await get(teacher.accessToken, instituteId);
    expect(read.statusCode).toBe(200);
    expect(read.json().role).toBe('teacher');

    const write = await patch(teacher.accessToken, instituteId, { billingDay: 5 });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('FORBIDDEN');
  });

  it('requires login before anything else (401)', async () => {
    setup();
    const { instituteId } = await ownerWithInstitute();
    const response = await app.inject({ method: 'GET', url: `/v1/institutes/${instituteId}` });
    expect(response.statusCode).toBe(401);
  });
});
