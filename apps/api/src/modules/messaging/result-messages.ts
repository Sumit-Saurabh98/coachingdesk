/**
 * The dedupe key of a result card: one per (test, student), ever. Tapping "Send results" again
 * later queues only students who weren't sent before (e.g. marks entered late).
 */
export function resultDedupeKey(testId: string, studentId: string): string {
  return `result:${testId}:${studentId}`;
}

export function parseResultDedupeKey(key: string): { testId: string; studentId: string } | null {
  const [kind, testId, studentId, ...rest] = key.split(':');
  if (kind !== 'result' || !testId || !studentId || rest.length > 0) {
    return null;
  }
  return { testId, studentId };
}
