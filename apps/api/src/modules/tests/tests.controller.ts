import {
  CreateTestBody,
  ListTestsQuery,
  SaveScoresBody,
  UpdateTestBody,
} from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { ClassTest } from './class-test';
import type { MarksSheet, TestService } from './test.service';

const testJSON = (test: ClassTest) => ({
  id: test.id,
  batchId: test.batchId,
  name: test.name,
  date: test.date.toString(),
  maxMarks: test.maxMarks,
  createdBy: test.createdBy,
  resultsSentAt: test.resultsSentAt?.toISOString() ?? null,
  createdAt: test.createdAt.toISOString(),
});

const sheetJSON = (sheet: MarksSheet) => ({
  test: testJSON(sheet.test),
  students: sheet.rows,
  stats: sheet.stats,
});

/** Tests & marks: every member reads; owner and teacher write (API_DOCS roles). */
export class TestsController {
  constructor(private readonly tests: TestService) {}

  /** POST .../batches/:batchId/tests -> 201 { test } */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = CreateTestBody.parse(request.body);
    const test = await this.tests.create(
      currentTenant(request).instituteId,
      uuidParam(request, 'batchId', 'Batch not found'),
      currentUserId(request),
      body,
    );
    await reply.status(201).send({ test: testJSON(test) });
  }

  /** GET .../batches/:batchId/tests?limit -> 200 { tests: [{ ...test, scored, absent }] } */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { limit } = ListTestsQuery.parse(request.query);
    const summaries = await this.tests.list(
      currentTenant(request).instituteId,
      uuidParam(request, 'batchId', 'Batch not found'),
      limit,
    );
    await reply.status(200).send({
      tests: summaries.map((s) => ({ ...testJSON(s.test), scored: s.scored, absent: s.absent })),
    });
  }

  /** GET .../tests/:testId -> 200 { test, students, stats } (the marks sheet) */
  async sheet(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sheet = await this.tests.sheet(
      currentTenant(request).instituteId,
      uuidParam(request, 'testId', 'Test not found'),
    );
    await reply.status(200).send(sheetJSON(sheet));
  }

  /** PATCH .../tests/:testId -> 200 { test } */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const changes = UpdateTestBody.parse(request.body);
    const test = await this.tests.update(
      currentTenant(request).instituteId,
      uuidParam(request, 'testId', 'Test not found'),
      changes,
    );
    await reply.status(200).send({ test: testJSON(test) });
  }

  /** DELETE .../tests/:testId -> 204 */
  async remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.tests.remove(
      currentTenant(request).instituteId,
      uuidParam(request, 'testId', 'Test not found'),
    );
    await reply.status(204).send();
  }

  /** PUT .../tests/:testId/scores -> 200 { test, students, stats } */
  async saveScores(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = SaveScoresBody.parse(request.body);
    const sheet = await this.tests.saveScores(
      currentTenant(request).instituteId,
      uuidParam(request, 'testId', 'Test not found'),
      currentUserId(request),
      body,
    );
    await reply.status(200).send(sheetJSON(sheet));
  }

  /** GET .../students/:studentId/tests?limit -> 200 { results } (newest first) */
  async studentResults(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { limit } = ListTestsQuery.parse(request.query);
    const results = await this.tests.studentResults(
      currentTenant(request).instituteId,
      uuidParam(request, 'studentId', 'Student not found'),
      limit,
    );
    await reply.status(200).send({
      results: results.map((r) => ({
        test: testJSON(r.test),
        marks: r.score.marks,
        isAbsent: r.score.isAbsent,
      })),
    });
  }
}
