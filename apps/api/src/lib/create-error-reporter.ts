import {
  type ErrorReporter,
  NoopErrorReporter,
  type SentryOptions,
  SentryErrorReporter,
} from '@coachingdesk/providers';

/** Sentry when SENTRY_DSN is set; otherwise errors are only logged (local development). */
export function createErrorReporter(
  config: { SENTRY_DSN?: string; NODE_ENV: string; APP_RELEASE?: string },
  service: SentryOptions['service'],
): ErrorReporter {
  if (!config.SENTRY_DSN) {
    return new NoopErrorReporter();
  }
  return new SentryErrorReporter({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    release: config.APP_RELEASE,
    service,
  });
}
