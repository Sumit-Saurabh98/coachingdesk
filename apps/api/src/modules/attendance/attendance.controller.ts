import {
  AppError,
  AttendanceSummaryQuery,
  BatchAttendanceQuery,
  StudentAttendanceQuery,
  SyncAttendanceBody,
} from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import { isUuid, uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { AttendanceSession } from './attendance.repository';
import type { AttendanceService } from './attendance.service';

const sessionJSON = (session: AttendanceSession) => ({
  id: session.id,
  batchId: session.batchId,
  date: session.date.toString(),
  clientId: session.clientId,
  takenBy: session.takenBy,
  submittedAt: session.submittedAt.toISOString(),
});

/** Attendance: every member (owner, teacher, staff) can read and take it. */
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** PUT .../attendance-sessions/:clientId -> 200 { session, records, alerts } */
  async sync(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { clientId } = request.params as { clientId?: string };
    // The phone generates this id offline; a malformed one is the client's mistake (422).
    if (!isUuid(clientId)) {
      throw new AppError('VALIDATION_FAILED', 'clientId must be a UUID', { field: 'clientId' });
    }
    const body = SyncAttendanceBody.parse(request.body);
    const result = await this.attendance.sync(
      currentTenant(request).instituteId,
      currentUserId(request),
      clientId.toLowerCase(),
      body,
    );
    await reply.status(200).send({
      session: sessionJSON(result.session),
      records: result.records.map((r) => ({ studentId: r.studentId, status: r.status })),
      alerts: result.alerts,
    });
  }

  /** GET .../batches/:batchId/attendance?date= -> 200 { batchId, date, session, students } */
  async register(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { date } = BatchAttendanceQuery.parse(request.query);
    const batchId = uuidParam(request, 'batchId', 'Batch not found');
    const register = await this.attendance.register(
      currentTenant(request).instituteId,
      batchId,
      date,
    );
    await reply.status(200).send({
      batchId,
      date: date.toString(),
      session: register.session ? sessionJSON(register.session) : null,
      students: register.students,
    });
  }

  /** GET .../students/:studentId/attendance?from&to -> 200 { records, summary } */
  async studentHistory(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { from, to } = StudentAttendanceQuery.parse(request.query);
    const history = await this.attendance.studentHistory(
      currentTenant(request).instituteId,
      uuidParam(request, 'studentId', 'Student not found'),
      from,
      to,
    );
    await reply.status(200).send({
      from: from.toString(),
      to: to.toString(),
      records: history.marks.map((m) => ({
        date: m.date.toString(),
        batchId: m.batchId,
        status: m.status,
      })),
      summary: history.stats.toJSON(),
    });
  }

  /** GET .../attendance/summary?date= -> 200 { date, batches } */
  async summary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { date } = AttendanceSummaryQuery.parse(request.query);
    const summary = await this.attendance.daySummary(currentTenant(request).instituteId, date);
    await reply.status(200).send({ date: summary.date.toString(), batches: summary.batches });
  }
}
