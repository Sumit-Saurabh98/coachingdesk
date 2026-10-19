import { describe, expect, it } from 'vitest';
import {
  BULK_STUDENTS_MAX,
  BulkCreateStudentsBody,
  CreateStudentBody,
  LeaveStudentBody,
  ListStudentsQuery,
  UpdateStudentBody,
  zLocalDate,
} from '../index';

const valid = { name: 'Aarav Sharma', guardianName: 'Neha Sharma', guardianPhone: '98765 43210' };

describe('zLocalDate', () => {
  it('parses a real date', () => {
    expect(zLocalDate.parse('2026-10-18').toString()).toBe('2026-10-18');
  });

  it.each(['2026-02-30', '18-10-2026', '2026-10-18T10:00:00Z', ''])('rejects %j', (value) => {
    expect(zLocalDate.safeParse(value).success).toBe(false);
  });
});

describe('CreateStudentBody', () => {
  it('normalises the guardian phone to E.164 and leaves joinedOn to the service', () => {
    const body = CreateStudentBody.parse(valid);
    expect(body.guardianPhone.toE164()).toBe('+919876543210');
    expect(body.joinedOn).toBeUndefined();
  });

  it('rejects an invalid phone (422 before any business code runs)', () => {
    expect(CreateStudentBody.safeParse({ ...valid, guardianPhone: '98765' }).success).toBe(false);
  });

  it('rejects a missing guardian phone', () => {
    expect(CreateStudentBody.safeParse({ name: 'Aarav' }).success).toBe(false);
  });

  it('rejects unknown fields (status is changed only via /leave)', () => {
    expect(CreateStudentBody.safeParse({ ...valid, status: 'left' }).success).toBe(false);
  });
});

describe('UpdateStudentBody / LeaveStudentBody', () => {
  it('rejects an empty patch', () => {
    expect(UpdateStudentBody.safeParse({}).success).toBe(false);
  });

  it('leftOn is optional but must be a real date', () => {
    expect(LeaveStudentBody.parse({}).leftOn).toBeUndefined();
    expect(LeaveStudentBody.safeParse({ leftOn: 'yesterday' }).success).toBe(false);
  });
});

describe('ListStudentsQuery', () => {
  it('defaults: active students, 50 per page', () => {
    expect(ListStudentsQuery.parse({})).toEqual({ status: 'active', limit: 50 });
  });

  it('turns the limit text into a number and trims the search', () => {
    expect(ListStudentsQuery.parse({ limit: '20', q: '  aarav ' })).toMatchObject({
      limit: 20,
      q: 'aarav',
    });
  });

  it.each([{ limit: '0' }, { limit: '101' }, { limit: 'abc' }, { status: 'deleted' }])(
    'rejects %j',
    (query) => {
      expect(ListStudentsQuery.safeParse(query).success).toBe(false);
    },
  );
});

describe('BulkCreateStudentsBody', () => {
  it('keeps row values raw so one bad row does not reject the rest', () => {
    const body = BulkCreateStudentsBody.parse({ rows: [{ name: 'Ravi', guardianPhone: '98765' }] });
    expect(body.rows[0]?.guardianPhone).toBe('98765');
  });

  it(`accepts 1 to ${BULK_STUDENTS_MAX} rows`, () => {
    const row = { name: 'Ravi', guardianPhone: '9876543210' };
    expect(BulkCreateStudentsBody.safeParse({ rows: [] }).success).toBe(false);
    expect(
      BulkCreateStudentsBody.safeParse({ rows: Array(BULK_STUDENTS_MAX).fill(row) }).success,
    ).toBe(true);
    expect(
      BulkCreateStudentsBody.safeParse({ rows: Array(BULK_STUDENTS_MAX + 1).fill(row) }).success,
    ).toBe(false);
  });
});
