/**
 * The dedupe key of a result card: one per (test, student), ever. Tapping "Send results" again
 * later queues only students who weren't sent before (e.g. marks entered late).
 */
export function resultDedupeKey(
  testId: string,
  studentId: string,
  copy: 'guardian' | 'student' = 'guardian',
): string {
  return `result:${testId}:${studentId}${copy === 'student' ? ':student' : ''}`;
}

export function parseResultDedupeKey(key: string): { testId: string; studentId: string } | null {
  const [kind, testId, studentId, ...rest] = key.split(':');
  const copyOk = rest.length === 0 || (rest.length === 1 && rest[0] === 'student');
  if (kind !== 'result' || !testId || !studentId || !copyOk) {
    return null;
  }
  return { testId, studentId };
}
