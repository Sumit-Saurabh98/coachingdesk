import { CloseInvoiceBody, CreateManualInvoiceBody, ListInvoicesQuery } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { InvoiceService } from './invoice.service';
import type { PaymentService } from './payment.service';

const invoiceIdOf = (request: FastifyRequest) =>
  uuidParam(request, 'invoiceId', 'Invoice not found');

/** Fees: owner and staff only (teachers never see fees, FR-1.4). */
/** Names for the invoice lists: an invoice stores only the student's id. */
export interface InvoiceStudentNames {
  findByIds(
    instituteId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; name: string }>>;
}

export class InvoicesController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
    private readonly students: InvoiceStudentNames,
  ) {}

  /** GET .../invoices?status&studentId&batchId&overdue&limit -> 200 { invoices } */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = ListInvoicesQuery.parse(request.query);
    const { instituteId } = currentTenant(request);
    const invoices = await this.invoices.list(instituteId, {
      statuses: query.status,
      studentId: query.studentId,
      batchId: query.batchId,
      overdue: query.overdue,
      limit: query.limit,
    });
    const names = await this.namesOf(
      instituteId,
      invoices.map((i) => i.studentId),
    );
    // studentName: so the app can list invoices without loading every student first.
    await reply.status(200).send({
      invoices: invoices.map((i) => ({ ...i.toPublicJSON(), studentName: names.get(i.studentId) })),
    });
  }

  /** GET .../invoices/:invoiceId -> 200 { invoice, payments } (allocatedPaise = paid here) */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { instituteId } = currentTenant(request);
    const invoice = await this.invoices.get(instituteId, invoiceIdOf(request));
    const payments = await this.payments.forInvoice(instituteId, invoice.id);
    const names = await this.namesOf(instituteId, [invoice.studentId]);
    await reply.status(200).send({
      invoice: { ...invoice.toPublicJSON(), studentName: names.get(invoice.studentId) },
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
      currentUserId(request),
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
      currentUserId(request),
    );
    await reply.status(200).send({ invoice: invoice.toPublicJSON() });
  }

  /** id -> name for these students (any status: a student who left still has old invoices). */
  private async namesOf(instituteId: string, ids: string[]): Promise<Map<string, string>> {
    const students = await this.students.findByIds(instituteId, [...new Set(ids)]);
    return new Map(students.map((s) => [s.id, s.name]));
  }
}
