import { z } from 'zod';
import { zPhoneIN } from './common';

export const RequestOtpBody = z.object({
  phone: zPhoneIN,
});

// Optional info about the phone/app logging in; stored with the session (refresh_tokens.device_info).
export const DeviceInfoSchema = z.object({
  platform: z.enum(['android', 'ios', 'web']),
  appVersion: z.string().min(1).max(32),
});

export const VerifyOtpBody = z.object({
  phone: zPhoneIN,
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  device: DeviceInfoSchema.optional(),
});

// Our refresh tokens are 43 characters (32 bytes, base64url). The bounds just reject garbage early.
export const RefreshTokenBody = z.object({
  refreshToken: z.string().min(20).max(200),
});

// The TypeScript type is DERIVED from the schema: change the schema and the type follows.
// After parse(), body.phone is a PhoneNumber, not a string.
export type RequestOtpBody = z.infer<typeof RequestOtpBody>;
export type VerifyOtpBody = z.infer<typeof VerifyOtpBody>;
export type RefreshTokenBody = z.infer<typeof RefreshTokenBody>;
