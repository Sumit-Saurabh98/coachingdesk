import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { ConsentController } from './consent.controller';

export interface MessagingRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

const GUARDIAN = '/v1/institutes/:instituteId/guardians/:phone';

export function registerMessagingRoutes(
  app: FastifyInstance,
  consent: ConsentController,
  { requireAuth, requireMember }: MessagingRouteGuards,
): void {
  // Consent is recorded by whoever manages students: owner and staff.
  const write = [requireAuth, requireMember, requireRole('owner', 'staff')];
  app.post(`${GUARDIAN}/opt-in`, { preHandler: write }, (req, reply) => consent.optIn(req, reply));
  app.post(`${GUARDIAN}/opt-out`, { preHandler: write }, (req, reply) =>
    consent.optOut(req, reply),
  );
}
