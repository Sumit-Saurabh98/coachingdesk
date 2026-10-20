import { describe, expect, it } from 'vitest';
import { LocalDate, Money, PhoneNumber } from '@coachingdesk/shared';
import type { InvoiceRepository } from '../invoice.repository';
import { type OfflineMethod, Payment } from '../payment';
import type { PaymentRepository } from '../payment.repository';
import { CONTRACT, cycleInvoice, manualInvoice } from './invoice-repository.contract';

const { instituteA, instituteB, s1, s2 } = CONTRACT;
/** A real user (Postgres: voided_by references users). The test files seed it as the owner. */
export const CONTRACT_USER = '00000000-0000-7000-8000-0000000060f1';
const day = (text: string) => LocalDate.parse(text);
const rupees = (n: number) => Money.ofPaise(n * 100);
let n = 0;

export const offlinePayment = (
  amountRupees: number,
  options: { key?: string; method?: OfflineMethod; paidAt?: string; instituteId?: string } = {},
) =>
  Payment.recordOffline(
    `00000000-0000-7000-8000-0000000065${String(++n % 100).padStart(2, '0')}`,
    options.instituteId ?? instituteA,
    {
      guardianPhone: PhoneNumber.parse('9812345678'),
      amountPaise: amountRupees * 100,
      method: options.method ?? 'cash',
      paidAt: new Date(options.paidAt ?? '2026-10-19T10:00:00Z'),
      recordedBy: null as unknown as string,
      idempotencyKey: options.key ?? null,
    },
    new Date('2026-10-20T00:00:00Z'),
  );

export interface PaymentFixture {
  payments: PaymentRepository;
  invoices: InvoiceRepository;
}

