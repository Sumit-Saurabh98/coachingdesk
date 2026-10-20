// Pure TypeScript: unit-tested in Node. Calendar dates ("YYYY-MM-DD", no time zone) as the
// API sends them. Month names come in as labels (translation files), like weekday names.

/** "2026-10-21" + short month names -> "21 Oct 2026" (unambiguous: no 10/21 vs 21/10). */
export function formatLocalDate(isoDate: string, monthsShort: readonly string[]): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    return isoDate;
  }
  const [, year, month, day] = match;
  return `${Number(day)} ${monthsShort[Number(month) - 1] ?? month} ${year}`;
}

/**
 * The calendar date a JS Date shows on THIS phone ("YYYY-MM-DD"). The date picker returns a
 * Date at local midnight; toISOString() would convert to UTC and could give the day before.
 */
export function toLocalDateString(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** "YYYY-MM-DD" -> a Date at local midnight (for the date picker's starting value). */
export function fromLocalDateString(isoDate: string): Date {
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}
