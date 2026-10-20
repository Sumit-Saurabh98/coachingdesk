// The app's ONE session and API client (the app's "composition root" for talking to the server).
// Screens import { api } from '@/api'.
import { SecureTokenStore } from '@/auth/secure-token-store';
import { Session } from '@/auth/session';
import { ApiClient } from './api-client';
import { apiBaseUrl } from './config';
import { queryClient } from './query-client';

const baseUrl = apiBaseUrl();

// The session gets its OWN plain client: its refresh call must never trigger another refresh.
export const session = new Session(new ApiClient({ baseUrl }), new SecureTokenStore());

// Every other call: with the access token, renewed automatically when it expires.
export const api = new ApiClient({
  baseUrl,
  getAccessToken: () => session.accessToken,
  onUnauthorized: () => session.refresh(),
});

// Whenever the session ends (logout, or the server ended it), forget every cached answer:
// the next person to log in on this phone must never see the previous user's data.
session.subscribe((status) => {
  if (status === 'signedOut') {
    queryClient.clear();
  }
});

export { ApiError } from './api-error';
export { queryClient };
