import { describe, expect, it } from 'vitest';
import {
  entryError,
  hasErrors,
  initialEntries,
  scoresToSend,
  type SheetRow,
} from '../marks-sheet-rules';

const row = (studentId: string, changes: Partial<SheetRow> = {}): SheetRow => ({
  studentId,
  name: studentId,
  rollNumber: null,
  marks: null,
  isAbsent: false,
  entered: false,
  ...changes,
});

describe('initialEntries', () => {
  it('marks as text, absents ticked, nothing yet = empty', () => {
    expect(
      initialEntries([
        row('a', { marks: 17.5, entered: true }),
        row('b', { isAbsent: true, entered: true }),
        row('c'),
      ]),
    ).toEqual({
      a: { text: '17.5', absent: false },
      b: { text: '', absent: true },
      c: { text: '', absent: false },
    });
  });
});

describe('entryError', () => {
  const max = 25;
  it.each([
    [{ text: '20', absent: false }, row('a'), null],
    [{ text: '25', absent: false }, row('a'), null],
    [{ text: '25.5', absent: false }, row('a'), 'marks.overMax'],
    [{ text: 'abc', absent: false }, row('a'), 'marks.invalid'],
    [{ text: '', absent: false }, row('a'), null], // not marked yet: fine
    [{ text: '', absent: false }, row('a', { entered: true, marks: 10 }), 'marks.cleared'],
    [{ text: 'abc', absent: true }, row('a'), null], // absent wins
  ] as const)('%j -> %s', (entry, sheetRow, error) => {
    expect(entryError(entry, sheetRow, max)).toBe(error);
  });
});

describe('scoresToSend', () => {
  it('only the changes: new marks, changed marks, new absents', () => {
    const rows = [
      row('same', { marks: 10, entered: true }),
      row('changed', { marks: 10, entered: true }),
      row('new'),
      row('nowAbsent', { marks: 12, entered: true }),
      row('stillAbsent', { isAbsent: true, entered: true }),
      row('empty'),
    ];
    const entries = {
      same: { text: '10', absent: false },
      changed: { text: '11.5', absent: false },
      new: { text: '20', absent: false },
      nowAbsent: { text: '12', absent: true },
      stillAbsent: { text: '', absent: true },
      empty: { text: '', absent: false },
    };
    expect(scoresToSend(rows, entries)).toEqual([
      { studentId: 'changed', marks: 11.5 },
      { studentId: 'new', marks: 20 },
      { studentId: 'nowAbsent', isAbsent: true },
    ]);
  });

  it('back from absent to marks is a change', () => {
    expect(
      scoresToSend([row('a', { isAbsent: true, entered: true })], {
        a: { text: '15', absent: false },
      }),
    ).toEqual([{ studentId: 'a', marks: 15 }]);
  });
});

describe('hasErrors', () => {
  it('any row with a problem blocks saving', () => {
    const rows = [row('a'), row('b')];
    expect(hasErrors(rows, { a: { text: '5', absent: false } }, 10)).toBe(false);
    expect(hasErrors(rows, { b: { text: '50', absent: false } }, 10)).toBe(true);
  });
});
