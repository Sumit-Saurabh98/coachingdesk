import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api, session } from '@/api';
import type { Tokens } from './session';

/** The user as the API returns them (User.toPublicJSON). */
export interface User {
  id: string;
  name: string | null;
  locale: 'en' | 'hi';
}

/** POST /v1/auth/otp/request -> 204. The SMS goes to `phone` (any Indian format). */
export async function requestOtp(phone: string): Promise<void> {
  await api.post('/v1/auth/otp/request', { phone });
}

/**
 * POST /v1/auth/otp/verify, then the session starts (tokens saved).
 * Wrong or expired code -> ApiError with code OTP_INVALID / OTP_EXPIRED (details.attemptsLeft).
 */
export async function login(
  phone: string,
  otp: string,
): Promise<{ user: User; isNewUser: boolean }> {
  const result = await api.post<Tokens & { user: User; isNewUser: boolean }>(
    '/v1/auth/otp/verify',
    {
      phone,
      otp,
      // Shown on the server with the session (which phone, which app version logged in).
      device: {
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        appVersion: Constants.expoConfig?.version ?? 'unknown',
      },
    },
  );
  await session.start({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  return { user: result.user, isNewUser: result.isNewUser };
}

/** Log out on this phone (and end the session on the server when online). */
export function logout(): Promise<void> {
  return session.end();
}
