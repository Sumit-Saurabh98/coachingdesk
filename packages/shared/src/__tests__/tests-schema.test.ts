import { describe, expect, it } from 'vitest';
import { CreateTestBody, SaveScoresBody, UpdateTestBody } from '../index';

const A = '01a152da-d670-7230-926b-5484c312456b';
const B = '01a152da-d6a1-722d-8117-2a4bd8c8d9b8';

describe('CreateTestBody', () => {
  it('parses the date into a LocalDate', () => {
    const parsed = CreateTestBody.parse({ name: 'Unit 3', date: '2026-10-19', maxMarks: 50 });
    expect(parsed.date.toString()).toBe('2026-10-19');
    expect(parsed.maxMarks).toBe(50);
  });

  it.each([
    ['a missing name', { date: '2026-10-19', maxMarks: 50 }],
    ['marks as text', { name: 'T', date: '2026-10-19', maxMarks: '50' }],
    ['a bad date', { name: 'T', date: '2026-02-30', maxMarks: 50 }],
    ['an unknown field', { name: 'T', date: '2026-10-19', maxMarks: 50, batchId: A }],
  ])('rejects %s', (_label, body) => {
    expect(CreateTestBody.safeParse(body).success).toBe(false);
  });
});

describe('UpdateTestBody', () => {
  it('accepts one field; rejects an empty change', () => {
    expect(UpdateTestBody.parse({ maxMarks: 40 })).toEqual({ maxMarks: 40 });
    expect(UpdateTestBody.safeParse({}).success).toBe(false);
  });
});

describe('SaveScoresBody', () => {
  it('accepts marks or absent per student', () => {
    const parsed = SaveScoresBody.parse({
      scores: [
        { studentId: A, marks: 17.5 },
        { studentId: B, isAbsent: true },
      ],
    });
    expect(parsed.scores).toHaveLength(2);
  });

  it.each([
    ['no scores', []],
    ['neither marks nor absent', [{ studentId: A }]],
    ['both marks and absent', [{ studentId: A, marks: 10, isAbsent: true }]],
    ['isAbsent false without marks', [{ studentId: A, isAbsent: false }]],
    [
      'the same student twice',
      [
        { studentId: A, marks: 1 },
        { studentId: A, marks: 2 },
      ],
    ],
    ['a bad id', [{ studentId: 'x', marks: 1 }]],
  ])('rejects %s', (_label, scores) => {
    expect(SaveScoresBody.safeParse({ scores }).success).toBe(false);
  });

  it('marks with isAbsent: false are fine', () => {
    expect(
      SaveScoresBody.safeParse({ scores: [{ studentId: A, marks: 0, isAbsent: false }] }).success,
    ).toBe(true);
  });
});
