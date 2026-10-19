import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { ConsentController } from './consent.controller';
import type { RemindersController } from './reminders.controller';

export interface MessagingRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

const GUARDIAN = '/v1/institutes/:instituteId/guardians/:phone';

export function registerMessagingRoutes(
  app: FastifyInstance,
  consent: ConsentController,
  reminders: RemindersController,
  { requireAuth, requireMember }: MessagingRouteGuards,
): void {
  // Consent is recorded by whoever manages students: owner and staff.
  const write = [requireAuth, requireMember, requireRole('owner', 'staff')];
  app.post(`${GUARDIAN}/opt-in`, { preHandler: write }, (req, reply) => consent.optIn(req, reply));
  app.post(`${GUARDIAN}/opt-out`, { preHandler: write }, (req, reply) =>
    consent.optOut(req, reply),
  );

  // Remind now: owner and staff (force: owner, checked in the controller). Usage: owner, staff.
  const feesTeam = [requireAuth, requireMember, requireRole('owner', 'staff')];
  app.post(
    '/v1/institutes/:instituteId/invoices/:invoiceId/remind',
    { preHandler: feesTeam },
    (req, reply) => reminders.remind(req, reply),
  );
  app.get('/v1/institutes/:instituteId/messages/usage', { preHandler: feesTeam }, (req, reply) =>
    reminders.usage(req, reply),
  );
}
