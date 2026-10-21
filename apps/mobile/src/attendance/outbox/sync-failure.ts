// Pure TypeScript: why the server refused a save, in words for the teacher (API_DOCS §7).
import type { StoredError } from './attendance-outbox';

export type SyncFailureKey =
  | 'register.failedDate'
  | 'register.failedNotEnrolled'
  | 'register.failedArchived'
  | 'register.failedNoBatch';

/** The attendance-specific reason, or null to fall back to the general error message. */
export function syncFailureKey(error: StoredError): SyncFailureKey | null {
  const field = error.details.field;
  if (error.status === 422 && field === 'date') {
    return 'register.failedDate'; // more than 7 days back (or after tomorrow)
  }
  if (error.status === 422 && field === 'records') {
    return 'register.failedNotEnrolled';
  }
  if (error.status === 409) {
    return 'register.failedArchived';
  }
  if (error.status === 404) {
    return 'register.failedNoBatch';
  }
  return null;
}
