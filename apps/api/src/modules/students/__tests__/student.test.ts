import { describe, expect, it } from 'vitest';
import { LocalDate, PhoneNumber } from '@coachingdesk/shared';
import { type NewStudentInput, Student } from '../student';

const day = (text: string) => LocalDate.parse(text);

const input = (overrides: Partial<NewStudentInput> = {}): NewStudentInput => ({
  name: 'Aarav Sharma',
  guardianName: 'Neha Sharma',
  guardianPhone: PhoneNumber.parse('9876543210'),
  joinedOn: day('2026-10-01'),
  ...overrides,
});

const create = (overrides: Partial<NewStudentInput> = {}) =>
  Student.create('student-1', 'inst-1', input(overrides));

const fieldError = (field: string) =>
  expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field } });

describe('Student.create', () => {
  it('starts active, and shows the full guardian phone to members', () => {
    expect(create({ notes: 'Weak in algebra' }).toPublicJSON()).toEqual({
      id: 'student-1',
      name: 'Aarav Sharma',
      guardianName: 'Neha Sharma',
      guardianPhone: '+919876543210',
      status: 'active',
      joinedOn: '2026-10-01',
      leftOn: null,
      notes: 'Weak in algebra',
      rollNumber: null,
    });
  });

  it('tidies names; empty guardian name / notes mean "not given"', () => {
    const student = create({ name: '  Aarav   Sharma ', guardianName: '  ', notes: '  ' });
    expect(student.name).toBe('Aarav Sharma');
    expect(student.guardianName).toBeNull();
    expect(student.notes).toBeNull();
  });

  it('keeps line breaks inside notes', () => {
    expect(create({ notes: 'Line 1\nLine 2' }).notes).toBe('Line 1\nLine 2');
  });

  it.each([
    ['name', { name: 'A' }],
    ['name', { name: 'x'.repeat(81) }],
    ['guardianName', { guardianName: 'x'.repeat(81) }],
    ['notes', { notes: 'x'.repeat(1001) }],
  ])('rejects a bad %s', (field, overrides) => {
    expect(() => create(overrides)).toThrow(fieldError(field));
  });
});

describe('Student.leave', () => {
  it('marks the student left on that date', () => {
    const left = create().leave(day('2026-12-31'));
    expect(left.isActive).toBe(false);
    expect(left.toPublicJSON()).toMatchObject({ status: 'left', leftOn: '2026-12-31' });
  });

  it('can leave on the day they joined', () => {
    expect(create().leave(day('2026-10-01')).leftOn?.toString()).toBe('2026-10-01');
  });

  it('cannot leave before joining', () => {
    expect(() => create().leave(day('2026-09-30'))).toThrow(fieldError('leftOn'));
  });

  it('is idempotent: leaving again keeps the FIRST date', () => {
    const left = create().leave(day('2026-12-31'));
    expect(left.leave(day('2027-01-15'))).toBe(left);
  });
});

describe('Student.withChanges', () => {
  it('returns a NEW student with the changes; unsent fields are kept', () => {
    const original = create();
    const changed = original.withChanges({
      guardianPhone: PhoneNumber.parse('9123456789'),
      notes: 'Moved to evening batch',
    });
    expect(changed.toPublicJSON()).toMatchObject({
      name: 'Aarav Sharma',
      guardianPhone: '+919123456789',
      notes: 'Moved to evening batch',
    });
    expect(original.guardianPhone?.toE164()).toBe('+919876543210');
  });

  it('clears the guardian name with null', () => {
    expect(create().withChanges({ guardianName: null }).guardianName).toBeNull();
  });

  it('a student who left can still be corrected', () => {
    const left = create().leave(day('2026-12-31'));
    expect(left.withChanges({ name: 'Aarav S.' }).name).toBe('Aarav S.');
  });

  it('but the join date cannot move after the leave date', () => {
    const left = create().leave(day('2026-12-31'));
    expect(() => left.withChanges({ joinedOn: day('2027-01-01') })).toThrow(fieldError('joinedOn'));
  });

  it('uses the same rules as create', () => {
    expect(() => create().withChanges({ name: 'A' })).toThrow(fieldError('name'));
  });
});

describe('an erased student', () => {
  const erased = Student.restore({
    ...create().toProps(),
    name: 'Erased student',
    guardianName: null,
    guardianPhone: null,
    notes: null,
    erasedAt: new Date('2026-10-19T10:00:00Z'),
  });

  it('cannot be changed or marked left (409)', () => {
    const conflict = expect.objectContaining({ code: 'CONFLICT' });
    expect(() => erased.withChanges({ name: 'Back again' })).toThrow(conflict);
    expect(() => erased.leave(day('2026-12-31'))).toThrow(conflict);
  });

  it('shows no guardian phone', () => {
    expect(erased.toPublicJSON().guardianPhone).toBeNull();
  });
});

describe('Student.erase', () => {
  const now = new Date('2026-10-19T10:00:00Z');

  it('removes personal data, marks the student left, and is idempotent', () => {
    const erased = create({ notes: 'Weak in algebra' }).erase(day('2026-10-19'), now);
    expect(erased.toPublicJSON()).toMatchObject({
      name: 'Erased student',
      guardianName: null,
      guardianPhone: null,
      notes: null,
      status: 'left',
      leftOn: '2026-10-19',
    });
    expect(erased.erasedAt).toEqual(now);
    expect(erased.erase(day('2026-12-01'), new Date())).toBe(erased);
  });

  it('keeps an earlier leave date', () => {
    const left = create().leave(day('2026-10-10'));
    expect(left.erase(day('2026-10-19'), now).leftOn?.toString()).toBe('2026-10-10');
  });
});
