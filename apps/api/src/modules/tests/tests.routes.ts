import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { TestsController } from './tests.controller';

export interface TestRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

const INSTITUTE = '/v1/institutes/:instituteId';

export function registerTestRoutes(
  app: FastifyInstance,
  controller: TestsController,
  { requireAuth, requireMember }: TestRouteGuards,
): void {
  // API_DOCS roles: "Tests & marks — write: owner, teacher" (staff run the office, not classes).
  const member = [requireAuth, requireMember];
  const write = [requireAuth, requireMember, requireRole('owner', 'teacher')];

  app.get(`${INSTITUTE}/batches/:batchId/tests`, { preHandler: member }, (req, reply) =>
    controller.list(req, reply),
  );
  app.post(`${INSTITUTE}/batches/:batchId/tests`, { preHandler: write }, (req, reply) =>
    controller.create(req, reply),
  );
  app.get(`${INSTITUTE}/tests/:testId`, { preHandler: member }, (req, reply) =>
    controller.sheet(req, reply),
  );
  app.patch(`${INSTITUTE}/tests/:testId`, { preHandler: write }, (req, reply) =>
    controller.update(req, reply),
  );
  app.delete(`${INSTITUTE}/tests/:testId`, { preHandler: write }, (req, reply) =>
    controller.remove(req, reply),
  );
  app.put(`${INSTITUTE}/tests/:testId/scores`, { preHandler: write }, (req, reply) =>
    controller.saveScores(req, reply),
  );
  app.get(`${INSTITUTE}/students/:studentId/tests`, { preHandler: member }, (req, reply) =>
    controller.studentResults(req, reply),
  );
}
