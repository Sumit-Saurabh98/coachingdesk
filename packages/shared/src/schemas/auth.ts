import { z } from 'zod';
import { zPhoneIN } from './common';

export const RequestOtpBody = z.object({
  phone: zPhoneIN,
});

export const VerifyOtpBody = z.object({
  phone: zPhoneIN,
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

// The TypeScript type is DERIVED from the schema: change the schema and the type follows.
// After parse(), body.phone is a PhoneNumber, not a string.
export type RequestOtpBody = z.infer<typeof RequestOtpBody>;
export type VerifyOtpBody = z.infer<typeof VerifyOtpBody>;
