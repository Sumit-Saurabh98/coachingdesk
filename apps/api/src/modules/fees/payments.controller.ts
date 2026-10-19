import {
  AppError,
  FeeDashboardQuery,
  ListPaymentsQuery,
  RecordPaymentBody,
  VoidPaymentBody,
} from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { PaymentService } from './payment.service';

/**
 * AGENTS rule 6: the app sends a fresh random Idempotency-Key per "Record payment" tap and
 * re-sends the SAME key when it retries (timeout, double tap). Optional, 1-100 chars.
 */
function idempotencyKeyOf(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 100) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key must be 1 to 100 characters', {
      field: 'Idempotency-Key',
    });
  }
  return raw;
}

/** Payments and the fee dashboard: owner + staff (void: owner only). Teachers: never. */
export class PaymentsController {
  constructor(private readonly payments: PaymentService) {}

  /**
   * POST .../invoices/:invoiceId/payments -> 201 { payment, invoice, creditPaise }
   * A replay (same Idempotency-Key) -> 200 with the first payment and `replayed: true`.
   */
  async record(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = RecordPaymentBody.parse(request.body);
    const result = await this.payments.recordOffline(
      currentTenant(request).instituteId,
      currentUserId(request),
      uuidParam(request, 'invoiceId', 'Invoice not found'),
      body,
      idempotencyKeyOf(request),
    );
    await reply.status(result.replayed ? 200 : 201).send({
      payment: result.payment.toPublicJSON(),
      invoice: result.invoice?.toPublicJSON() ?? null,
      creditPaise: result.credit?.toPaise() ?? null,
      replayed: result.replayed,
    });
  }

  /** POST .../payments/:paymentId/void { reason } (owner) -> 200 { payment, invoices } */
  async void(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { reason } = VoidPaymentBody.parse(request.body);
    const result = await this.payments.void(
      currentTenant(request).instituteId,
      currentUserId(request),
      uuidParam(request, 'paymentId', 'Payment not found'),
      reason,
    );
    await reply.status(200).send({
      payment: result.payment.toPublicJSON(),
      invoices: result.invoices.map((i) => i.toPublicJSON()),
    });
  }

  /** GET .../payments?from&to&method&status&limit -> 200 { payments } (newest first) */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = ListPaymentsQuery.parse(request.query);
    const payments = await this.payments.list(currentTenant(request).instituteId, query);
    await reply.status(200).send({ payments: payments.map((p) => p.toPublicJSON()) });
  }

  /** GET .../payments/:paymentId -> 200 { payment, allocations, creditPaise } */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { payment, allocations } = await this.payments.get(
      currentTenant(request).instituteId,
      uuidParam(request, 'paymentId', 'Payment not found'),
    );
    const allocated = allocations.reduce((sum, a) => sum + a.amount.toPaise(), 0);
    await reply.status(200).send({
      payment: payment.toPublicJSON(),
      allocations: allocations.map((a) => ({
        invoiceId: a.invoiceId,
        amountPaise: a.amount.toPaise(),
      })),
      creditPaise: payment.amount.toPaise() - allocated,
    });
  }

  /** GET .../fees/dashboard?month=YYYY-MM -> 200 (FR-4.7; API_DOCS §8 shape) */
  async dashboard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { month } = FeeDashboardQuery.parse(request.query);
    const d = await this.payments.dashboard(currentTenant(request).instituteId, month);
    await reply.status(200).send({
      month: d.month,
      collectedPaise: d.collected.total.toPaise(),
      byMethod: Object.fromEntries(
        Object.entries(d.collected.byMethod).map(([method, amount]) => [method, amount.toPaise()]),
      ),
      pendingPaise: d.pending.toPaise(),
      overdueCount: d.overdueCount,
      topOverdue: d.topOverdue.map((row) => ({
        studentId: row.studentId,
        name: row.name,
        guardianPhone: row.guardianPhone,
        overduePaise: row.overdue.toPaise(),
        daysOverdue: row.daysOverdue,
      })),
    });
  }
}
