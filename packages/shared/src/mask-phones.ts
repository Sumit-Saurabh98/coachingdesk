// An Indian mobile number anywhere in a string: optional +91 / %2B91 / 91, then 6-9 + 9 digits.
// The lookarounds stop it from matching inside longer digit runs (ids, amounts).
const PHONE_IN_TEXT = /(?<!\d)((?:\+|%2B)?91)?([6-9]\d)(\d{5})(\d{3})(?!\d)/gi;

/**
 * Masks phone numbers in text that goes to logs (AGENTS rule 9), the same way
 * PhoneNumber.masked() does: 9812345678 -> 98XXXXX678.
 * Needed for URLs like /guardians/9812345678/opt-in, which Fastify logs on every request.
 */
export function maskPhones(text: string): string {
  return text.replace(
    PHONE_IN_TEXT,
    (_match, prefix: string | undefined, first: string, _middle, last: string) =>
      `${prefix ?? ''}${first}XXXXX${last}`,
  );
}
