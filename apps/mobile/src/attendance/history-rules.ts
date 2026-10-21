// Pure TypeScript: a student's attendance history by month, unit-tested in Node.
// Months are "YYYY-MM" text: no time zones, and they compare correctly as text.

/** "2026-10-21" -> "2026-10" */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** "2026-10" -> { from: "2026-10-01", to: "2026-10-31" } (what the API's ?from&to want). */
export function monthRange(month: string): { from: string; to: string } {
  const [year = 1970, mm = 1] = month.split('-').map(Number);
  // Day 0 of the NEXT month is the last day of this one (UTC: no time zone can shift it).
  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** "2026-01" moved by -1 -> "2025-12". */
export function shiftMonth(month: string, delta: number): string {
  const [year = 1970, mm = 1] = month.split('-').map(Number);
  const index = year * 12 + (mm - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** "2026-10" + short month names -> "Oct 2026". */
export function formatMonth(month: string, monthsShort: readonly string[]): string {
  const [year, mm = 1] = month.split('-').map(Number);
  return `${monthsShort[mm - 1] ?? mm} ${year}`;
}

/** Newest day first; on the same day, in a stable order (by batch name). */
export function newestFirst<R extends { date: string; batchName: string }>(
  records: readonly R[],
): R[] {
  return [...records].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.batchName.localeCompare(b.batchName),
  );
}
