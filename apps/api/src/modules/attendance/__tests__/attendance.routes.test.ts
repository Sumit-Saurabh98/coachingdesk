import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp, loginOverHttp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

const CLIENT_1 = '00000000-0000-7000-8000-00000000c001';
const CLIENT_2 = '00000000-0000-7000-8000-00000000c002';

/** Institute with a Mon/Wed batch and two enrolled students (Aarav, Bhavya); a teacher member. */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const post = async (path: string, payload: unknown) =>
    (await http.call(owner.token, 'POST', `${owner.url}${path}`, payload)).json();
  const { batch } = await post('/batches', {
    name: 'Maths',
    schedule: { days: [1, 3], start: '17:00', end: '18:00' },
  });
  const add = async (name: string) =>
    (
      await post('/students', {
        name,
        guardianPhone: '9876543210',
        joinedOn: '2026-10-01',
        batchIds: [batch.id],
      })
    ).student;
  const aarav = await add('Aarav');
  const bhavya = await add('Bhavya');
  const teacher = await http.memberWithRole(owner.instituteId, 'teacher');
  const syncUrl = (clientId: string) => `${owner.url}/attendance-sessions/${clientId}`;
  const sync = (
    token: string | undefined,
    clientId: string,
    records: unknown,
    date = '2026-10-19',
  ) => http.call(token, 'PUT', syncUrl(clientId), { batchId: batch.id, date, records });
  return { ...owner, batch, aarav, bhavya, teacher, sync };
}

describe('PUT /v1/institutes/:instituteId/attendance-sessions/:clientId', () => {
  it('200: a teacher takes attendance', async () => {
    const { teacher, sync, aarav, bhavya, batch } = await setup();

    const response = await sync(teacher, CLIENT_1, [
      { studentId: aarav.id, status: 'present' },
      { studentId: bhavya.id, status: 'absent' },
    ]);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.session).toMatchObject({
      batchId: batch.id,
      date: '2026-10-19',
      clientId: CLIENT_1,
      submittedAt: '2026-10-19T10:00:00.000Z', // server time, not the phone's
    });
    expect(body.records).toHaveLength(2);
    expect(body.alerts).toEqual({ status: 'not_enabled', queued: 0 });
  });

  it('a retry of the same sync returns the same session (idempotent)', async () => {
    const { teacher, sync, aarav } = await setup();
    const records = [{ studentId: aarav.id, status: 'absent' }];
    const first = (await sync(teacher, CLIENT_1, records)).json();
    const retry = (await sync(teacher, CLIENT_1, records)).json();
    expect(retry.session.id).toBe(first.session.id);
  });

  it('two phones, same batch and day: one session, merged per student', async () => {
    const { token, teacher, sync, aarav, bhavya } = await setup();
    await sync(teacher, CLIENT_1, [
      { studentId: aarav.id, status: 'absent' },
      { studentId: bhavya.id, status: 'present' },
    ]);

    const second = await sync(token, CLIENT_2, [{ studentId: aarav.id, status: 'late' }]);

    expect(second.json().session.clientId).toBe(CLIENT_1);
    expect(second.json().records).toEqual(
      expect.arrayContaining([
        { studentId: aarav.id, status: 'late' },
        { studentId: bhavya.id, status: 'present' },
      ]),
    );
  });

  it('422: student not in the batch, a future date, a bad clientId', async () => {
    const { token, url, teacher, sync, aarav } = await setup();
    const outsider = (
      await http.call(token, 'POST', `${url}/students`, {
        name: 'Dev',
        guardianPhone: '9812345678',
      })
    ).json().student;

    const notEnrolled = await sync(teacher, CLIENT_1, [
      { studentId: outsider.id, status: 'present' },
    ]);
    const future = await sync(
      teacher,
      CLIENT_1,
      [{ studentId: aarav.id, status: 'present' }],
      '2026-10-25',
    );
    const badClient = await sync(teacher, 'not-a-uuid', [
      { studentId: aarav.id, status: 'present' },
    ]);

    expect(notEnrolled.statusCode).toBe(422);
    expect(notEnrolled.json().error.details).toEqual({
      field: 'records',
      studentIds: [outsider.id],
    });
    expect(future.statusCode).toBe(422);
    expect(badClient.statusCode).toBe(422);
  });

  it('401 without a token, 404 for a non-member', async () => {
    const { sync, aarav } = await setup();
    const stranger = await loginOverHttp(app, OTHER_PHONE);
    const records = [{ studentId: aarav.id, status: 'present' }];
    expect((await sync(undefined, CLIENT_1, records)).statusCode).toBe(401);
    expect((await sync(stranger.accessToken, CLIENT_1, records)).statusCode).toBe(404);
  });
});

describe('GET .../batches/:batchId/attendance?date=', () => {
  it('the register: enrolled students, marks and defaults', async () => {
    const { url, teacher, sync, batch, bhavya } = await setup();
    await sync(teacher, CLIENT_1, [{ studentId: bhavya.id, status: 'absent' }]);

    const response = await http.call(
      teacher,
      'GET',
      `${url}/batches/${batch.id}/attendance?date=2026-10-19`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().students).toEqual([
      { studentId: expect.any(String), name: 'Aarav', status: 'present', marked: false },
      { studentId: bhavya.id, name: 'Bhavya', status: 'absent', marked: true },
    ]);
  });

  it('422 without a date; 404 for another institute', async () => {
    const { url, teacher, batch } = await setup();
    const ravi = await http.ownerWithInstitute(OTHER_PHONE);
    expect(
      (await http.call(teacher, 'GET', `${url}/batches/${batch.id}/attendance`)).statusCode,
    ).toBe(422);
    expect(
      (
        await http.call(
          ravi.token,
          'GET',
          `${ravi.url}/batches/${batch.id}/attendance?date=2026-10-19`,
        )
      ).statusCode,
    ).toBe(404);
  });
});

describe('GET .../students/:studentId/attendance and GET .../attendance/summary', () => {
  it("a student's history with the percentage", async () => {
    const { url, teacher, sync, aarav } = await setup();
    await sync(teacher, CLIENT_1, [{ studentId: aarav.id, status: 'present' }], '2026-10-14');
    await sync(teacher, CLIENT_2, [{ studentId: aarav.id, status: 'absent' }], '2026-10-19');

    const response = await http.call(
      teacher,
      'GET',
      `${url}/students/${aarav.id}/attendance?from=2026-10-01&to=2026-10-31`,
    );

    expect(response.json()).toMatchObject({
      records: [
        { date: '2026-10-14', status: 'present' },
        { date: '2026-10-19', status: 'absent' },
      ],
      summary: { present: 1, absent: 1, percentage: 50 },
    });
  });

  it("today's summary: the Monday batch, not taken -> taken", async () => {
    const { url, teacher, sync, aarav } = await setup();
    const before = (await http.call(teacher, 'GET', `${url}/attendance/summary`)).json();
    await sync(teacher, CLIENT_1, [{ studentId: aarav.id, status: 'absent' }]);
    const after = (await http.call(teacher, 'GET', `${url}/attendance/summary`)).json();

    expect(before).toMatchObject({
      date: '2026-10-19',
      batches: [{ name: 'Maths', taken: false }],
    });
    expect(after.batches[0]).toMatchObject({ taken: true, counts: { absent: 1 } });
    // Tuesday: the Mon/Wed batch isn't listed.
    const tuesday = (
      await http.call(teacher, 'GET', `${url}/attendance/summary?date=2026-10-20`)
    ).json();
    expect(tuesday.batches).toEqual([]);
  });
});
