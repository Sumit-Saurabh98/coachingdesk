import { describe, expect, it } from 'vitest';
import {
  isValidIndianPhone,
  NEW_STUDENT,
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
