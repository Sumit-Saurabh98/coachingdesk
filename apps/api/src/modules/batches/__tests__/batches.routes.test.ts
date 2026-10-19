import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { MemberRole } from '../../institutes/institute.repository';
import { buildTestApp, loginOverHttp } from '../../../test/test-app';

let app: FastifyInstance;
let testApp: ReturnType<typeof buildTestApp>;

afterEach(async () => {
  await app.close();
});

const OWNER_PHONE = '9876543210';
const OTHER_PHONE = '9123456789';
const MEMBER_PHONE = '9988776655';

const validBatch = {
  name: 'Class 10 Maths',
  subject: 'Maths',
  schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
  defaultFeePaise: 150000,
  defaultFeeCycle: 'monthly',
};

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
  return {
    token: login.accessToken,
    instituteId,
    batchesUrl: `/v1/institutes/${instituteId}/batches`,
  };
}

/** Adds a teacher/staff member (no members API yet, so straight into the in-memory repo). */
async function memberWithRole(instituteId: string, role: MemberRole, phone = MEMBER_PHONE) {
  const login = await loginOverHttp(app, phone);
  testApp.instituteRepository.addMember({ instituteId, userId: login.user.id, role });
  return login.accessToken;
}

async function setup() {
  testApp = buildTestApp();
  app = testApp.app;
  const owner = await ownerWithInstitute();
  const createBatch = async (payload: unknown = validBatch) =>
    (await call(owner.token, 'POST', owner.batchesUrl, payload)).json().batch;
  return { ...owner, createBatch };
}

describe('POST /v1/institutes/:instituteId/batches', () => {
  it('201: the owner creates a batch', async () => {
    const { token, batchesUrl } = await setup();

    const response = await call(token, 'POST', batchesUrl, validBatch);

    expect(response.statusCode).toBe(201);
    expect(response.json().batch).toEqual({
      id: expect.any(String),
      ...validBatch,
      archivedAt: null,
    });
  });

  it('applies the defaults: free, monthly, no subject', async () => {
    const { token, batchesUrl } = await setup();
    const response = await call(token, 'POST', batchesUrl, {
      name: 'Demo class',
      schedule: { days: [6], start: '10:00', end: '11:00' },
    });
    expect(response.json().batch).toMatchObject({
      subject: null,
      defaultFeePaise: 0,
      defaultFeeCycle: 'monthly',
    });
  });

  it('401 without a token', async () => {
    const { batchesUrl } = await setup();
    expect((await call(undefined, 'POST', batchesUrl, validBatch)).statusCode).toBe(401);
  });

  it('403 for a teacher; 201 for staff', async () => {
    const { instituteId, batchesUrl } = await setup();
    const teacher = await memberWithRole(instituteId, 'teacher');
    expect((await call(teacher, 'POST', batchesUrl, validBatch)).statusCode).toBe(403);

    const staff = await memberWithRole(instituteId, 'staff', '9000000099');
    expect((await call(staff, 'POST', batchesUrl, validBatch)).statusCode).toBe(201);
  });

  it("404 when creating in someone else's institute", async () => {
    const { batchesUrl } = await setup();
    const stranger = await loginOverHttp(app, OTHER_PHONE);
    expect((await call(stranger.accessToken, 'POST', batchesUrl, validBatch)).statusCode).toBe(404);
  });

  it.each([
    ['an unknown field (instituteId in the body)', { ...validBatch, instituteId: 'x' }, undefined],
    ['a decimal fee', { ...validBatch, defaultFeePaise: 1500.5 }, undefined],
    ['an unknown fee cycle', { ...validBatch, defaultFeeCycle: 'weekly' }, undefined],
    [
      'start after end (entity rule)',
      { ...validBatch, schedule: { days: [1], start: '18:00', end: '17:00' } },
      'schedule',
    ],
    ['a one-letter name (entity rule)', { ...validBatch, name: 'A' }, 'name'],
  ])('422 for %s', async (_label, payload, field) => {
    const { token, batchesUrl } = await setup();
    const response = await call(token, 'POST', batchesUrl, payload);
    expect(response.statusCode).toBe(422);
    if (field) {
      expect(response.json().error.details).toEqual({ field });
    }
  });
});

