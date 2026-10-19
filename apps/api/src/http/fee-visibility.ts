import type { MemberRole } from '../modules/institutes/institute.repository';

/**
 * REQUIREMENTS FR-1.4: a teacher has NO access to fees; owner and staff do.
 * Every response that carries money for a member goes through this one check, so the rule
 * lives in one place (and a test per endpoint proves it).
 */
export function canSeeFees(role: MemberRole): boolean {
  return role === 'owner' || role === 'staff';
}

/** Removes the listed money fields from a response object (for members who can't see fees). */
export function withoutFees<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}
