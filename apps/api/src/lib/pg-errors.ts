/** Postgres error codes we react to (https://www.postgresql.org/docs/current/errcodes-appendix.html). */
const UNIQUE_VIOLATION = '23505';

/**
 * Did a unique constraint/index (optionally: this one) refuse the write? Drizzle wraps the driver's error, so the
 * Postgres `code` may sit one or two `.cause` levels down. Look there too (with a depth cap).
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current && current.code === UNIQUE_VIOLATION) {
      // With a constraint name: only THAT index counts (others are real bugs, e.g. a reused id).
      // postgres.js (our driver) puts the index name in `constraint_name`.
      return (
        constraint === undefined ||
        ('constraint_name' in current && current.constraint_name === constraint)
      );
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