describe('GET /v1/institutes/:instituteId/batches', () => {
  it('200: lists the batches; a teacher can read them', async () => {
    const { instituteId, batchesUrl, createBatch } = await setup();
    await createBatch({ ...validBatch, name: 'First' });
    await createBatch({ ...validBatch, name: 'Second' });
    const teacher = await memberWithRole(instituteId, 'teacher');

    const response = await call(teacher, 'GET', batchesUrl);

    expect(response.statusCode).toBe(200);
    expect(response.json().batches.map((b: { name: string }) => b.name)).toEqual([
      'First',
      'Second',
    ]);
  });

  it("never shows another institute's batches", async () => {
    const { createBatch } = await setup();
    await createBatch();
    const other = await ownerWithInstitute(OTHER_PHONE);

    const response = await call(other.token, 'GET', other.batchesUrl);

    expect(response.json().batches).toEqual([]);
  });

  it('?includeArchived=true also shows archived ones; 422 for anything but true/false', async () => {
    const { token, batchesUrl, createBatch } = await setup();
    const batch = await createBatch();
    await call(token, 'POST', `${batchesUrl}/${batch.id}/archive`);

    expect((await call(token, 'GET', batchesUrl)).json().batches).toEqual([]);
    expect(
      (await call(token, 'GET', `${batchesUrl}?includeArchived=true`)).json().batches,
    ).toHaveLength(1);
    expect((await call(token, 'GET', `${batchesUrl}?includeArchived=yes`)).statusCode).toBe(422);
  });

  it('401 without a token, 404 for a non-member', async () => {
    const { batchesUrl } = await setup();
    const stranger = await loginOverHttp(app, OTHER_PHONE);
    expect((await call(undefined, 'GET', batchesUrl)).statusCode).toBe(401);
    expect((await call(stranger.accessToken, 'GET', batchesUrl)).statusCode).toBe(404);
  });
});

describe('GET /v1/institutes/:instituteId/batches/:batchId', () => {
  it('200 with the batch', async () => {
    const { token, batchesUrl, createBatch } = await setup();
    const batch = await createBatch();

    const response = await call(token, 'GET', `${batchesUrl}/${batch.id}`);

    expect(response.statusCode).toBe(200);
    expect(response.json().batch).toEqual(batch);
  });

  it("TENANCY: 404 for another institute's batch id, even through my OWN institute's URL", async () => {
    const { createBatch } = await setup();
    const nehasBatch = await createBatch();
    // Ravi is a real member of HIS institute, so the tenancy guard lets him through...
    const ravi = await ownerWithInstitute(OTHER_PHONE);

    // ...but the batch id belongs to Neha's institute: the repository's WHERE stops it.
    const response = await call(ravi.token, 'GET', `${ravi.batchesUrl}/${nehasBatch.id}`);

    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe('Batch not found');
  });

  it('404 (not 500) for a batch id that is not a UUID', async () => {
    const { token, batchesUrl } = await setup();
    expect((await call(token, 'GET', `${batchesUrl}/not-a-uuid`)).statusCode).toBe(404);
  });
});

describe('PATCH /v1/institutes/:instituteId/batches/:batchId', () => {
  it('200: changes only what was sent', async () => {
    const { token, batchesUrl, createBatch } = await setup();
    const batch = await createBatch();

    const response = await call(token, 'PATCH', `${batchesUrl}/${batch.id}`, {
      defaultFeePaise: 200000,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().batch).toEqual({ ...batch, defaultFeePaise: 200000 });
  });

  it('403 for a teacher', async () => {
    const { instituteId, batchesUrl, createBatch } = await setup();
    const batch = await createBatch();
    const teacher = await memberWithRole(instituteId, 'teacher');
    expect(
      (await call(teacher, 'PATCH', `${batchesUrl}/${batch.id}`, { name: 'New' })).statusCode,
    ).toBe(403);
  });

  it('409 for an archived batch', async () => {
    const { token, batchesUrl, createBatch } = await setup();
    const batch = await createBatch();
    await call(token, 'POST', `${batchesUrl}/${batch.id}/archive`);

    const response = await call(token, 'PATCH', `${batchesUrl}/${batch.id}`, { name: 'New' });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('422 for an empty body', async () => {
    const { token, batchesUrl, createBatch } = await setup();
    const batch = await createBatch();
    expect((await call(token, 'PATCH', `${batchesUrl}/${batch.id}`, {})).statusCode).toBe(422);
  });

  it("404 for another institute's batch", async () => {
    const { createBatch } = await setup();
    const nehasBatch = await createBatch();
    const ravi = await ownerWithInstitute(OTHER_PHONE);
    const response = await call(ravi.token, 'PATCH', `${ravi.batchesUrl}/${nehasBatch.id}`, {
      name: 'Hijacked',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /v1/institutes/:instituteId/batches/:batchId/archive', () => {
  it('200, and a retry is also 200 with the SAME archive time (idempotent)', async () => {
    const { token, batchesUrl, createBatch } = await setup();
    const batch = await createBatch();
    const url = `${batchesUrl}/${batch.id}/archive`;

    const first = await call(token, 'POST', url);
    testApp.clock.advanceMinutes(5);
    const retry = await call(token, 'POST', url);

    expect(first.statusCode).toBe(200);
    expect(first.json().batch.archivedAt).toBe('2026-10-19T10:00:00.000Z');
    expect(retry.statusCode).toBe(200);
    expect(retry.json().batch.archivedAt).toBe('2026-10-19T10:00:00.000Z');
  });

  it('403 for a teacher, 404 for a non-member', async () => {
    const { instituteId, batchesUrl, createBatch } = await setup();
    const batch = await createBatch();
    const url = `${batchesUrl}/${batch.id}/archive`;
    const teacher = await memberWithRole(instituteId, 'teacher');
    const stranger = await loginOverHttp(app, OTHER_PHONE);

    expect((await call(teacher, 'POST', url)).statusCode).toBe(403);
    expect((await call(stranger.accessToken, 'POST', url)).statusCode).toBe(404);
  });
});
