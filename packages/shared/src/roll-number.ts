/**
 * Roll numbers are TEXT ("12", "12A", "B-07"), compared the way people read them: number parts
 * as numbers (2 before 10), the rest as letters ignoring case. Students without one come last.
 * One comparator for the API (registers, marks sheets) and the app, so both order alike.
 */
export function compareRollNumbers(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  const left = chunks(a);
  const right = chunks(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i] ?? '';
    const y = right[i] ?? '';
    const bothNumbers = /^\d/.test(x) && /^\d/.test(y);
    const order = bothNumbers
      ? Number(x) - Number(y) || x.length - y.length // "7" before "07" if equal in value
      : x.localeCompare(y);
    if (order !== 0) {
      return order;
    }
  }
  return left.length - right.length;
}

/** "B-07a" -> ["b", "-", "07", "a"] (lower case; digit runs kept together). */
function chunks(roll: string): string[] {
  return roll.toLowerCase().match(/\d+|\D+/g) ?? [];
}

/** Roster order: roll number (natural), then name. */
export function compareByRollThenName(
  a: { rollNumber: string | null; name: string },
  b: { rollNumber: string | null; name: string },
): number {
  return (
    compareRollNumbers(a.rollNumber, b.rollNumber) ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
}
