import { CloseInvoiceBody, CreateManualInvoiceBody, ListInvoicesQuery } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { InvoiceService } from './invoice.service';
import type { PaymentService } from './payment.service';

const invoiceIdOf = (request: FastifyRequest) =>
  uuidParam(request, 'invoiceId', 'Invoice not found');

/** Fees: owner and staff only (teachers never see fees, FR-1.4). */
export class InvoicesController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
  ) {}

  /** GET .../invoices?status&studentId&batchId&overdue&limit -> 200 { invoices } */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = ListInvoicesQuery.parse(request.query);
    const invoices = await this.invoices.list(currentTenant(request).instituteId, {
      statuses: query.status,
      studentId: query.studentId,
      batchId: query.batchId,
      overdue: query.overdue,
      limit: query.limit,
    });
    await reply.status(200).send({ invoices: invoices.map((i) => i.toPublicJSON()) });
  }

  /** GET .../invoices/:invoiceId -> 200 { invoice, payments } (allocatedPaise = paid here) */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { instituteId } = currentTenant(request);
    const invoice = await this.invoices.get(instituteId, invoiceIdOf(request));
    const payments = await this.payments.forInvoice(instituteId, invoice.id);
    await reply.status(200).send({
      invoice: invoice.toPublicJSON(),
      payments: payments.map(({ payment, amount }) => ({
        ...payment.toPublicJSON(),
        allocatedPaise: amount.toPaise(),
      })),
    });
  }

  /** POST .../invoices (owner) -> 201 { invoice } */
  async createManual(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = CreateManualInvoiceBody.parse(request.body);
    const invoice = await this.invoices.createManual(currentTenant(request).instituteId, body);
    await reply.status(201).send({ invoice: invoice.toPublicJSON() });
  }

  /** POST .../invoices/:invoiceId/waive { reason } (owner) -> 200 { invoice } */
  async waive(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { reason } = CloseInvoiceBody.parse(request.body);
    const invoice = await this.invoices.waive(
      currentTenant(request).instituteId,
      invoiceIdOf(request),
      reason,
    );
    await reply.status(200).send({ invoice: invoice.toPublicJSON() });
  }

  /** POST .../invoices/:invoiceId/cancel { reason } (owner) -> 200 { invoice } */
  async cancel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { reason } = CloseInvoiceBody.parse(request.body);
    const invoice = await this.invoices.cancel(
      currentTenant(request).instituteId,
      invoiceIdOf(request),
      reason,
    );
    await reply.status(200).send({ invoice: invoice.toPublicJSON() });
  }
}
