import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { ExportsController } from './exports.controller';
import type { PrivacyController } from './privacy.controller';

export function registerPrivacyRoutes(
  app: FastifyInstance,
  controller: PrivacyController,
  exports: ExportsController,
  guards: { requireAuth: preHandlerAsyncHookHandler; requireMember: preHandlerAsyncHookHandler },
): void {
  app.post(
    '/v1/institutes/:instituteId/students/:studentId/erase',
    { preHandler: [guards.requireAuth, guards.requireMember, requireRole('owner')] },
    (req, reply) => controller.eraseStudent(req, reply),
  );

  // Institute deletion (FR-7.7): owner only, with a fresh OTP.
  const owner = [guards.requireAuth, guards.requireMember, requireRole('owner')];
  const INSTITUTE = '/v1/institutes/:instituteId';
  app.post(`${INSTITUTE}/delete/otp`, { preHandler: owner }, (req, reply) =>
    controller.sendDeletionCode(req, reply),
  );
  app.post(`${INSTITUTE}/delete`, { preHandler: owner }, (req, reply) =>
    controller.requestDeletion(req, reply),
  );
  // The one write the owner can always make while deletion is pending: undo it.
  app.post(
    `${INSTITUTE}/delete/cancel`,
    { preHandler: owner, config: { allowWhilePendingDeletion: true } },
    (req, reply) => controller.cancelDeletion(req, reply),
  );

  // Data export (FR-7.6): owner only, any plan. Allowed while deletion is pending: "take my
  // data with me" is exactly what an owner does before the purge.
  app.post(
    `${INSTITUTE}/exports`,
    { preHandler: owner, config: { allowWhilePendingDeletion: true } },
    (req, reply) => exports.request(req, reply),
  );
  app.get(`${INSTITUTE}/exports`, { preHandler: owner }, (req, reply) => exports.list(req, reply));
  app.get(`${INSTITUTE}/exports/:exportId`, { preHandler: owner }, (req, reply) =>
    exports.get(req, reply),
  );
  app.get(`${INSTITUTE}/exports/:exportId/download`, { preHandler: owner }, (req, reply) =>
    exports.download(req, reply),
  );
}
