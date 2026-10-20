import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LocalDate } from '@coachingdesk/shared';
import { tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

/**
 * 27 active students on the Pro trial, then a downgrade to Free (25 students):
 * Aarav (joined Aug, in Maths) + 24 others (Sep) keep working; Yash (Oct 5) and Zoya
 * (Oct 10, in Maths) are the newest, so they become read-only.
 */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const post = async (path: string, payload: unknown) =>
    (await http.call(owner.token, 'POST', `${owner.url}${path}`, payload)).json();
  const maths = (
    await post('/batches', {
      name: 'Maths',
      schedule: { days: [1], start: '17:00', end: '18:00' },
      defaultFeePaise: 100000,
    })
  ).batch;
  const add = async (name: string, joinedOn: string, batchIds: string[] = []) =>
    (await post('/students', { name, guardianPhone: '9812345678', joinedOn, batchIds })).student;
  const aarav = await add('Aarav', '2026-08-01', [maths.id]);
  await post('/students/bulk', {
    joinedOn: '2026-09-01',
    rows: Array.from({ length: 24 }, (_, i) => ({
      name: `Student ${i + 1}`,
      guardianPhone: '9812345678',
    })),
  });
  const yash = await add('Yash', '2026-10-05');
  const zoya = await add('Zoya', '2026-10-10', [maths.id]);
  const setPlan = (plan: 'free' | 'starter') =>
    testApp.subscriptionRepository.put({
      instituteId: owner.instituteId,
      plan,
      status: plan === 'free' ? 'free' : 'active',
      currentPeriodEnd: plan === 'free' ? null : new Date('2026-11-19T00:00:00Z'),
      graceUntil: null,
    });
  setPlan('free');
  const readOnlyNames = async () =>
    (await http.call(owner.token, 'GET', `${owner.url}/students?limit=100`))
      .json()
      .students.filter((s: { readOnly: boolean }) => s.readOnly)
      .map((s: { name: string }) => s.name);
  return { ...owner, testApp, maths, aarav, yash, zoya, setPlan, readOnlyNames };
}

describe('read-only students after a downgrade (KB "Downgrade")', () => {
  it('the newest students beyond the limit are read-only; the app sees the flag', async () => {
    const { token, url, zoya, readOnlyNames } = await setup();
    expect(await readOnlyNames()).toEqual(['Yash', 'Zoya']);
    expect(
      (await http.call(token, 'GET', `${url}/students/${zoya.id}`)).json().student.readOnly,
    ).toBe(true);
  });

  it('editing or enrolling a read-only student: 402 read_only; the others still work', async () => {
    const { token, url, zoya, yash, aarav, maths } = await setup();

    const edit = await http.call(token, 'PATCH', `${url}/students/${zoya.id}`, { notes: 'x' });
    expect(edit.statusCode).toBe(402);
    expect(edit.json().error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { reason: 'read_only', studentIds: [zoya.id], limit: 25 },
    });
    expect(
      (
        await http.call(token, 'POST', `${url}/enrollments`, {
          studentId: yash.id,
          batchId: maths.id,
        })
      ).statusCode,
    ).toBe(402);
    expect(
      (await http.call(token, 'PATCH', `${url}/students/${aarav.id}`, { notes: 'ok' })).statusCode,
    ).toBe(200);
  });

  it("attendance: read-only students' marks are skipped (not the whole sync); only them -> 402", async () => {
    const { token, url, maths, aarav, zoya } = await setup();
    const sync = (clientId: string, records: unknown) =>
      http.call(token, 'PUT', `${url}/attendance-sessions/${clientId}`, {
        batchId: maths.id,
        date: '2026-10-19',
        records,
      });

    const mixed = await sync('00000000-0000-7000-8000-00000000c001', [
      { studentId: aarav.id, status: 'absent' },
      { studentId: zoya.id, status: 'present' },
    ]);
    expect(mixed.statusCode).toBe(200);
    expect(mixed.json()).toMatchObject({
      records: [{ studentId: aarav.id, status: 'absent' }],
      skippedReadOnly: [zoya.id],
    });

    const onlyReadOnly = await sync('00000000-0000-7000-8000-00000000c002', [
      { studentId: zoya.id, status: 'present' },
    ]);
    expect(onlyReadOnly.statusCode).toBe(402);
  });

  it('no new invoices for read-only students', async () => {
    const { testApp, instituteId, aarav, zoya } = await setup();
    await testApp.invoiceGenerator.generate(instituteId, LocalDate.parse('2026-10-01'));
    const invoices = await testApp.invoiceRepository.list(instituteId, { limit: 100 });
    const billed = invoices.map((invoice) => invoice.studentId);
    expect(billed).toContain(aarav.id);
    expect(billed).not.toContain(zoya.id);
  });

  it('a student leaving frees a place; an upgrade frees everyone', async () => {
    const { token, url, aarav, setPlan, readOnlyNames } = await setup();
    await http.call(token, 'POST', `${url}/students/${aarav.id}/leave`, {});
    expect(await readOnlyNames()).toEqual(['Zoya']);
    setPlan('starter');
    expect(await readOnlyNames()).toEqual([]);
  });
});
