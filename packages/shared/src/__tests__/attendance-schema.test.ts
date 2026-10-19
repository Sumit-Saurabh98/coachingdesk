import { describe, expect, it } from 'vitest';
import { StudentAttendanceQuery, SyncAttendanceBody } from '../index';

const BATCH = '01a152ab-abaa-7097-b07d-c570865c11e3';
const A = '01a152da-d670-7230-926b-5484c312456b';
const B = '01a152da-d6a1-722d-8117-2a4bd8c8d9b8';

describe('SyncAttendanceBody', () => {
  const body = (records: unknown) => ({ batchId: BATCH, date: '2026-10-19', records });

  it('parses the date and the marks', () => {
    const parsed = SyncAttendanceBody.parse(body([{ studentId: A, status: 'absent' }]));
    expect(parsed.date.toString()).toBe('2026-10-19');
    expect(parsed.records).toEqual([{ studentId: A, status: 'absent' }]);
  });

  it.each([
    ['no records', []],
    ['an unknown status', [{ studentId: A, status: 'sick' }]],
    [
      'the same student twice',
      [
        { studentId: A, status: 'present' },
        { studentId: A, status: 'absent' },
      ],
    ],
  ])('rejects %s', (_label, records) => {
    expect(SyncAttendanceBody.safeParse(body(records)).success).toBe(false);
  });

  it('accepts several students', () => {
    const records = [
      { studentId: A, status: 'present' },
      { studentId: B, status: 'late' },
    ];
    expect(SyncAttendanceBody.safeParse(body(records)).success).toBe(true);
  });
});

describe('StudentAttendanceQuery', () => {
  it.each([
    [{ from: '2026-10-01', to: '2026-10-31' }, true],
    [{ from: '2026-10-31', to: '2026-10-01' }, false], // backwards
    [{ from: '2025-01-01', to: '2026-10-01' }, false], // more than a year
  ])('%j -> %s', (query, ok) => {
    expect(StudentAttendanceQuery.safeParse(query).success).toBe(ok);
  });
});
