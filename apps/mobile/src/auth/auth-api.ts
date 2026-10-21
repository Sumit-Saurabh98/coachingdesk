import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api, session } from '@/api';
import type { MyInstitute } from '@/institutes/current-institute';
import { usePreferences } from '@/stores/preferences';
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
  // Remembered on this phone only (MMKV): next time the login screen starts with it filled in.
  usePreferences.getState().setLastPhone(phone);
  return { user: result.user, isNewUser: result.isNewUser };
}

/** GET /v1/me -> the user and their institutes. */
export function getMe(signal?: AbortSignal): Promise<{ user: User; institutes: MyInstitute[] }> {
  return api.get('/v1/me', { signal });
}

/** PATCH /v1/me { name } -> the updated user. */
export async function updateName(name: string): Promise<User> {
  const result = await api.patch<{ user: User }>('/v1/me', { name });
  return result.user;
}

/** Log out on this phone (and end the session on the server when online). */
export function logout(): Promise<void> {
  return session.end();
}

/**
 * DELETE /v1/me: the account is deleted (every device logged out), then this phone forgets the
 * login. 409 OWNER_OF_INSTITUTES while the user still owns an institute.
 */
export async function deleteAccount(): Promise<void> {
  await api.delete('/v1/me');
  await session.end();
}
