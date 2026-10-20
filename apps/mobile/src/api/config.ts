import Constants from 'expo-constants';

/** The API port in local development (PORT in the repo's .env). */
const DEV_API_PORT = 3001;

/**
 * Where the API is.
 *  1. EXPO_PUBLIC_API_URL, when set (staging/production builds MUST set it).
 *  2. In development: the same computer that serves the app. On the phone, "localhost" is the
 *     PHONE, not your Mac, so we take the Mac's address from the dev server the app was
 *     loaded from (hostUri, e.g. "192.168.1.5:8081") and use the API's port instead.
 */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) {
    return fromEnv;
  }
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (__DEV__ && host) {
    return `http://${host}:${DEV_API_PORT}`;
  }
  throw new Error('EXPO_PUBLIC_API_URL is not set: release builds need the API address');
}
