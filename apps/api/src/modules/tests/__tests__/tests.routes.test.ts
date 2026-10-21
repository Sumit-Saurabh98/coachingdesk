import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';
import { ResultRevalidator } from '../../messaging/result-revalidator';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

const STAFF_PHONE = '9000000077';
const UNKNOWN = '00000000-0000-7000-8000-00000000ffff';

/** Maths: Aarav, Bhavya, Chirag. Science: Diya. Pro trial; the clock says 2026-10-19. */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const post = async (path: string, payload: unknown) =>
    (await http.call(owner.token, 'POST', `${owner.url}${path}`, payload)).json();
  const batch = async (name: string) =>
    (await post('/batches', { name, schedule: { days: [1], start: '17:00', end: '18:00' } })).batch;
  const maths = await batch('Maths');
  const science = await batch('Science');
  const add = async (name: string, batchIds: string[]) =>
    (
      await post('/students', {
        name,
        guardianPhone: '9812345678',
        joinedOn: '2026-10-01',
        batchIds,
      })
    ).student;
  const aarav = await add('Aarav', [maths.id]);
  const bhavya = await add('Bhavya', [maths.id]);
  const chirag = await add('Chirag', [maths.id]);
  const diya = await add('Diya', [science.id]);
  const teacher = await http.memberWithRole(owner.instituteId, 'teacher');
  const staff = await http.memberWithRole(owner.instituteId, 'staff', STAFF_PHONE);
  const createTest = async (body: object = {}, token = owner.token) =>
    http.call(token, 'POST', `${owner.url}/batches/${maths.id}/tests`, {
      name: 'Unit 3',
      date: '2026-10-19',
      maxMarks: 50,
      ...body,
    });
  const test = (await (await createTest()).json()).test;
  const testUrl = `${owner.url}/tests/${test.id}`;
  return {
    ...owner,
    testApp,
    maths,
    science,
    aarav,
    bhavya,
    chirag,
    diya,
    teacher,
    staff,
    createTest,
    test,
    testUrl,
  };
}

describe('tests: create and list', () => {
  it('owner and teacher create (201); staff 403; no login 401', async () => {
    const { createTest, teacher, staff, url, maths } = await setup();

    const byTeacher = await createTest({ name: 'Weekly quiz', maxMarks: 20 }, teacher);
    expect(byTeacher.statusCode).toBe(201);
    expect(byTeacher.json().test).toMatchObject({
      name: 'Weekly quiz',
      date: '2026-10-19',
      maxMarks: 20,
      resultsSentAt: null,
    });
    expect((await createTest({}, staff)).statusCode).toBe(403);
    const noLogin = await http.call(undefined, 'POST', `${url}/batches/${maths.id}/tests`, {
      name: 'T',
      date: '2026-10-19',
      maxMarks: 5,
    });
    expect(noLogin.statusCode).toBe(401);
  });

  it('422 for a bad name or maximum; 404 for an unknown batch; 409 for an archived one', async () => {
    const { createTest, token, url, science } = await setup();
    expect((await createTest({ name: ' ' })).statusCode).toBe(422);
    expect((await createTest({ maxMarks: 0 })).statusCode).toBe(422);
    expect((await createTest({ maxMarks: 10.001 })).statusCode).toBe(422);
    expect(
      (
        await http.call(token, 'POST', `${url}/batches/${UNKNOWN}/tests`, {
          name: 'T',
          date: '2026-10-19',
          maxMarks: 5,
        })
      ).statusCode,
    ).toBe(404);

    await http.call(token, 'POST', `${url}/batches/${science.id}/archive`);
    const archived = await http.call(token, 'POST', `${url}/batches/${science.id}/tests`, {
      name: 'T',
      date: '2026-10-19',
      maxMarks: 5,
    });
    expect(archived.statusCode).toBe(409);
  });

  it('lists the batch tests newest first with counts; staff can read', async () => {
    const { createTest, staff, url, maths, testUrl, aarav, bhavya, token } = await setup();
    await createTest({ name: 'Older', date: '2026-10-05' });
    await http.call(token, 'PUT', `${testUrl}/scores`, {
      scores: [
        { studentId: aarav.id, marks: 40 },
        { studentId: bhavya.id, isAbsent: true },
      ],
    });

    const response = await http.call(staff, 'GET', `${url}/batches/${maths.id}/tests`);

    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .tests.map((t: { name: string; scored: number; absent: number }) => [
          t.name,
          t.scored,
          t.absent,
        ]),
    ).toEqual([
      ['Unit 3', 1, 1],
      ['Older', 0, 0],
    ]);
  });
});

