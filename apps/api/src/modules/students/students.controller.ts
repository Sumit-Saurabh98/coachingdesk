import {
  BulkCreateStudentsBody,
  CreateStudentBody,
  LeaveStudentBody,
  ListStudentsQuery,
  UpdateStudentBody,
} from '@coachingdesk/shared';
import type { LocalDate, PhoneNumber } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { canSeeFees, withoutFees } from '../../http/fee-visibility';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { StudentService } from './student.service';

/** The money-free part of an enrollment is shown to everyone; fees only to owner/staff. */
interface EnrollmentView {
  toPublicJSON(): {
    feePaise: number;
    discountPaise: number;
    netFeePaise: number;
    feeCycle: string;
  } & Record<string, unknown>;
}

/**
 * What students needs from enrollments, defined HERE and implemented by EnrollmentService
 * (dependency inversion, like UserInstitutesLookup in Step 9): students never imports
 * enrollments, so the modules can't form an import cycle.
 */
export interface StudentEnrollments {
  listForStudent(instituteId: string, studentId: string): Promise<EnrollmentView[]>;
  /** 404 unknown / 409 archived batch, without writing anything. */
  assertBatchesOpen(instituteId: string, batchIds: string[]): Promise<void>;
  enrollNewStudent(
    instituteId: string,
    studentId: string,
    batchIds: string[],
    startDate: LocalDate,
  ): Promise<EnrollmentView[]>;
  studentIdsInBatchToday(instituteId: string, batchId: string): Promise<string[]>;
}

/** The "guardian agreed" checkbox (ConsentService fits). Declared here: no import of messaging. */
export interface GuardianConsentRecorder {
  optInAll(instituteId: string, phones: PhoneNumber[]): Promise<void>;
}

const studentIdOf = (request: FastifyRequest) =>
  uuidParam(request, 'studentId', 'Student not found');

/** HTTP <-> StudentService. Institute id only from currentTenant(); roles on the routes. */
export class StudentsController {
  constructor(
    private readonly students: StudentService,
    private readonly enrollments: StudentEnrollments,
    private readonly consent: GuardianConsentRecorder,
  ) {}

  /** GET .../students?q=&status=&limit=&cursor= (any member) -> 200 { students, nextCursor } */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { batchId, ...query } = ListStudentsQuery.parse(request.query);
    const { instituteId } = currentTenant(request);
    // ?batchId=: ask enrollments WHO is in the batch today, then list just those students.
    const ids = batchId
      ? await this.enrollments.studentIdsInBatchToday(instituteId, batchId)
      : undefined;
    const page = await this.students.list(instituteId, { ...query, ids });
    await reply.status(200).send({
      students: page.students.map((s) => s.toPublicJSON()),
      nextCursor: page.nextCursor,
    });
  }

  /**
   * POST .../students { ..., batchIds? } (owner, staff) -> 201 { student, enrollments }
   * Two modules, so this is where they're combined: batches are checked FIRST (a typo'd batch
   * id must not leave a student behind), then the student is created, then enrolled.
   */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { batchIds = [], guardianConsent, ...body } = CreateStudentBody.parse(request.body);
    const { instituteId } = currentTenant(request);
    if (batchIds.length > 0) {
      await this.enrollments.assertBatchesOpen(instituteId, batchIds);
    }
    const student = await this.students.create(instituteId, body);
    const enrollments =
      batchIds.length > 0
        ? await this.enrollments.enrollNewStudent(
            instituteId,
            student.id,
            batchIds,
            student.joinedOn,
          )
        : [];
    if (guardianConsent) {
      await this.consent.optInAll(instituteId, [body.guardianPhone]);
    }
    await reply.status(201).send({
      student: student.toPublicJSON(),
      enrollments: enrollments.map((e) => e.toPublicJSON()),
    });
  }

  /**
   * POST .../students/bulk { rows, joinedOn? } (owner, staff)
   * -> 200 { created, students, failed }. 200, not 201: the result is per row, and a request
   * where every row failed still "worked" (it reports what to fix).
   */
  async bulkCreate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = BulkCreateStudentsBody.parse(request.body);
    const { instituteId } = currentTenant(request);
    const result = await this.students.bulkCreate(instituteId, body.rows, body.joinedOn);
    if (body.guardianConsent) {
      const phones = result.created.flatMap((s) => (s.guardianPhone ? [s.guardianPhone] : []));
      await this.consent.optInAll(instituteId, phones);
    }
    await reply.status(200).send({
      created: result.created.length,
      students: result.created.map((s) => s.toPublicJSON()),
      failed: result.failed,
    });
  }

  /** GET .../students/:studentId (any member) -> 200 { student, enrollments } */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const tenant = currentTenant(request);
    const student = await this.students.get(tenant.instituteId, studentIdOf(request));
    const enrollments = await this.enrollments.listForStudent(tenant.instituteId, student.id);
    const showFees = canSeeFees(tenant.role);
    await reply.status(200).send({
      student: student.toPublicJSON(),
      enrollments: enrollments.map((e) =>
        showFees
          ? e.toPublicJSON()
          : withoutFees(e.toPublicJSON(), ['feePaise', 'discountPaise', 'netFeePaise', 'feeCycle']),
      ),
    });
  }

  /** PATCH .../students/:studentId (owner, staff) -> 200 { student } */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = UpdateStudentBody.parse(request.body);
    const student = await this.students.update(
      currentTenant(request).instituteId,
      studentIdOf(request),
      body,
    );
    await reply.status(200).send({ student: student.toPublicJSON() });
  }

  /** POST .../students/:studentId/leave { leftOn? } (owner, staff) -> 200 { student } */
  async leave(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // The body is optional: a POST with no body at all means "left today".
    const body = LeaveStudentBody.parse(request.body ?? {});
    const student = await this.students.leave(
      currentTenant(request).instituteId,
      studentIdOf(request),
      body.leftOn,
    );
    await reply.status(200).send({ student: student.toPublicJSON() });
  }
}
