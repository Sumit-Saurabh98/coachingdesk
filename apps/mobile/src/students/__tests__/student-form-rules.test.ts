import { describe, expect, it } from 'vitest';
import {
  isValidIndianPhone,
  NEW_STUDENT,
  samePhone,
  toUpdateStudentRequest,
  valuesFromStudent,
  type StudentFormValues,
  toCreateStudentRequest,
  validateStudentForm,
} from '../student-form-rules';

const filled = (changes: Partial<StudentFormValues> = {}): StudentFormValues => ({
  ...NEW_STUDENT,
  name: 'Aarav Sharma',
  guardianPhone: '9876543210',
  ...changes,
});

describe('validateStudentForm (mirrors the API)', () => {
  it('a complete form has no errors', () => {
    expect(validateStudentForm(filled())).toEqual({});
  });

  it.each([
    [{ name: 'A' }, 'name'],
    [{ name: 'x'.repeat(81) }, 'name'],
    [{ guardianName: 'x'.repeat(81) }, 'guardianName'],
    [{ guardianPhone: '12345' }, 'guardianPhone'],
    [{ guardianPhone: '' }, 'guardianPhone'],
    [{ notes: 'x'.repeat(1001) }, 'notes'],
  ] satisfies Array<[Partial<StudentFormValues>, string]>)('%j -> %s', (changes, field) => {
    expect(Object.keys(validateStudentForm(filled(changes)))).toEqual([field]);
  });
});

describe('isValidIndianPhone (the shared zPhoneIN rule)', () => {
  it.each(['9876543210', '98765 43210', '+919876543210', '09876543210'])('%j is valid', (phone) => {
    expect(isValidIndianPhone(phone)).toBe(true);
  });
  it.each(['12345', '1234567890', 'abc'])('%j is not', (phone) => {
    expect(isValidIndianPhone(phone)).toBe(false);
  });
});

describe('toCreateStudentRequest', () => {
  it('tidies text; empty optional fields -> null / left out', () => {
    expect(toCreateStudentRequest(filled({ name: '  Aarav   Sharma ' }))).toEqual({
      name: 'Aarav Sharma',
      guardianName: null,
      guardianPhone: '9876543210',
      notes: null,
      guardianConsent: false,
    });
  });

  it('includes the date, batches and consent when given', () => {
    expect(
      toCreateStudentRequest(
        filled({ joinedOn: '2026-10-01', batchIds: ['b1'], guardianConsent: true, notes: ' x ' }),
      ),
    ).toMatchObject({
      joinedOn: '2026-10-01',
      batchIds: ['b1'],
      guardianConsent: true,
      notes: 'x',
    });
  });

  it('consent is never pre-ticked', () => {
    expect(NEW_STUDENT.guardianConsent).toBe(false);
  });
});

describe('editing a student', () => {
  const original = {
    name: 'Aarav Sharma',
    guardianName: 'Neha Sharma',
    guardianPhone: '+919876543210',
    joinedOn: '2026-10-01',
    notes: null,
  };

  it('nothing changed -> null (no request)', () => {
    expect(toUpdateStudentRequest(original, valuesFromStudent(original))).toBeNull();
  });

  it('the same phone written differently is NOT a change', () => {
    for (const phone of ['98765 43210', '9876543210', '09876543210']) {
      const values = { ...valuesFromStudent(original), guardianPhone: phone };
      expect(toUpdateStudentRequest(original, values)).toBeNull();
    }
  });

  it('only what changed is sent', () => {
    const values = {
      ...valuesFromStudent(original),
      guardianPhone: '9123456789',
      notes: 'Comes by bus',
      guardianName: '',
    };
    expect(toUpdateStudentRequest(original, values)).toEqual({
      guardianPhone: '9123456789',
      notes: 'Comes by bus',
      guardianName: null,
    });
  });

  it('samePhone', () => {
    expect(samePhone('98765 43210', '+919876543210')).toBe(true);
    expect(samePhone('9123456789', '+919876543210')).toBe(false);
    expect(samePhone('', null)).toBe(false);
  });
});