describe('tests: marks', () => {
  it('a teacher enters marks and absents: the sheet lists the whole batch with stats', async () => {
    const { teacher, testUrl, aarav, bhavya } = await setup();

    const response = await http.call(teacher, 'PUT', `${testUrl}/scores`, {
      scores: [
        { studentId: aarav.id, marks: 42.5 },
        { studentId: bhavya.id, isAbsent: true },
      ],
    });

    expect(response.statusCode).toBe(200);
    const sheet = response.json();
    expect(sheet.students).toEqual([
      {
        studentId: aarav.id,
        name: 'Aarav',
        rollNumber: null,
        marks: 42.5,
        isAbsent: false,
        entered: true,
      },
      {
        studentId: bhavya.id,
        name: 'Bhavya',
        rollNumber: null,
        marks: null,
        isAbsent: true,
        entered: true,
      },
      {
        studentId: expect.any(String),
        name: 'Chirag',
        rollNumber: null,
        marks: null,
        isAbsent: false,
        entered: false,
      },
    ]);
    expect(sheet.stats).toEqual({
      students: 3,
      scored: 1,
      absent: 1,
      average: 42.5,
      highest: 42.5,
      lowest: 42.5,
    });
  });

  it('re-entering replaces; students not sent keep their marks', async () => {
    const { token, testUrl, aarav, bhavya } = await setup();
    const put = (scores: unknown) => http.call(token, 'PUT', `${testUrl}/scores`, { scores });
    await put([
      { studentId: aarav.id, marks: 10 },
      { studentId: bhavya.id, marks: 20 },
    ]);
    await put([{ studentId: aarav.id, marks: 15 }]);

    const sheet = (await http.call(token, 'GET', testUrl)).json();
    expect(sheet.students.slice(0, 2).map((s: { marks: number }) => s.marks)).toEqual([15, 20]);
    expect(sheet.stats).toMatchObject({ average: 17.5, highest: 20, lowest: 15 });
  });

  it('422: marks above the maximum, or a student from another batch; staff 403', async () => {
    const { token, staff, testUrl, aarav, diya } = await setup();
    const put = (scores: unknown, who = token) =>
      http.call(who, 'PUT', `${testUrl}/scores`, { scores });

    const tooHigh = await put([{ studentId: aarav.id, marks: 51 }]);
    expect(tooHigh.statusCode).toBe(422);
    expect(tooHigh.json().error.details).toMatchObject({ studentIds: [aarav.id], maxMarks: 50 });

    const otherBatch = await put([{ studentId: diya.id, marks: 10 }]);
    expect(otherBatch.statusCode).toBe(422);
    expect(otherBatch.json().error.details).toMatchObject({ studentIds: [diya.id] });

    expect((await put([{ studentId: aarav.id, marks: 1, isAbsent: true }])).statusCode).toBe(422);
    expect((await put([{ studentId: aarav.id, marks: 10 }], staff)).statusCode).toBe(403);
  });

  it("a student's results across tests: GET /students/:id/tests", async () => {
    const { token, url, testUrl, aarav, createTest } = await setup();
    await http.call(token, 'PUT', `${testUrl}/scores`, {
      scores: [{ studentId: aarav.id, marks: 33 }],
    });
    const older = (
      await (await createTest({ name: 'Older', date: '2026-10-05', maxMarks: 20 })).json()
    ).test;
    await http.call(token, 'PUT', `${url}/tests/${older.id}/scores`, {
      scores: [{ studentId: aarav.id, isAbsent: true }],
    });

    const response = await http.call(token, 'GET', `${url}/students/${aarav.id}/tests`);

    expect(
      response
        .json()
        .results.map((r: { test: { name: string }; marks: number | null; isAbsent: boolean }) => [
          r.test.name,
          r.marks,
          r.isAbsent,
        ]),
    ).toEqual([
      ['Unit 3', 33, false],
      ['Older', null, true],
    ]);
    expect((await http.call(token, 'GET', `${url}/students/${UNKNOWN}/tests`)).statusCode).toBe(
      404,
    );
  });
});

