import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

/** Maths: Aarav + Bhavya (siblings, same guardian) + Chirag. Science: Bhavya. Pro trial. */
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
  const add = (name: string, phone: string, batchIds: string[]) =>
    post('/students', { name, guardianPhone: phone, joinedOn: '2026-10-01', batchIds });
  await add('Aarav', '9812345678', [maths.id]);
  await add('Bhavya', '9812345678', [maths.id, science.id]);
  await add('Chirag', '9123456789', [maths.id]);
  const teacher = await http.memberWithRole(owner.instituteId, 'teacher');
  const notices = `${owner.url}/notices`;
  return { ...owner, testApp, maths, science, teacher, notices };
}

describe('notices', () => {
  it("preview counts a student's own number too (consent is checked when sending)", async () => {
    const { token, notices, maths, url } = await setup();
    await http.call(token, 'POST', `${url}/students`, {
      name: 'Dev',
      guardianPhone: '9000000022',
      studentPhone: '9000000033',
      joinedOn: '2026-10-01',
      batchIds: [maths.id],
    });

    const response = await http.call(token, 'POST', `${notices}/preview`, {
      kind: 'general',
      batchIds: [maths.id],
      text: 'Exam on Monday',
    });
    // Neha (Aarav + Bhavya), Ravi (Chirag), Dev's parent, and Dev's own number.
    expect(response.json()).toMatchObject({ recipients: 4, messagesNeeded: 4 });
  });

  it('preview: one message per guardian (siblings share it), and the quota left', async () => {
    const { token, notices, maths, science } = await setup();

    const response = await http.call(token, 'POST', `${notices}/preview`, {
      kind: 'general',
      batchIds: [maths.id, science.id],
      text: 'Exam on Monday',
    });

    expect(response.json()).toEqual({ recipients: 2, messagesNeeded: 2, quotaRemaining: 100 });
  });

  it('a teacher sends a holiday notice: queued per guardian with the notice template', async () => {
    const { teacher, notices, maths, testApp, instituteId } = await setup();

    const response = await http.call(teacher, 'POST', notices, {
      kind: 'holiday',
      batchIds: [maths.id],
      date: '2026-10-24',
      resumeDate: '2026-10-27',
      reason: 'Diwali',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      queued: 2,
      notice: { kind: 'holiday', recipients: 2 },
    });
    const queued = await testApp.outboxRepository.listForInstitute(instituteId, { limit: 10 });
    expect(queued.map((m) => m.template)).toEqual(['notice_holiday', 'notice_holiday']);
    expect(queued[0]?.params).toMatchObject({
      date: '24 Oct 2026',
      reason: 'Diwali',
      resume_date: '27 Oct 2026',
    });
  });

  it('daily limit: 2 during the trial, then 429 DAILY_LIMIT_REACHED', async () => {
    const { token, notices, maths } = await setup();
    const send = () =>
      http.call(token, 'POST', notices, { kind: 'general', batchIds: [maths.id], text: 'Hi' });
    expect((await send()).statusCode).toBe(201);
    expect((await send()).statusCode).toBe(201);
    const third = await send();
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
      details: { limit: 2 },
    });
  });

  it('422 for a link or a past date; 404 for an unknown batch; 402 on Free', async () => {
    const { token, notices, maths, instituteId, testApp } = await setup();
    const send = (body: unknown) => http.call(token, 'POST', notices, body);
    expect(
      (await send({ kind: 'general', batchIds: [maths.id], text: 'see www.x.com' })).statusCode,
    ).toBe(422);
    expect(
      (
        await send({
          kind: 'schedule_change',
          batchIds: [maths.id],
          date: '2026-10-01',
          time: '18:00',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await send({
          kind: 'general',
          batchIds: ['00000000-0000-7000-8000-00000000ffff'],
          text: 'Hi',
        })
      ).statusCode,
    ).toBe(404);
    testApp.subscriptionRepository.put({
      instituteId,
      plan: 'free',
      status: 'free',
      currentPeriodEnd: null,
      graceUntil: null,
    });
    expect((await send({ kind: 'general', batchIds: [maths.id], text: 'Hi' })).statusCode).toBe(
      402,
    );
  });

  it('GET /notices lists what was sent, newest first', async () => {
    const { token, notices, maths } = await setup();
    await http.call(token, 'POST', notices, {
      kind: 'general',
      batchIds: [maths.id],
      text: 'First',
    });
    await http.call(token, 'POST', notices, {
      kind: 'general',
      batchIds: [maths.id],
      text: 'Second',
    });

    const list = (await http.call(token, 'GET', notices)).json().notices;

    expect(list.map((n: { content: { text: string } }) => n.content.text)).toEqual([
      'Second',
      'First',
    ]);
  });
});
