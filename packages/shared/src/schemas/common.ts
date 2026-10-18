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