describe('tests: change and delete', () => {
  it('rename and change the maximum; never below a mark already given (409)', async () => {
    const { token, testUrl, aarav } = await setup();
    await http.call(token, 'PUT', `${testUrl}/scores`, {
      scores: [{ studentId: aarav.id, marks: 44 }],
    });

    const renamed = await http.call(token, 'PATCH', testUrl, {
      name: 'Unit 3 (final)',
      maxMarks: 45,
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().test).toMatchObject({ name: 'Unit 3 (final)', maxMarks: 45 });

    const tooLow = await http.call(token, 'PATCH', testUrl, { maxMarks: 40 });
    expect(tooLow.statusCode).toBe(409);
    expect(tooLow.json().error.details).toMatchObject({ highestMarks: 44 });
    expect((await http.call(token, 'PATCH', testUrl, {})).statusCode).toBe(422);
  });

  it('delete: 204, then the test is gone (404); staff 403', async () => {
    const { token, staff, testUrl } = await setup();
    expect((await http.call(staff, 'DELETE', testUrl)).statusCode).toBe(403);
    expect((await http.call(token, 'DELETE', testUrl)).statusCode).toBe(204);
    expect((await http.call(token, 'GET', testUrl)).statusCode).toBe(404);
    expect((await http.call(token, 'DELETE', testUrl)).statusCode).toBe(404);
  });
});

describe('tests: tenancy and plan', () => {
  it("another institute's test or batch is a 404, as is a malformed id", async () => {
    const { test, maths } = await setup();
    const other = await http.ownerWithInstitute(OTHER_PHONE);

    for (const [method, path] of [
      ['GET', `/tests/${test.id}`],
      ['PATCH', `/tests/${test.id}`],
      ['DELETE', `/tests/${test.id}`],
      ['PUT', `/tests/${test.id}/scores`],
      ['GET', `/batches/${maths.id}/tests`],
      ['GET', '/tests/not-a-uuid'],
    ] as const) {
      const body =
        method === 'PATCH'
          ? { name: 'x' }
          : method === 'PUT'
            ? { scores: [{ studentId: UNKNOWN, marks: 1 }] }
            : undefined;
      expect((await http.call(other.token, method, `${other.url}${path}`, body)).statusCode).toBe(
        404,
      );
    }
  });

  it('Starter and Free: 402 to create or enter marks; existing results stay readable', async () => {
    const { token, url, testUrl, maths, aarav, testApp, instituteId } = await setup();
    await http.call(token, 'PUT', `${testUrl}/scores`, {
      scores: [{ studentId: aarav.id, marks: 30 }],
    });

    for (const plan of ['starter', 'free'] as const) {
      testApp.subscriptionRepository.put({
        instituteId,
        plan,
        status: plan === 'free' ? 'free' : 'active',
        currentPeriodEnd: plan === 'free' ? null : new Date('2026-11-19T00:00:00Z'),
        graceUntil: null,
      });
      const created = await http.call(token, 'POST', `${url}/batches/${maths.id}/tests`, {
        name: 'T',
        date: '2026-10-19',
        maxMarks: 5,
      });
      expect(created.statusCode).toBe(402);
      expect(created.json().error).toMatchObject({
        code: 'FEATURE_NOT_IN_PLAN',
        details: { feature: 'result_cards' },
      });
      const scores = await http.call(token, 'PUT', `${testUrl}/scores`, {
        scores: [{ studentId: aarav.id, marks: 31 }],
      });
      expect(scores.statusCode).toBe(402);
      expect((await http.call(token, 'GET', testUrl)).json().stats.highest).toBe(30);
    }
  });
});

describe('tests: send results', () => {
  /** Aarav 40, Bhavya absent, Chirag 30 but then left the institute. */
  async function scored() {
    const ctx = await setup();
    await http.call(ctx.token, 'PUT', `${ctx.testUrl}/scores`, {
      scores: [
        { studentId: ctx.aarav.id, marks: 40 },
        { studentId: ctx.bhavya.id, isAbsent: true },
        { studentId: ctx.chirag.id, marks: 30 },
      ],
    });
    await http.call(ctx.token, 'POST', `${ctx.url}/students/${ctx.chirag.id}/leave`, {});
    const send = (who = ctx.token) => http.call(who, 'POST', `${ctx.testUrl}/send-results`);
    return { ...ctx, send };
  }

  it('queues one result card per student with marks; absent and left students are skipped', async () => {
    const { send, testApp, instituteId, teacher, testUrl, token } = await scored();

    const response = await send(teacher);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      queued: 1,
      alreadySent: 0,
      skipped: 2,
      resultsSentAt: '2026-10-19T10:00:00.000Z',
    });
    const [card, ...rest] = await testApp.outboxRepository.listForInstitute(instituteId, {
      category: 'result',
      limit: 10,
    });
    expect(rest).toEqual([]);
    expect(card).toMatchObject({
      template: 'result_card',
      priority: 3,
      status: 'queued',
      params: {
        student: 'Aarav',
        test: 'Unit 3',
        institute: 'Sharma Classes',
        marks: '40',
        max: '50',
      },
    });
    expect(card?.to.toE164()).toBe('+919812345678');
    expect((await http.call(token, 'GET', testUrl)).json().test.resultsSentAt).toBe(
      '2026-10-19T10:00:00.000Z',
    );
  });

  it('a student with their own number: a copy goes there, but counts as ONE card (KB #50)', async () => {
    const { send, testApp, instituteId, token, url, aarav } = await scored();
    await http.call(token, 'PATCH', `${url}/students/${aarav.id}`, { studentPhone: '9000000011' });

    expect((await send()).json()).toMatchObject({ queued: 1, alreadySent: 0 });
    const cards = await testApp.outboxRepository.listForInstitute(instituteId, {
      category: 'result',
      limit: 10,
    });
    expect(cards.map((c) => c.to.toE164()).sort()).toEqual(['+919000000011', '+919812345678']);
    expect((await send()).json()).toMatchObject({ queued: 0, alreadySent: 1 });
  });

  it('tapping again repeats nothing; a mark entered later is sent on the next tap', async () => {
    const { send, token, testUrl, bhavya } = await scored();
    await send();

    expect((await send()).json()).toMatchObject({ queued: 0, alreadySent: 1 });

    await http.call(token, 'PUT', `${testUrl}/scores`, {
      scores: [{ studentId: bhavya.id, marks: 25 }],
    });
    expect((await send()).json()).toMatchObject({ queued: 1, alreadySent: 1, skipped: 1 });
  });

  it('409 before any marks, or for a test in the future', async () => {
    const { token, url, createTest } = await setup();
    const fresh = (await (await createTest()).json()).test;
    const noMarks = await http.call(token, 'POST', `${url}/tests/${fresh.id}/send-results`);
    expect(noMarks.statusCode).toBe(409);

    const future = (await (await createTest({ date: '2026-10-25' })).json()).test;
    const tooEarly = await http.call(token, 'POST', `${url}/tests/${future.id}/send-results`);
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json().error.details).toEqual({ date: '2026-10-25' });
  });

  it('staff 403; Starter 402; unknown test 404', async () => {
    const { send, staff, testApp, instituteId, token, url } = await scored();
    expect((await send(staff)).statusCode).toBe(403);
    expect(
      (await http.call(token, 'POST', `${url}/tests/${UNKNOWN}/send-results`)).statusCode,
    ).toBe(404);
    testApp.subscriptionRepository.put({
      instituteId,
      plan: 'starter',
      status: 'active',
      currentPeriodEnd: new Date('2026-11-19T00:00:00Z'),
      graceUntil: null,
    });
    expect((await send()).statusCode).toBe(402);
  });

  it('at send time the worker uses the CURRENT marks, and skips a deleted test', async () => {
    const { send, token, testUrl, aarav, testApp, instituteId } = await scored();
    await send();
    const [card] = await testApp.outboxRepository.listForInstitute(instituteId, {
      category: 'result',
      limit: 1,
    });
    if (!card) throw new Error('no card queued');
    const revalidator = new ResultRevalidator(testApp.testService);

    await http.call(token, 'PUT', `${testUrl}/scores`, {
      scores: [{ studentId: aarav.id, marks: 45 }],
    });
    expect(await revalidator.check(card)).toMatchObject({ kind: 'send', params: { marks: '45' } });

    await http.call(token, 'DELETE', testUrl);
    expect(await revalidator.check(card)).toEqual({ kind: 'skip', reason: 'stale' });
  });
});
