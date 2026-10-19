import { describe, expect, it } from 'vitest';
import { FixedClock, LocalDate, PhoneNumber, SequentialIdGenerator } from '@coachingdesk/shared';
import { InMemoryBatchRepository } from '../../batches/batch.repository';
import { BatchService } from '../../batches/batch.service';
import { InMemoryStudentRepository } from '../../students/student.repository';
import { StudentService } from '../../students/student.service';
import { InMemoryEnrollmentRepository } from '../enrollment.repository';
import { EnrollmentService } from '../enrollment.service';

const A = 'inst-a';
const B = 'inst-b';
const day = (text: string) => LocalDate.parse(text);

// The REAL student and batch services (with in-memory storage): enrollments talks to them
// exactly as it will in production.
async function setup() {
  const ids = new SequentialIdGenerator();
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const institutes = { get: async () => ({ timezone: 'Asia/Kolkata' }) };
  const students = new StudentService({
    students: new InMemoryStudentRepository(),
    entitlements: { limitFor: async () => null },
    institutes,
    ids,
    clock,
  });
  const batches = new BatchService({ batches: new InMemoryBatchRepository(), ids, clock });
  const service = new EnrollmentService({
    enrollments: new InMemoryEnrollmentRepository(),
    students,
    batches,
    institutes,
    ids,
    clock,
  });

  const newStudent = (instituteId = A, name = 'Aarav') =>
    students.create(instituteId, { name, guardianPhone: PhoneNumber.parse('9876543210') });
  const newBatch = (instituteId = A, name = 'Maths') =>
    batches.create(instituteId, {
      name,
      schedule: { days: [1], start: '17:00', end: '18:00' },
      defaultFeePaise: 150000,
      defaultFeeCycle: 'monthly',
    });
  return { service, students, batches, newStudent, newBatch };
}

