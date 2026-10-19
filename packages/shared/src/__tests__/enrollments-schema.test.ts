import { describe, expect, it } from 'vitest';
import {
  CreateEnrollmentBody,
  CreateStudentBody,
  ListStudentsQuery,
  UpdateEnrollmentBody,
} from '../index';

const STUDENT = '01a152da-d670-7230-926b-5484c312456b';
const BATCH = '01a152ab-abaa-7097-b07d-c570865c11e3';

describe('CreateEnrollmentBody', () => {
  it('needs only the student and the batch (fee/cycle/date default later)', () => {
    expect(CreateEnrollmentBody.parse({ studentId: STUDENT, batchId: BATCH })).toEqual({
      studentId: STUDENT,
      batchId: BATCH,
    });
  });

  it('parses the start date', () => {
    const body = CreateEnrollmentBody.parse({
      studentId: STUDENT,
      batchId: BATCH,
      startDate: '2026-11-01',
    });
    expect(body.startDate?.toString()).toBe('2026-11-01');
  });

  it.each([
    ['a non-UUID student id', { studentId: 'abc', batchId: BATCH }],
    ['a decimal fee', { studentId: STUDENT, batchId: BATCH, feePaise: 10.5 }],
    ['billNow that is not a boolean', { studentId: STUDENT, batchId: BATCH, billNow: 'yes' }],
  ])('rejects %s', (_label, body) => {
    expect(CreateEnrollmentBody.safeParse(body).success).toBe(false);
  });
});

describe('UpdateEnrollmentBody', () => {
  it('rejects an empty patch', () => {
    expect(UpdateEnrollmentBody.safeParse({}).success).toBe(false);
  });

  it('accepts an end date', () => {
    expect(UpdateEnrollmentBody.parse({ endDate: '2026-12-31' }).endDate?.toString()).toBe(
      '2026-12-31',
    );
  });
});

describe('students + batches', () => {
  it('CreateStudentBody takes optional batchIds (max 20)', () => {
    const base = { name: 'Aarav', guardianPhone: '9876543210' };
    expect(CreateStudentBody.parse({ ...base, batchIds: [BATCH] }).batchIds).toEqual([BATCH]);
    expect(CreateStudentBody.safeParse({ ...base, batchIds: Array(21).fill(BATCH) }).success).toBe(
      false,
    );
  });

  it('ListStudentsQuery takes an optional batchId', () => {
    expect(ListStudentsQuery.parse({ batchId: BATCH }).batchId).toBe(BATCH);
    expect(ListStudentsQuery.safeParse({ batchId: 'x' }).success).toBe(false);
  });
});

describe('fee schemas', () => {
  it('ListInvoicesQuery splits the status list and reads the flags', async () => {
    const { ListInvoicesQuery } = await import('../index');
    expect(ListInvoicesQuery.parse({ status: 'due, partially_paid', overdue: 'true' })).toEqual({
      status: ['due', 'partially_paid'],
      overdue: true,
      limit: 100,
    });
    expect(ListInvoicesQuery.safeParse({ status: 'due,overdue' }).success).toBe(false);
  });

  it('CreateManualInvoiceBody: discount defaults to 0; paise must be whole', async () => {
    const { CreateManualInvoiceBody } = await import('../index');
    const body = {
      studentId: STUDENT,
      amountPaise: 50000,
      dueDate: '2026-10-15',
      description: 'Exam fee',
    };
    expect(CreateManualInvoiceBody.parse(body).discountPaise).toBe(0);
    expect(CreateManualInvoiceBody.safeParse({ ...body, amountPaise: 1.5 }).success).toBe(false);
  });
});