export function describePaymentRepositoryContract(
  name: string,
  create: () => PaymentFixture,
): void {
  describe(`PaymentRepository contract: ${name}`, () => {
    const withInvoice = async (fixture: PaymentFixture) =>
      (await fixture.invoices.create(cycleInvoice()))!; // Rs 1500, due Oct 7

    it('part payment -> partially_paid; the rest -> paid', async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);

      const first = await fixture.payments.recordForInvoice(offlinePayment(500), invoice.id);
      const second = await fixture.payments.recordForInvoice(offlinePayment(1000), invoice.id);

      expect(first).toMatchObject({ outcome: 'recorded', invoice: { status: 'partially_paid' } });
      expect(second).toMatchObject({ outcome: 'recorded', invoice: { status: 'paid' } });
      expect(
        (await fixture.invoices.findById(instituteA, invoice.id))?.toPublicJSON(),
      ).toMatchObject({
        paidPaise: 150000,
        remainingPaise: 0,
        status: 'paid',
      });
    });

    it('more than is due: the invoice is paid, the extra is guardian credit', async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);
      const result = await fixture.payments.recordForInvoice(offlinePayment(2000), invoice.id);
      if (result.outcome !== 'recorded') throw new Error(result.outcome);
      expect(result.allocated.toPaise()).toBe(150000);
      expect(result.credit.toPaise()).toBe(50000);
    });

    it('a closed invoice (paid / waived) takes no payment', async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);
      await fixture.invoices.saveStatus(invoice.waive('Scholarship'), 'due');

      expect(await fixture.payments.recordForInvoice(offlinePayment(100), invoice.id)).toEqual({
        outcome: 'invoice_closed',
        status: 'waived',
      });
    });

    it("TENANCY: another institute's invoice is not found", async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);
      expect(
        await fixture.payments.recordForInvoice(
          offlinePayment(100, { instituteId: instituteB }),
          invoice.id,
        ),
      ).toEqual({ outcome: 'invoice_not_found' });
    });

    it('the same Idempotency-Key twice: one payment, the second call replays it', async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);

      const first = await fixture.payments.recordForInvoice(
        offlinePayment(500, { key: 'tap-1' }),
        invoice.id,
      );
      const again = await fixture.payments.recordForInvoice(
        offlinePayment(500, { key: 'tap-1' }),
        invoice.id,
      );

      expect(again).toMatchObject({ outcome: 'replayed', invoice: { id: invoice.id } });
      if (first.outcome !== 'recorded' || again.outcome !== 'replayed')
        throw new Error('unexpected');
      expect(again.payment.id).toBe(first.payment.id);
      expect((await fixture.invoices.findById(instituteA, invoice.id))?.paid.toPaise()).toBe(50000);
    });

    it('receipt numbers: RCT-000001, 2, ... per institute; refused payments use none; a replay keeps its number', async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);
      const record = async (p: Payment, invoiceId = invoice.id) => {
        const result = await fixture.payments.recordForInvoice(p, invoiceId);
        return 'payment' in result ? result.payment.receiptNumber : result.outcome;
      };

      expect(await record(offlinePayment(100, { key: 'k1' }))).toBe('RCT-000001');
      expect(await record(offlinePayment(100, { key: 'k1' }))).toBe('RCT-000001'); // replay
      expect(await record(offlinePayment(100, { instituteId: instituteB }))).toBe(
        'invoice_not_found',
      );
      expect(await record(offlinePayment(1400))).toBe('RCT-000002'); // pays it in full
      expect(await record(offlinePayment(100))).toBe('invoice_closed');
      const next = (await fixture.invoices.create(manualInvoice(s2)))!;
      expect(await record(offlinePayment(100), next.id)).toBe('RCT-000003');
      const [latest] = await fixture.payments.listForInvoice(instituteA, next.id);
      const found = await fixture.payments.findById(instituteA, latest?.payment.id ?? '');
      expect(found?.payment.receiptNumber).toBe('RCT-000003');
    });

    describe('guardian credit', () => {
      const guardian = PhoneNumber.parse('9812345678');
      const credit = async (fixture: PaymentFixture) =>
        (await fixture.payments.creditForGuardian(instituteA, guardian)).toPaise();

      it('overpaying leaves credit; a voided payment has none', async () => {
        const fixture = create();
        const invoice = await withInvoice(fixture); // Rs 1500
        const result = await fixture.payments.recordForInvoice(offlinePayment(2000), invoice.id);
        expect(await credit(fixture)).toBe(50000);
        expect((await fixture.payments.creditForGuardian(instituteB, guardian)).toPaise()).toBe(0);
        expect(
          (
            await fixture.payments.creditForGuardian(instituteA, PhoneNumber.parse('9123456789'))
          ).toPaise(),
        ).toBe(0);

        if (result.outcome !== 'recorded') throw new Error(result.outcome);
        await fixture.payments.void(instituteA, result.payment.id, (p) =>
          p.void(CONTRACT_USER, 'x', new Date('2026-10-21T00:00:00Z')),
        );
        expect(await credit(fixture)).toBe(0);
      });

      it('apply: oldest payment first, up to what is due; the rest stays credit', async () => {
        const fixture = create();
        const invoice = await withInvoice(fixture); // Rs 1500
        await fixture.payments.recordForInvoice(
          offlinePayment(1600, { paidAt: '2026-10-01T10:00:00Z' }),
          invoice.id,
        ); // credit 100
        const second = (await fixture.invoices.create(manualInvoice(s1, '2026-10-20')))!; // Rs 500
        await fixture.payments.recordForInvoice(
          offlinePayment(900, { paidAt: '2026-10-02T10:00:00Z' }),
          second.id,
        ); // credit 400
        expect(await credit(fixture)).toBe(50000);
        const third = (await fixture.invoices.create(manualInvoice(s2, '2026-10-25')))!; // Rs 500, due

        const result = await fixture.payments.applyCredit(instituteA, guardian, third.id);

        expect(result).toMatchObject({ outcome: 'applied', invoice: { status: 'paid' } });
        if (result.outcome !== 'applied') throw new Error(result.outcome);
        expect([result.applied.toPaise(), result.creditLeft.toPaise()]).toEqual([50000, 0]);
        expect(await credit(fixture)).toBe(0);
        // Both payments now list the invoice: Rs 100 + Rs 400.
        const parts = await fixture.payments.listForInvoice(instituteA, third.id);
        expect(parts.map((p) => p.amount.toPaise()).sort((a, b) => a - b)).toEqual([10000, 40000]);
        expect(await fixture.payments.applyCredit(instituteA, guardian, third.id)).toEqual({
          outcome: 'no_credit',
        });
      });

      it('partly: credit smaller than the due -> partially_paid; closed or foreign invoices refused', async () => {
        const fixture = create();
        const invoice = await withInvoice(fixture);
        await fixture.payments.recordForInvoice(offlinePayment(1700), invoice.id); // credit 200
        const due = (await fixture.invoices.create(manualInvoice(s2)))!; // Rs 500

        expect(await fixture.payments.applyCredit(instituteA, guardian, invoice.id)).toEqual({
          outcome: 'invoice_closed',
          status: 'paid',
        });
        expect(await fixture.payments.applyCredit(instituteB, guardian, due.id)).toEqual({
          outcome: 'invoice_not_found',
        });
        const result = await fixture.payments.applyCredit(instituteA, guardian, due.id);
        expect(result).toMatchObject({ outcome: 'applied', invoice: { status: 'partially_paid' } });
        expect((await fixture.invoices.findById(instituteA, due.id))?.paid.toPaise()).toBe(20000);
      });
    });

    it('void: the payment stops counting and the invoice reopens', async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);
      const recorded = await fixture.payments.recordForInvoice(offlinePayment(1500), invoice.id);
      if (recorded.outcome !== 'recorded') throw new Error(recorded.outcome);

      const result = await fixture.payments.void(instituteA, recorded.payment.id, (p) =>
        p.void(CONTRACT_USER, 'Entered twice', new Date('2026-10-19T11:00:00Z')),
      );

      expect(result?.payment.status).toBe('voided');
      expect(result?.invoices.map((i) => [i.status, i.paid.toPaise()])).toEqual([['due', 0]]);
      const found = await fixture.payments.findById(instituteA, recorded.payment.id);
      expect(found?.payment.voidReason).toBe('Entered twice');
      expect(found?.allocations.map((a) => a.amount.toPaise())).toEqual([150000]); // kept for history
      expect(await fixture.payments.void(instituteB, recorded.payment.id, (p) => p)).toBeNull();
    });

    it('erasure: forgetGuardianPhone clears the phone, keeps the amount; only this institute', async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);
      const recorded = await fixture.payments.recordForInvoice(offlinePayment(500), invoice.id);
      if (recorded.outcome !== 'recorded') throw new Error(recorded.outcome);

      expect(
        await fixture.payments.forgetGuardianPhone(instituteB, PhoneNumber.parse('9812345678')),
      ).toBe(0);
      expect(
        await fixture.payments.forgetGuardianPhone(instituteA, PhoneNumber.parse('9812345678')),
      ).toBe(1);

      const found = await fixture.payments.findById(instituteA, recorded.payment.id);
      expect(found?.payment.guardianPhone).toBeNull();
      expect(found?.payment.amount.toPaise()).toBe(50000);
    });

    it('lists payments of an invoice, and payments by date / method / status', async () => {
      const fixture = create();
      const invoice = await withInvoice(fixture);
      await fixture.payments.recordForInvoice(
        offlinePayment(200, { paidAt: '2026-10-02T10:00:00Z' }),
        invoice.id,
      );
      await fixture.payments.recordForInvoice(
        offlinePayment(300, { paidAt: '2026-10-10T10:00:00Z', method: 'bank' }),
        invoice.id,
      );

      expect(
        (await fixture.payments.listForInvoice(instituteA, invoice.id)).map((r) =>
          r.amount.toPaise(),
        ),
      ).toEqual([30000, 20000]);
      const list = (q: Partial<Parameters<PaymentRepository['list']>[1]>) =>
        fixture.payments.list(instituteA, { status: 'active', limit: 50, ...q });
      expect((await list({})).length).toBe(2);
      expect((await list({ method: 'bank' })).length).toBe(1);
      expect((await list({ from: new Date('2026-10-05T00:00:00Z') })).length).toBe(1);
      expect((await list({ status: 'voided' })).length).toBe(0);
    });

    it('dashboard totals: collected by method; pending, overdue count and per-student overdue', async () => {
      const fixture = create();
      const aaravOct = (await fixture.invoices.create(
        cycleInvoice({ period: '2026-10-01', due: '2026-10-07' }),
      ))!;
      await fixture.invoices.create(cycleInvoice({ period: '2026-09-01', due: '2026-09-07' }));
      await fixture.invoices.create(manualInvoice(s2, '2026-10-30')); // not overdue yet
      await fixture.payments.recordForInvoice(offlinePayment(500), aaravOct.id);
      await fixture.payments.recordForInvoice(
        offlinePayment(100, { method: 'bank', paidAt: '2026-09-30T10:00:00Z' }),
        aaravOct.id,
      );

      const collected = await fixture.payments.collectedBetween(
        instituteA,
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-11-01T00:00:00Z'),
      );
      const open = await fixture.payments.openDueTotals(instituteA, day('2026-10-19'), 10);

      expect(collected.total.toPaise()).toBe(50000); // the September bank payment is outside
      expect(collected.byMethod.cash?.toPaise()).toBe(50000);
      expect(open.pending.toPaise()).toBe(150000 + 90000 + 50000);
      expect(open.overdueCount).toBe(2);
      expect(open.overdueByStudent).toEqual([
        { studentId: s1, overdue: rupees(2400), oldestDueDate: day('2026-09-07') },
      ]);
    });
  });
}