describe('EnrollmentService.enroll', () => {
  it("copies the batch's fee and cycle, starts today at the institute", async () => {
    const { service, newStudent, newBatch } = await setup();
    const [student, batch] = [await newStudent(), await newBatch()];

    const enrollment = await service.enroll(A, { studentId: student.id, batchId: batch.id });

    expect(enrollment.toPublicJSON()).toMatchObject({
      feePaise: 150000,
      discountPaise: 0,
      feeCycle: 'monthly',
      startDate: '2026-10-19',
      endDate: null,
    });
  });

  it('what is sent overrides the defaults (sibling discount, quarterly payer)', async () => {
    const { service, newStudent, newBatch } = await setup();
    const [student, batch] = [await newStudent(), await newBatch()];

    const enrollment = await service.enroll(A, {
      studentId: student.id,
      batchId: batch.id,
      discountPaise: 20000,
      feeCycle: 'quarterly',
      startDate: day('2026-11-01'),
    });

    expect(enrollment.toPublicJSON()).toMatchObject({
      netFeePaise: 130000,
      feeCycle: 'quarterly',
      startDate: '2026-11-01',
    });
  });

  it('later changes to the batch fee do NOT change the enrollment', async () => {
    const { service, batches, newStudent, newBatch } = await setup();
    const [student, batch] = [await newStudent(), await newBatch()];
    const enrollment = await service.enroll(A, { studentId: student.id, batchId: batch.id });

    await batches.update(A, batch.id, { defaultFeePaise: 999900 });

    expect((await service.get(A, enrollment.id)).fee.toPaise()).toBe(150000);
  });

  it('409 when already enrolled; OK again after the old enrollment ended', async () => {
    const { service, newStudent, newBatch } = await setup();
    const [student, batch] = [await newStudent(), await newBatch()];
    const first = await service.enroll(A, { studentId: student.id, batchId: batch.id });

    const again = { studentId: student.id, batchId: batch.id, startDate: day('2026-12-01') };
    await expect(service.enroll(A, again)).rejects.toMatchObject({ code: 'CONFLICT' });

    await service.update(A, first.id, { endDate: day('2026-11-30') });
    await expect(service.enroll(A, again)).resolves.toBeDefined();
  });

  it('409 when the old enrollment ends AFTER the new start (overlap)', async () => {
    const { service, newStudent, newBatch } = await setup();
    const [student, batch] = [await newStudent(), await newBatch()];
    const first = await service.enroll(A, { studentId: student.id, batchId: batch.id });
    await service.update(A, first.id, { endDate: day('2026-12-31') });

    await expect(
      service.enroll(A, { studentId: student.id, batchId: batch.id, startDate: day('2026-12-01') }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('409 for a student who left, and for an archived batch', async () => {
    const { service, students, batches, newStudent, newBatch } = await setup();
    const leaver = await newStudent(A, 'Leaver');
    await students.leave(A, leaver.id);
    const archived = await newBatch(A, 'Old');
    await batches.archive(A, archived.id);
    const [student, batch] = [await newStudent(), await newBatch()];

    await expect(
      service.enroll(A, { studentId: leaver.id, batchId: batch.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.enroll(A, { studentId: student.id, batchId: archived.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { batchId: archived.id } });
  });

  it("TENANCY: 404 for another institute's student or batch", async () => {
    const { service, newStudent, newBatch } = await setup();
    const [mine, theirs] = [await newStudent(A), await newStudent(B)];
    const [myBatch, theirBatch] = [await newBatch(A), await newBatch(B)];

    await expect(
      service.enroll(A, { studentId: theirs.id, batchId: myBatch.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.enroll(A, { studentId: mine.id, batchId: theirBatch.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('EnrollmentService.enrollNewStudent', () => {
  it('enrolls in every batch with its defaults; duplicates in the list are ignored', async () => {
    const { service, newStudent, newBatch } = await setup();
    const student = await newStudent();
    const [maths, science] = [await newBatch(A, 'Maths'), await newBatch(A, 'Science')];

    const created = await service.enrollNewStudent(
      A,
      student.id,
      [maths.id, science.id, maths.id],
      day('2026-10-19'),
    );

    expect(created.map((e) => e.batchId)).toEqual([maths.id, science.id]);
  });

  it('assertBatchesOpen: 404 for an unknown batch, without writing anything', async () => {
    const { service, newBatch } = await setup();
    const batch = await newBatch();
    await expect(
      service.assertBatchesOpen(A, [batch.id, '00000000-0000-7000-8000-00000000ffff']),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('EnrollmentService.update / lists / counts', () => {
  it('updates terms and end date; 404 for another institute', async () => {
    const { service, newStudent, newBatch } = await setup();
    const [student, batch] = [await newStudent(), await newBatch()];
    const enrollment = await service.enroll(A, { studentId: student.id, batchId: batch.id });

    const updated = await service.update(A, enrollment.id, {
      discountPaise: 50000,
      endDate: day('2027-03-31'),
    });

    expect(updated.toPublicJSON()).toMatchObject({
      netFeePaise: 100000,
      endDate: '2027-03-31',
    });
    await expect(service.update(B, enrollment.id, { discountPaise: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("counts today's students in a batch and lists their ids", async () => {
    const { service, newStudent, newBatch } = await setup();
    const batch = await newBatch();
    const aarav = await newStudent(A, 'Aarav');
    const bhavya = await newStudent(A, 'Bhavya');
    await service.enroll(A, { studentId: aarav.id, batchId: batch.id });
    await service.enroll(A, {
      studentId: bhavya.id,
      batchId: batch.id,
      startDate: day('2026-11-01'),
    });

    expect(await service.countInBatchToday(A, batch.id)).toBe(1); // Bhavya starts next month
    expect(await service.studentIdsInBatchToday(A, batch.id)).toEqual([aarav.id]);
  });

  it("listForStudent: 404 for another institute's student", async () => {
    const { service, newStudent } = await setup();
    const theirs = await newStudent(B);
    await expect(service.listForStudent(A, theirs.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
