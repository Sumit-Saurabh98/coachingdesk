import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OWNER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp, loginOverHttp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

/** Test clock: Monday 2026-10-19 15:30 IST (Pro trial). Aarav owes Rs 1500, due Oct 7. */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const post = async (path: string, payload: unknown) =>
    (await http.call(owner.token, 'POST', `${owner.url}${path}`, payload)).json();
  const { student } = await post('/students', { name: 'Aarav', guardianPhone: '9812345678' });
  const { invoice } = await post('/invoices', {
    studentId: student.id,
    amountPaise: 150000,
    dueDate: '2026-10-07',
    description: 'Oct fee',
  });
  const remind = (payload: unknown = {}, token = owner.token) =>
    http.call(token, 'POST', `${owner.url}/invoices/${invoice.id}/remind`, payload);
  return { ...owner, testApp, invoice, remind, post };
}

describe('POST /invoices/:invoiceId/remind', () => {
  it('202: queued now; the same day again -> 409 ALREADY_REMINDED_TODAY', async () => {
    const { remind } = await setup();

    const first = await remind();
    const again = await remind();

    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ scheduledFor: '2026-10-19T10:00:00.000Z' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_REMINDED_TODAY');
  });

  it("the student's own number gets it too, with its own one-a-day limit (KB #50)", async () => {
    const { remind, token, url, instituteId, testApp, invoice } = await setup();
    await http.call(token, 'PATCH', `${url}/students/${invoice.studentId}`, {
      studentPhone: '9000000011',
    });

    expect((await remind()).statusCode).toBe(202);
    const queued = await testApp.outboxRepository.listForInstitute(instituteId, { limit: 10 });
    expect(queued.map((m) => m.to.toE164()).sort()).toEqual(['+919000000011', '+919812345678']);
  });

  it("receipts: the paid-for student's own number gets a copy (KB #50)", async () => {
    const { token, url, instituteId, testApp, invoice } = await setup();
    await http.call(token, 'PATCH', `${url}/students/${invoice.studentId}`, {
      studentPhone: '9000000011',
    });
    await http.call(token, 'POST', `${url}/invoices/${invoice.id}/payments`, {
      amountPaise: 50000,
      method: 'cash',
    });

    const receipts = await testApp.outboxRepository.listForInstitute(instituteId, {
      category: 'receipt',
      limit: 10,
    });
    expect(receipts.map((m) => m.to.toE164()).sort()).toEqual(['+919000000011', '+919812345678']);
  });

  it('force: the owner may send ONE extra a day; staff may not force', async () => {
    const { remind, instituteId } = await setup();
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');
    await remind();

    expect((await remind({ force: true }, staff)).statusCode).toBe(403);
    expect((await remind({ force: true })).statusCode).toBe(202);
    expect((await remind({ force: true })).statusCode).toBe(409);
  });

  it('during quiet hours: scheduled for 08:00 IST', async () => {
    const { remind, testApp } = await setup();
    testApp.clock.set(new Date('2026-10-19T17:00:00Z')); // 22:30 IST
    // 7 hours later the old access token has expired (15 min): log in again.
    const fresh = await loginOverHttp(app, OWNER_PHONE);
    expect((await remind({}, fresh.accessToken)).json()).toEqual({
      scheduledFor: '2026-10-20T02:30:00.000Z',
    });
  });

  it('409 NOTHING_DUE for a paid invoice; 402 on the Free plan', async () => {
    const { remind, url, token, invoice } = await setup();
    await http.call(token, 'POST', `${url}/invoices/${invoice.id}/payments`, {
      amountPaise: 150000,
      method: 'cash',
    });
    const paid = await remind();
    expect(paid.statusCode).toBe(409);
    expect(paid.json().error.code).toBe('NOTHING_DUE');

    const second = await setup();
    second.testApp.subscriptionRepository.put({
      instituteId: second.instituteId,
      plan: 'free',
      status: 'free',
      currentPeriodEnd: null,
      graceUntil: null,
    });
    const free = await second.remind();
    expect(free.statusCode).toBe(402);
    expect(free.json().error.code).toBe('FEATURE_NOT_IN_PLAN');
  });

  it('roles: staff can remind; a teacher gets 403', async () => {
    const { remind, instituteId } = await setup();
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    expect((await remind({}, teacher)).statusCode).toBe(403);
    expect((await remind({}, staff)).statusCode).toBe(202);
  });
});

describe('GET /messages/usage', () => {
  it('trial: Pro quota, 100 a day, 200 in total; nothing used yet', async () => {
    const { url, token } = await setup();
    const response = await http.call(token, 'GET', `${url}/messages/usage`);
    expect(response.json()).toEqual({
      month: '2026-10',
      used: 0,
      limit: 1500,
      todayUsed: 0,
      todayLimit: 100,
      trialTotalLimit: 200,
    });
  });
});
