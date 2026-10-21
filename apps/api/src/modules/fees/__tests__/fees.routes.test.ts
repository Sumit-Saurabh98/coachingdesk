import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

/** Test clock: 2026-10-19 (institute billing day 1, due 7th). */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const post = async (path: string, payload: unknown) =>
    (await http.call(owner.token, 'POST', `${owner.url}${path}`, payload)).json();
  const batch = async (name: string, defaultFeeCycle = 'monthly', defaultFeePaise = 150000) =>
    (
      await post('/batches', {
        name,
        schedule: { days: [1], start: '17:00', end: '18:00' },
        defaultFeePaise,
        defaultFeeCycle,
      })
    ).batch;
  const student = async (name: string, batchIds: string[] = []) =>
    post('/students', { name, guardianPhone: '9812345678', joinedOn: '2026-10-01', batchIds });
  return { ...owner, testApp, post, batch, student };
}

describe('billing at enrollment', () => {
  it('a one_time batch fee is invoiced immediately when the student is added with it', async () => {
    const { batch, student } = await setup();
    const crash = await batch('Crash course', 'one_time', 500000);

    const created = await student('Aarav', [crash.id]);

    expect(created.invoices).toHaveLength(1);
    expect(created.invoices[0]).toMatchObject({
      kind: 'one_time',
      number: 'INV-000001',
      description: 'Crash course · One-time fee',
      netPaise: 500000,
      periodStart: '2026-10-01',
      dueDate: '2026-10-07',
    });
  });

  it('monthly: no invoice at enrollment; with billNow the current period is billed', async () => {
    const { post, batch, student } = await setup();
    const maths = await batch('Maths');
    const { student: aarav } = await student('Aarav');
    const { student: bhavya } = await student('Bhavya');

    const later = await post('/enrollments', { studentId: aarav.id, batchId: maths.id });
    const now = await post('/enrollments', {
      studentId: bhavya.id,
      batchId: maths.id,
      billNow: true,
    });

    expect(later.invoice).toBeNull();
    expect(now.invoice).toMatchObject({
      kind: 'cycle',
      description: 'Maths · Oct 2026',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
  });

  it('billNow for an enrollment starting after this period -> 422', async () => {
    const { token, url, batch, student } = await setup();
    const maths = await batch('Maths');
    const { student: aarav } = await student('Aarav');
    const response = await http.call(token, 'POST', `${url}/enrollments`, {
      studentId: aarav.id,
      batchId: maths.id,
      startDate: '2026-11-15',
      billNow: true,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.details).toEqual({ field: 'billNow' });
  });
});

describe('the billing run creates invoices (worker job, called directly here)', () => {
  it('generates the period for everyone enrolled; GET /invoices lists them', async () => {
    const { token, url, instituteId, testApp, batch, student } = await setup();
    const maths = await batch('Maths');
    await student('Aarav', [maths.id]);
    await student('Bhavya', [maths.id]);

    expect(await testApp.invoiceGenerator.runDue(instituteId)).toMatchObject({ created: 2 });

    const response = await http.call(token, 'GET', `${url}/invoices`);
    expect(response.statusCode).toBe(200);
    expect(response.json().invoices.map((i: { number: string }) => i.number)).toEqual([
      'INV-000001',
      'INV-000002',
    ]);
    // Names come with the list (an invoice stores only the student's id).
    expect(response.json().invoices.map((i: { studentName: string }) => i.studentName)).toEqual([
      'Aarav',
      'Bhavya',
    ]);
  });
});

describe('GET /invoices filters and roles', () => {
  async function withInvoices() {
    const ctx = await setup();
    const maths = await ctx.batch('Maths');
    const science = await ctx.batch('Science');
    const { student: aarav } = await ctx.student('Aarav', [maths.id]);
    await ctx.student('Bhavya', [science.id]);
    await ctx.testApp.invoiceGenerator.runDue(ctx.instituteId);
    return { ...ctx, maths, aarav };
  }

  it('by student, batch, status and overdue', async () => {
    const { token, url, maths, aarav, testApp } = await withInvoices();
    const get = async (query: string) =>
      (await http.call(token, 'GET', `${url}/invoices?${query}`)).json().invoices.length;

    expect(await get(`studentId=${aarav.id}`)).toBe(1);
    expect(await get(`batchId=${maths.id}`)).toBe(1);
    expect(await get('status=due,partially_paid')).toBe(2);
    expect(await get('status=paid')).toBe(0);
    expect(await get('overdue=true')).toBe(2); // today is the 19th, due the 7th
    testApp.clock.set(new Date('2026-10-05T06:00:00Z'));
    expect(await get('overdue=true')).toBe(0);
  });

  it('422 for a bad filter', async () => {
    const { token, url } = await setup();
    expect((await http.call(token, 'GET', `${url}/invoices?status=overdue`)).statusCode).toBe(422);
  });

  it('roles: staff can read fees; a teacher gets 403; a stranger 404', async () => {
    const { url, instituteId } = await withInvoices();
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    const stranger = await http.ownerWithInstitute(OTHER_PHONE);

    expect((await http.call(staff, 'GET', `${url}/invoices`)).statusCode).toBe(200);
    expect((await http.call(teacher, 'GET', `${url}/invoices`)).statusCode).toBe(403);
    expect((await http.call(stranger.token, 'GET', `${url}/invoices`)).statusCode).toBe(404);
  });

  it("TENANCY: another institute's invoice id is a 404", async () => {
    const { token, url } = await withInvoices();
    const [invoice] = (await http.call(token, 'GET', `${url}/invoices`)).json().invoices;
    const ravi = await http.ownerWithInstitute(OTHER_PHONE);

    const detail = await http.call(token, 'GET', `${url}/invoices/${invoice.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().invoice.studentName).toBe(invoice.studentName);
    expect(
      (await http.call(ravi.token, 'GET', `${ravi.url}/invoices/${invoice.id}`)).statusCode,
    ).toBe(404);
  });
});

describe('manual invoices, waive, cancel (owner only)', () => {
  it('owner creates a manual invoice; staff cannot', async () => {
    const { token, url, instituteId, student } = await setup();
    const { student: aarav } = await student('Aarav');
    const body = {
      studentId: aarav.id,
      amountPaise: 50000,
      dueDate: '2026-10-25',
      description: 'Exam fee',
    };
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');

    const created = await http.call(token, 'POST', `${url}/invoices`, body);

    expect(created.statusCode).toBe(201);
    expect(created.json().invoice).toMatchObject({
      kind: 'manual',
      description: 'Exam fee',
      netPaise: 50000,
      periodStart: null,
    });
    expect((await http.call(staff, 'POST', `${url}/invoices`, body)).statusCode).toBe(403);
  });

  it("manual invoice: 404 for another institute's student, 422 for discount >= amount", async () => {
    const { token, url, student } = await setup();
    const { student: aarav } = await student('Aarav');
    const ravi = await http.ownerWithInstitute(OTHER_PHONE);
    const body = {
      studentId: aarav.id,
      amountPaise: 50000,
      dueDate: '2026-10-25',
      description: 'X',
    };

    expect((await http.call(ravi.token, 'POST', `${ravi.url}/invoices`, body)).statusCode).toBe(
      404,
    );
    expect(
      (await http.call(token, 'POST', `${url}/invoices`, { ...body, discountPaise: 50000 }))
        .statusCode,
    ).toBe(422);
  });

  it('waive, then a second waive or a cancel is 409', async () => {
    const { token, url, student } = await setup();
    const { student: aarav } = await student('Aarav');
    const { invoice } = (
      await http.call(token, 'POST', `${url}/invoices`, {
        studentId: aarav.id,
        amountPaise: 50000,
        dueDate: '2026-10-25',
        description: 'Exam fee',
      })
    ).json();
    const action = (name: string) =>
      http.call(token, 'POST', `${url}/invoices/${invoice.id}/${name}`, { reason: 'Scholarship' });

    const waived = await action('waive');

    expect(waived.statusCode).toBe(200);
    expect(waived.json().invoice).toMatchObject({ status: 'waived', closeReason: 'Scholarship' });
    expect((await action('waive')).statusCode).toBe(409);
    expect((await action('cancel')).statusCode).toBe(409);
  });

  it('cancel an unpaid invoice; staff cannot; empty reason is 422', async () => {
    const { token, url, instituteId, student } = await setup();
    const { student: aarav } = await student('Aarav');
    const { invoice } = (
      await http.call(token, 'POST', `${url}/invoices`, {
        studentId: aarav.id,
        amountPaise: 50000,
        dueDate: '2026-10-25',
        description: 'Exam fee',
      })
    ).json();
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');
    const cancelUrl = `${url}/invoices/${invoice.id}/cancel`;

    expect((await http.call(staff, 'POST', cancelUrl, { reason: 'x' })).statusCode).toBe(403);
    expect((await http.call(token, 'POST', cancelUrl, { reason: '  ' })).statusCode).toBe(422);
    const cancelled = await http.call(token, 'POST', cancelUrl, { reason: 'Billed by mistake' });
    expect(cancelled.json().invoice.status).toBe('cancelled');
  });
});
