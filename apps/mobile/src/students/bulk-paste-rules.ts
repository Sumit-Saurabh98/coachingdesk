// Pure TypeScript: turning a pasted list into bulk-add rows, unit-tested in Node. The app only
// SPLITS the text; the API validates every row and reports the bad ones (FR-2.2).
import { BULK_STUDENTS_MAX } from '@coachingdesk/shared';

/** One non-blank pasted line, split into fields. `line` is 1-based, as the owner sees it. */
export interface PastedRow {
  line: number;
  name: string;
  guardianPhone: string;
  guardianName?: string;
}

/** A row the API couldn't create (POST /students/bulk `failed[]`). `row` is 1-based. */
export interface BulkFailure {
  row: number;
  field: string;
  message: string;
  input: { name: string; guardianPhone: string; guardianName?: string | null };
}

export { BULK_STUDENTS_MAX };

// The bulk schema's max lengths: longer text would reject the WHOLE request, so it's cut here
// and the API then reports just that row (a 200-letter "name" is still an invalid name).
const MAX_NAME = 200;
const MAX_PHONE = 50;

// "Aarav Sharma 98765 43210" (no comma, e.g. copied from WhatsApp): the number is at the end.
const TRAILING_PHONE = /^(.*?)[\s:-]*(\+?[\d][\d\s-]{8,})$/;

/**
 * "Name, Phone" or "Name, Phone, Guardian name" per line; tabs (from a spreadsheet) and ";"
 * work too. Blank lines are skipped. A line without a phone still becomes a row, so the API
 * reports it instead of it silently disappearing.
 */
export function parsePastedList(text: string): PastedRow[] {
  const rows: PastedRow[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const lineText = raw.trim();
    if (lineText === '') {
      return;
    }
    const parts = lineText.split(/[,;\t]/).map((part) => part.trim());
    let name = parts[0] ?? '';
    let phone = parts[1] ?? '';
    const guardianName = parts[2] ?? '';
    if (parts.length === 1) {
      const match = TRAILING_PHONE.exec(lineText);
      if (match) {
        name = (match[1] ?? '').trim();
        phone = (match[2] ?? '').trim();
      }
    }
    rows.push({
      line: index + 1,
      name: name.slice(0, MAX_NAME),
      guardianPhone: phone.slice(0, MAX_PHONE),
      ...(guardianName === '' ? {} : { guardianName: guardianName.slice(0, MAX_NAME) }),
    });
  });
  return rows;
}

/** The i18n key that explains why a row failed (the API's message is English-only). */
export function failureMessageKey(
  field: string,
):
  | 'studentForm.nameInvalid'
  | 'studentForm.phoneInvalid'
  | 'studentForm.guardianNameInvalid'
  | 'bulkAdd.rowInvalid' {
  switch (field) {
    case 'name':
      return 'studentForm.nameInvalid';
    case 'guardianPhone':
      return 'studentForm.phoneInvalid';
    case 'guardianName':
      return 'studentForm.guardianNameInvalid';
    default:
      return 'bulkAdd.rowInvalid';
  }
}

/** The pasted line number of a failed row (the API counts only the rows it was sent). */
export function lineOf(failure: BulkFailure, rows: readonly PastedRow[]): number {
  return rows[failure.row - 1]?.line ?? failure.row;
}

/** A pasted row written back as a line: "Name, Phone[, Guardian]". */
export function toLine(input: BulkFailure['input']): string {
  return [input.name, input.guardianPhone, input.guardianName ?? '']
    .filter((part, index) => index < 2 || part !== '')
    .join(', ');
}

/** Only the failed rows, as text to fix and send again. */
export function failedRowsText(failed: readonly BulkFailure[]): string {
  return failed.map((failure) => toLine(failure.input)).join('\n');
}
