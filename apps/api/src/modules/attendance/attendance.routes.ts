import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { AttendanceController } from './attendance.controller';

export interface AttendanceRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

const INSTITUTE = '/v1/institutes/:instituteId';

export function registerAttendanceRoutes(
  app: FastifyInstance,
  controller: AttendanceController,
  { requireAuth, requireMember }: AttendanceRouteGuards,
): void {
  // API_DOCS roles: attendance is read AND written by every member (teachers take it).
  const member = [requireAuth, requireMember];

  app.put(`${INSTITUTE}/attendance-sessions/:clientId`, { preHandler: member }, (req, reply) =>
    controller.sync(req, reply),
  );
  app.get(`${INSTITUTE}/batches/:batchId/attendance`, { preHandler: member }, (req, reply) =>
    controller.register(req, reply),
  );
  app.get(`${INSTITUTE}/students/:studentId/attendance`, { preHandler: member }, (req, reply) =>
    controller.studentHistory(req, reply),
  );
  app.get(`${INSTITUTE}/attendance/summary`, { preHandler: member }, (req, reply) =>
    controller.summary(req, reply),
  );
}
