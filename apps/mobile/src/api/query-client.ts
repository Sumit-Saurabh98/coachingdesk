import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { ApiError } from './api-error';

/**
 * TanStack Query: caches what screens load, refetches when data may be old, retries failures.
 * One client for the whole app (created once, in the root layout).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data younger than 30 s is shown without asking the server again (e.g. going back).
      staleTime: 30_000,
      // Retry network trouble and 5xx up to 2 times, but never a 4xx: a wrong OTP or a
      // missing permission won't fix itself by asking again.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.isClientError),
    },
    mutations: {
      // Never retry writes automatically: "record payment" twice would be a real problem.
      // (Our API also has Idempotency-Key for exactly this; screens decide.)
      retry: false,
    },
  },
});

// On a phone, "the window got focus" means "the app came back to the foreground": refresh
// stale data then (a teacher reopening the app sees today's numbers, not yesterday's).
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    handleFocus(status === 'active');
  });
  return () => subscription.remove();
});
