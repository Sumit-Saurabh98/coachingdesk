import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { InvoicesController } from './invoices.controller';
import type { PaymentsController } from './payments.controller';

export interface FeeRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

const INVOICES = '/v1/institutes/:instituteId/invoices';

export function registerFeeRoutes(
  app: FastifyInstance,
  invoices: InvoicesController,
  payments: PaymentsController,
  { requireAuth, requireMember }: FeeRouteGuards,
): void {
  // API_DOCS roles: owner + staff READ fees; creating manual invoices, waiving and cancelling
  // are owner only. Teachers: no access to fees at all (FR-1.4).
  const read = [requireAuth, requireMember, requireRole('owner', 'staff')];
  const owner = [requireAuth, requireMember, requireRole('owner')];

  app.get(INVOICES, { preHandler: read }, (req, reply) => invoices.list(req, reply));
  app.get(`${INVOICES}/:invoiceId`, { preHandler: read }, (req, reply) => invoices.get(req, reply));
  app.post(INVOICES, { preHandler: owner }, (req, reply) => invoices.createManual(req, reply));
  app.post(`${INVOICES}/:invoiceId/waive`, { preHandler: owner }, (req, reply) =>
    invoices.waive(req, reply),
  );
  app.post(`${INVOICES}/:invoiceId/cancel`, { preHandler: owner }, (req, reply) =>
    invoices.cancel(req, reply),
  );

  // Payments: staff records offline payments; voiding is owner only (API_DOCS roles).
  const PAYMENTS = '/v1/institutes/:instituteId/payments';
  app.post(`${INVOICES}/:invoiceId/payments`, { preHandler: read }, (req, reply) =>
    payments.record(req, reply),
  );
  app.get(PAYMENTS, { preHandler: read }, (req, reply) => payments.list(req, reply));
  app.get(`${PAYMENTS}/:paymentId`, { preHandler: read }, (req, reply) => payments.get(req, reply));
  app.post(`${PAYMENTS}/:paymentId/void`, { preHandler: owner }, (req, reply) =>
    payments.void(req, reply),
  );
  app.get('/v1/institutes/:instituteId/fees/dashboard', { preHandler: read }, (req, reply) =>
    payments.dashboard(req, reply),
  );
}
