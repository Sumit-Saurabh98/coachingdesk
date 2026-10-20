import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';
import type { OutboxMessage } from '../../messaging/outbox.repository';
import { parseReceiptDedupeKey } from '../../messaging/receipt-messages';
import { ReceiptRenderer } from '../../messaging/receipt-renderer';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

/** An institute with Aarav (guardian 98123 45678) and a Rs 1500 manual invoice due Oct 7. */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const post = async (path: string, payload: unknown) =>
    (await http.call(owner.token, 'POST', `${owner.url}${path}`, payload)).json();
  const { student } = await post('/students', { name: 'Aarav', guardianPhone: '9812345678' });
  const bill = async (rupees: number, dueDate = '2026-10-07') =>
    (
      await post('/invoices', {
        studentId: student.id,
        amountPaise: rupees * 100,
        dueDate,
        description: 'Fee',
      })
    ).invoice;
  const invoice = await bill(1500);
  const pay = (
    invoiceId: string,
    payload: Record<string, unknown>,
    options: { token?: string; key?: string } = {},
  ) =>
    app.inject({
      method: 'POST',
      url: `${owner.url}/invoices/${invoiceId}/payments`,
      headers: {
        authorization: `Bearer ${options.token ?? owner.token}`,
        ...(options.key ? { 'idempotency-key': options.key } : {}),
      },
      payload,
    });
  return { ...owner, testApp, student, invoice, bill, pay };
}

describe('POST /invoices/:invoiceId/payments', () => {
  it('201: part payment -> partially_paid, with the guardian phone and no credit', async () => {
    const { invoice, pay } = await setup();

    const response = await pay(invoice.id, {
      amountPaise: 50000,
      method: 'cash',
      note: 'At center',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      payment: {
        amountPaise: 50000,
        method: 'cash',
        status: 'active',
        guardianPhone: '+919812345678',
        note: 'At center',
      },
      invoice: { status: 'partially_paid', paidPaise: 50000, remainingPaise: 100000 },
      creditPaise: 0,
      replayed: false,
    });
  });

  it('paying more than is left: paid, and the extra is reported as credit', async () => {
    const { invoice, pay } = await setup();
    const response = await pay(invoice.id, { amountPaise: 200000, method: 'bank' });
    expect(response.json()).toMatchObject({ invoice: { status: 'paid' }, creditPaise: 50000 });
  });

  it('Idempotency-Key: a retried tap returns the same payment (200), money recorded once', async () => {
    const { url, token, invoice, pay } = await setup();
    const first = await pay(invoice.id, { amountPaise: 50000, method: 'cash' }, { key: 'tap-123' });
    const retry = await pay(invoice.id, { amountPaise: 50000, method: 'cash' }, { key: 'tap-123' });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      replayed: true,
      payment: { id: first.json().payment.id },
    });
    const after = (await http.call(token, 'GET', `${url}/invoices/${invoice.id}`)).json();
    expect(after.invoice.paidPaise).toBe(50000);
  });

  it('409 on a paid invoice; 422 for a UPI method, a future date, a bad key', async () => {
    const { invoice, pay } = await setup();
    await pay(invoice.id, { amountPaise: 150000, method: 'cash' });

    expect((await pay(invoice.id, { amountPaise: 100, method: 'cash' })).statusCode).toBe(409);
    expect((await pay(invoice.id, { amountPaise: 100, method: 'upi_link' })).statusCode).toBe(422);
    expect(
      (await pay(invoice.id, { amountPaise: 100, method: 'cash', paidAt: '2030-01-01T00:00:00Z' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await pay(invoice.id, { amountPaise: 100, method: 'cash' }, { key: 'x'.repeat(101) }))
        .statusCode,
    ).toBe(422);
  });

  it('roles: staff can record; a teacher gets 403; another institute 404', async () => {
    const { instituteId, invoice, pay } = await setup();
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    const ravi = await http.ownerWithInstitute(OTHER_PHONE);

    expect(
      (await pay(invoice.id, { amountPaise: 100, method: 'cash' }, { token: staff })).statusCode,
    ).toBe(201);
    expect(
      (await pay(invoice.id, { amountPaise: 100, method: 'cash' }, { token: teacher })).statusCode,
    ).toBe(403);
    const cross = await http.call(
      ravi.token,
      'POST',
      `${ravi.url}/invoices/${invoice.id}/payments`,
      {
        amountPaise: 100,
        method: 'cash',
      },
    );
    expect(cross.statusCode).toBe(404);
  });
});

