// Pure TypeScript: the marks sheet's rules, unit-tested in Node. They mirror the API's (marks
// 0..max, at most 2 decimals); the API checks again and decides.
import { formatMarks, parseMarks } from './test-rules';

/** One student on the sheet, as the API returns them (in roll-number order). */
export interface SheetRow {
  studentId: string;
  name: string;
  rollNumber: string | null;
  marks: number | null;
  isAbsent: boolean;
  entered: boolean; // false = nothing saved yet for this student
}

/** What the teacher has in front of them for one student. */
export interface Entry {
  text: string; // marks as typed ('' = nothing)
  absent: boolean;
}

export type Entries = Record<string, Entry>;
export type EntryError = 'marks.invalid' | 'marks.overMax' | 'marks.cleared';

export function initialEntries(rows: readonly SheetRow[]): Entries {
  return Object.fromEntries(
    rows.map((row) => [
      row.studentId,
      { text: row.marks === null ? '' : formatMarks(row.marks), absent: row.isAbsent },
    ]),
  );
}

/**
 * A problem with one student's entry, or null. Empty is fine for someone never marked (fill in
 * later), but a saved mark can't be emptied: the API keeps it, so say "marks or absent".
 */
export function entryError(entry: Entry, row: SheetRow, maxMarks: number): EntryError | null {
  if (entry.absent) {
    return null;
  }
  if (entry.text.trim() === '') {
    return row.entered ? 'marks.cleared' : null;
  }
  const marks = parseMarks(entry.text);
  if (marks === null) {
    return 'marks.invalid';
  }
  return marks > maxMarks ? 'marks.overMax' : null;
}

export type ScoreToSend =
  { studentId: string; marks: number } | { studentId: string; isAbsent: true };

/** Only what changed (another teacher may be marking other students: theirs stay). */
export function scoresToSend(rows: readonly SheetRow[], entries: Entries): ScoreToSend[] {
  return rows.flatMap((row): ScoreToSend[] => {
    const entry = entries[row.studentId];
    if (!entry) {
      return [];
    }
    if (entry.absent) {
      return row.isAbsent && row.entered ? [] : [{ studentId: row.studentId, isAbsent: true }];
    }
    const marks = parseMarks(entry.text);
    if (marks === null) {
      return [];
    }
    return row.entered && !row.isAbsent && row.marks === marks
      ? []
      : [{ studentId: row.studentId, marks }];
  });
}

/** Any row with a problem blocks saving (the API would refuse the whole request). */
export function hasErrors(rows: readonly SheetRow[], entries: Entries, maxMarks: number) {
  return rows.some((row) => {
    const entry = entries[row.studentId];
    return entry !== undefined && entryError(entry, row, maxMarks) !== null;
  });
}
