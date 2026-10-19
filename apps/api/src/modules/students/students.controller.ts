import {
  CreateStudentBody,
  LeaveStudentBody,
  ListStudentsQuery,
  UpdateStudentBody,
} from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { StudentService } from './student.service';

const studentIdOf = (request: FastifyRequest) =>
  uuidParam(request, 'studentId', 'Student not found');

/** HTTP <-> StudentService. Institute id only from currentTenant(); roles on the routes. */
export class StudentsController {
  constructor(private readonly students: StudentService) {}

  /** GET .../students?q=&status=&limit=&cursor= (any member) -> 200 { students, nextCursor } */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = ListStudentsQuery.parse(request.query);
    const page = await this.students.list(currentTenant(request).instituteId, query);
    await reply.status(200).send({
      students: page.students.map((s) => s.toPublicJSON()),
      nextCursor: page.nextCursor,
    });
  }

  /** POST .../students (owner, staff) -> 201 { student } */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = CreateStudentBody.parse(request.body);
    const student = await this.students.create(currentTenant(request).instituteId, body);
    await reply.status(201).send({ student: student.toPublicJSON() });
  }

  /** GET .../students/:studentId (any member) -> 200 { student } */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const student = await this.students.get(
      currentTenant(request).instituteId,
      studentIdOf(request),
    );
    await reply.status(200).send({ student: student.toPublicJSON() });
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