describe('void, lists and invoice details', () => {
  it('owner voids: the invoice reopens; staff cannot void; a second void is 409', async () => {
    const { url, token, instituteId, invoice, pay } = await setup();
    const { payment } = (await pay(invoice.id, { amountPaise: 150000, method: 'cash' })).json();
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');
    const voidUrl = `${url}/payments/${payment.id}/void`;

    expect((await http.call(staff, 'POST', voidUrl, { reason: 'x' })).statusCode).toBe(403);
    const voided = await http.call(token, 'POST', voidUrl, { reason: 'Entered twice' });
    expect(voided.json()).toMatchObject({
      payment: { status: 'voided', voidReason: 'Entered twice' },
      invoices: [{ id: invoice.id, status: 'due', paidPaise: 0 }],
    });
    expect((await http.call(token, 'POST', voidUrl, { reason: 'again' })).statusCode).toBe(409);
  });

  it('GET invoice shows its payments; GET payment shows allocation and credit', async () => {
    const { url, token, invoice, pay } = await setup();
    const { payment } = (await pay(invoice.id, { amountPaise: 200000, method: 'cash' })).json();

    const details = (await http.call(token, 'GET', `${url}/invoices/${invoice.id}`)).json();
    const single = (await http.call(token, 'GET', `${url}/payments/${payment.id}`)).json();

    expect(details.payments).toEqual([
      expect.objectContaining({ id: payment.id, amountPaise: 200000, allocatedPaise: 150000 }),
    ]);
    expect(single).toMatchObject({
      allocations: [{ invoiceId: invoice.id, amountPaise: 150000 }],
      creditPaise: 50000,
    });
  });

  it('GET /payments filters by method and status', async () => {
    const { url, token, invoice, pay } = await setup();
    await pay(invoice.id, { amountPaise: 10000, method: 'cash' });
    const { payment } = (await pay(invoice.id, { amountPaise: 20000, method: 'bank' })).json();
    await http.call(token, 'POST', `${url}/payments/${payment.id}/void`, { reason: 'Wrong' });

    const count = async (query: string) =>
      (await http.call(token, 'GET', `${url}/payments?${query}`)).json().payments.length;

    expect(await count('')).toBe(1); // active only
    expect(await count('status=voided')).toBe(1);
    expect(await count('method=bank')).toBe(0);
    expect(await count('from=2026-10-19&to=2026-10-19')).toBe(1);
    expect((await http.call(token, 'GET', `${url}/payments?from=19-10-2026`)).statusCode).toBe(422);
  });
});

describe('GET /fees/dashboard', () => {
  it('collected this month by method, pending, overdue and the top overdue (masked phone)', async () => {
    const { url, token, invoice, bill, pay } = await setup();
    await bill(600, '2026-10-30'); // not overdue yet
    await pay(invoice.id, { amountPaise: 50000, method: 'cash' });

    const response = await http.call(token, 'GET', `${url}/fees/dashboard`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      month: '2026-10',
      collectedPaise: 50000,
      byMethod: { cash: 50000 },
      pendingPaise: 100000 + 60000,
      overdueCount: 1,
      topOverdue: [
        {
          studentId: expect.any(String),
          name: 'Aarav',
          guardianPhone: '+9198XXXXX678',
          overduePaise: 100000,
          daysOverdue: 12,
        },
      ],
    });
  });

  it('?month=2026-09: nothing collected then; 422 for a bad month; teacher 403', async () => {
    const { url, token, instituteId } = await setup();
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    expect(
      (await http.call(token, 'GET', `${url}/fees/dashboard?month=2026-09`)).json().collectedPaise,
    ).toBe(0);
    expect((await http.call(token, 'GET', `${url}/fees/dashboard?month=2026-9`)).statusCode).toBe(
      422,
    );
    expect((await http.call(teacher, 'GET', `${url}/fees/dashboard`)).statusCode).toBe(403);
  });
});

describe('GET /payments/:paymentId/receipt', () => {
  it('number, institute, what it paid (with the student) and the credit', async () => {
    const { token, url, invoice, pay } = await setup();
    const paid = (await pay(invoice.id, { amountPaise: 200000, method: 'cash' })).json().payment;

    const response = await http.call(token, 'GET', `${url}/payments/${paid.id}/receipt`);

    expect(response.statusCode).toBe(200);
    expect(response.json().receipt).toMatchObject({
      id: paid.id,
      receiptNumber: 'RCT-000001',
      amountPaise: 200000,
      method: 'cash',
      status: 'active',
      institute: { name: 'Sharma Classes', city: null },
      lines: [
        {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          description: 'Fee',
          studentName: 'Aarav',
          amountPaise: 150000,
        },
      ],
      creditPaise: 50000,
    });
  });

  it('a voided payment still has its receipt, marked voided', async () => {
    const { token, url, invoice, pay } = await setup();
    const paid = (await pay(invoice.id, { amountPaise: 50000, method: 'cash' })).json().payment;
    await http.call(token, 'POST', `${url}/payments/${paid.id}/void`, { reason: 'Wrong student' });

    const receipt = (await http.call(token, 'GET', `${url}/payments/${paid.id}/receipt`)).json()
      .receipt;
    expect(receipt).toMatchObject({ status: 'voided', voidReason: 'Wrong student' });
  });

  it('teacher 403; another institute 404', async () => {
    const { url, invoice, pay, instituteId } = await setup();
    const paid = (await pay(invoice.id, { amountPaise: 50000, method: 'cash' })).json().payment;
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    expect((await http.call(teacher, 'GET', `${url}/payments/${paid.id}/receipt`)).statusCode).toBe(
      403,
    );
    const other = await http.ownerWithInstitute(OTHER_PHONE);
    expect(
      (await http.call(other.token, 'GET', `${other.url}/payments/${paid.id}/receipt`)).statusCode,
    ).toBe(404);
  });
});

