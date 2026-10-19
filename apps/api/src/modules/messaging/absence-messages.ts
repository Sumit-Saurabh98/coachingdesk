/**
 * The dedupe key of an absence alert: one per (session, student). It's also how the worker
 * finds the student again when re-checking "still absent?" before sending.
 */
export function absenceDedupeKey(sessionId: string, studentId: string): string {
  return `absence:${sessionId}:${studentId}`;
}

export function parseAbsenceDedupeKey(
  key: string,
): { sessionId: string; studentId: string } | null {
  const [kind, sessionId, studentId, ...rest] = key.split(':');
  if (kind !== 'absence' || !sessionId || !studentId || rest.length > 0) {
    return null;
  }
  return { sessionId, studentId };
}
