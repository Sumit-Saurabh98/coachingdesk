import { describe, expect, it } from 'vitest';
import {
  type BulkFailure,
  failedRowsText,
  failureMessageKey,
  lineOf,
  parsePastedList,
} from '../bulk-paste-rules';

describe('parsePastedList', () => {
  it('splits "Name, Phone" lines and skips blank ones (line numbers as pasted)', () => {
    const text = 'Aarav Sharma, 98765 43210\n\n  Riya, +919876500000  \n';
    expect(parsePastedList(text)).toEqual([
      { line: 1, name: 'Aarav Sharma', guardianPhone: '98765 43210' },
      { line: 3, name: 'Riya', guardianPhone: '+919876500000' },
    ]);
  });

  it('reads an optional guardian name, and tabs or ";" as separators', () => {
    expect(parsePastedList('Aarav\t9876543210\tNeha Sharma\nRavi; 9876500000')).toEqual([
      { line: 1, name: 'Aarav', guardianPhone: '9876543210', guardianName: 'Neha Sharma' },
      { line: 2, name: 'Ravi', guardianPhone: '9876500000' },
    ]);
  });

  it('finds a number at the end of a line without a comma', () => {
    expect(parsePastedList('Aarav Sharma 98765 43210\nRiya - 09876500000')).toEqual([
      { line: 1, name: 'Aarav Sharma', guardianPhone: '98765 43210' },
      { line: 2, name: 'Riya', guardianPhone: '09876500000' },
    ]);
  });

  it('keeps a line with no phone as a row, so the API reports it', () => {
    expect(parsePastedList('Just a name')).toEqual([
      { line: 1, name: 'Just a name', guardianPhone: '' },
    ]);
  });

  it('cuts very long text to the request limits', () => {
    const [row] = parsePastedList(`${'a'.repeat(300)}, ${'9'.repeat(80)}`);
    expect(row?.name).toHaveLength(200);
    expect(row?.guardianPhone).toHaveLength(50);
  });
});

describe('failed rows', () => {
  const rows = parsePastedList('Aarav, 9876543210\n\nRavi, 98765\nSita, 9876500000, Gita');
  const failed: BulkFailure[] = [
    {
      row: 2,
      field: 'guardianPhone',
      message: '…',
      input: { name: 'Ravi', guardianPhone: '98765' },
    },
    {
      row: 3,
      field: 'name',
      message: '…',
      input: { name: 'Sita', guardianPhone: '9876500000', guardianName: 'Gita' },
    },
  ];

  it('maps the API row back to the pasted line', () => {
    expect(failed.map((failure) => lineOf(failure, rows))).toEqual([3, 4]);
  });

  it('turns failed rows back into lines to fix', () => {
    expect(failedRowsText(failed)).toBe('Ravi, 98765\nSita, 9876500000, Gita');
  });

  it.each([
    ['name', 'studentForm.nameInvalid'],
    ['guardianPhone', 'studentForm.phoneInvalid'],
    ['guardianName', 'studentForm.guardianNameInvalid'],
    ['other', 'bulkAdd.rowInvalid'],
  ])('field %s -> %s', (field, key) => {
    expect(failureMessageKey(field)).toBe(key);
  });
});