describe('payment receipts on WhatsApp', () => {
  it('recording a payment queues ONE receipt (a replay adds none); rendered at send time', async () => {
    const { invoice, pay, testApp, instituteId } = await setup();
    const first = (
      await pay(invoice.id, { amountPaise: 200000, method: 'cash' }, { key: 'k1' })
    ).json().payment;
    await pay(invoice.id, { amountPaise: 200000, method: 'cash' }, { key: 'k1' }); // replay

    const queued = await testApp.outboxRepository.listForInstitute(instituteId, {
      category: 'receipt',
      limit: 10,
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      template: 'payment_receipt',
      priority: 1,
      status: 'queued',
      dedupeKey: `receipt:${first.id}`,
      params: {},
    });
    expect(queued[0]?.to.toE164()).toBe('+919812345678');

    const renderer = new ReceiptRenderer(testApp.paymentService);
    expect(await renderer.check(queued[0]!)).toEqual({
      kind: 'send',
      params: { amount: '2,000', students: 'Aarav', institute: 'Sharma Classes' },
    });
  });

  it('a payment voided before the worker sends it: skipped (stale)', async () => {
    const { token, url, invoice, pay, testApp, instituteId } = await setup();
    const paid = (await pay(invoice.id, { amountPaise: 50000, method: 'cash' })).json().payment;
    await http.call(token, 'POST', `${url}/payments/${paid.id}/void`, { reason: 'Typo' });

    const [queued] = await testApp.outboxRepository.listForInstitute(instituteId, {
      category: 'receipt',
      limit: 1,
    });
    expect(await new ReceiptRenderer(testApp.paymentService).check(queued!)).toEqual({
      kind: 'skip',
      reason: 'stale',
    });
  });

  it('Free plan: no receipt is queued (shared by hand from the app)', async () => {
    const { invoice, pay, testApp, instituteId } = await setup();
    testApp.subscriptionRepository.put({
      instituteId,
      plan: 'free',
      status: 'free',
      currentPeriodEnd: null,
      graceUntil: null,
    });
    expect((await pay(invoice.id, { amountPaise: 50000, method: 'cash' })).statusCode).toBe(201);
    expect(
      await testApp.outboxRepository.listForInstitute(instituteId, {
        category: 'receipt',
        limit: 5,
      }),
    ).toEqual([]);
  });

  it('a malformed key is stale (never guess the payment)', async () => {
    const { testApp } = await setup();
    const renderer = new ReceiptRenderer(testApp.paymentService);
    expect(parseReceiptDedupeKey('receipt:a:b')).toBeNull();
    expect(
      await renderer.check({ dedupeKey: 'receipt:', instituteId: 'x' } as unknown as OutboxMessage),
    ).toEqual({ kind: 'skip', reason: 'stale' });
  });
});

describe('guardian credit', () => {
  it('shows on the student for owner/staff (not teachers), and is applied to another due', async () => {
    const { token, url, invoice, pay, bill, student, instituteId } = await setup();
    await pay(invoice.id, { amountPaise: 200000, method: 'cash' }); // Rs 500 over
    const teacher = await http.memberWithRole(instituteId, 'teacher');

    const asOwner = (await http.call(token, 'GET', `${url}/students/${student.id}`)).json();
    expect(asOwner.guardianCreditPaise).toBe(50000);
    const asTeacher = (await http.call(teacher, 'GET', `${url}/students/${student.id}`)).json();
    expect(asTeacher).not.toHaveProperty('guardianCreditPaise');

    const next = await bill(300, '2026-11-07');
    const applied = await http.call(token, 'POST', `${url}/invoices/${next.id}/apply-credit`);

    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({
      appliedPaise: 30000,
      creditPaise: 20000,
      invoice: { id: next.id, status: 'paid' },
    });
    expect(
      (await http.call(token, 'GET', `${url}/students/${student.id}`)).json().guardianCreditPaise,
    ).toBe(20000);
    const [entry] = (await http.call(token, 'GET', `${url}/audit-log`)).json().entries;
    expect(entry).toMatchObject({
      action: 'credit.apply',
      entityId: next.id,
      after: { appliedPaise: 30000, status: 'paid', creditLeftPaise: 20000 },
    });
    expect(
      (await http.call(teacher, 'POST', `${url}/invoices/${next.id}/apply-credit`)).statusCode,
    ).toBe(403);
  });

  it('409 with no credit or for a paid invoice; 404 for another institute', async () => {
    const { token, url, invoice } = await setup();
    const none = await http.call(token, 'POST', `${url}/invoices/${invoice.id}/apply-credit`);
    expect(none.statusCode).toBe(409);
    expect(none.json().error.message).toBe('This guardian has no credit to apply');
    const other = await http.ownerWithInstitute(OTHER_PHONE);
    expect(
      (await http.call(other.token, 'POST', `${other.url}/invoices/${invoice.id}/apply-credit`))
        .statusCode,
    ).toBe(404);
  });
});
