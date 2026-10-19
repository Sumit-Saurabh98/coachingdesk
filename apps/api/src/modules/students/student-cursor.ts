import { AppError } from '@coachingdesk/shared';
import { isUuid } from '../../http/route-params';
import type { StudentCursor } from './student.repository';

/**
 * The cursor the API hands out is OPAQUE to clients: base64url of [nameKey, id].
 * Clients just copy nextCursor into the next request; we're free to change the format later.
 */
export function encodeCursor(cursor: StudentCursor): string {
  return Buffer.from(JSON.stringify([cursor.nameKey, cursor.id])).toString('base64url');
}

/** A tampered or truncated cursor is the client's mistake: 422, never a 500 from Postgres. */
export function decodeCursor(text: string): StudentCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      isUuid(value[1])
    ) {
      return { nameKey: value[0], id: value[1] };
    }
  } catch {
    // fall through to the 422 below
  }
  throw new AppError('VALIDATION_FAILED', 'Invalid cursor', { field: 'cursor' });
}
