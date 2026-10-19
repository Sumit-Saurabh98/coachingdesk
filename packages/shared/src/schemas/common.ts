import { z } from 'zod';
import { PhoneNumber } from '../phone-number';

/**
 * Zod field for an Indian mobile number: takes a string, gives you a PhoneNumber.
 * The validation rules live in PhoneNumber (Step 3). Zod just calls them,
 * so there's one source of truth for "what is a valid phone".
 */
export const zPhoneIN = z.string().transform((value, ctx) => {
  try {
    return PhoneNumber.parse(value);
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid phone number',
    });
    return z.NEVER; // tells Zod "validation failed", with the issue added above
  }
});

/**
 * Zod field for an amount of money in paise (AGENTS rule 2).
 * Stays a plain number on the wire (JSON has no Money type); the entity turns it into Money.
 *   150000  -> ok (Rs 1,500)
 *   1500.5  -> rejected: half a paisa doesn't exist, and floats are how money bugs start
 *   -100    -> rejected: a fee is never negative
 *   2**53   -> rejected: past MAX_SAFE_INTEGER, JS numbers silently lose precision
 */
export const zMoneyPaise = z
  .number()
  .refine(Number.isSafeInteger, { message: 'Amount must be a whole number of paise' })
  .refine((paise) => paise >= 0, { message: 'Amount cannot be negative' });
