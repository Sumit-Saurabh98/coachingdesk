import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { SubscriptionsController } from './subscriptions.controller';

export interface SubscriptionRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

export function registerSubscriptionRoutes(
  app: FastifyInstance,
  controller: SubscriptionsController,
  { requireAuth, requireMember }: SubscriptionRouteGuards,
): void {
  app.get('/v1/plans', (req, reply) => controller.plans(req, reply)); // public
  app.get(
    '/v1/institutes/:instituteId/subscription',
    { preHandler: [requireAuth, requireMember, requireRole('owner')] }, // "plan": owner only
    (req, reply) => controller.get(req, reply),
  );
}
