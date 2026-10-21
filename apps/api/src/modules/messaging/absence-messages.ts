/**
 * The dedupe key of an absence alert: one per (session, student). It's also how the worker
 * finds the student again when re-checking "still absent?" before sending.
 */
export function absenceDedupeKey(
  sessionId: string,
  studentId: string,
  copy: 'guardian' | 'student' = 'guardian',
): string {
  // The copy to the student's own number (KB #50) gets its own key: queued once, separately.
  return `absence:${sessionId}:${studentId}${copy === 'student' ? ':student' : ''}`;
}

export function parseAbsenceDedupeKey(
  key: string,
): { sessionId: string; studentId: string } | null {
  const [kind, sessionId, studentId, ...rest] = key.split(':');
  const copyOk = rest.length === 0 || (rest.length === 1 && rest[0] === 'student');
  if (kind !== 'absence' || !sessionId || !studentId || !copyOk) {
    return null;
  }
  return { sessionId, studentId };
}
