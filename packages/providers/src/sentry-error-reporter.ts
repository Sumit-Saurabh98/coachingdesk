import * as Sentry from '@sentry/node';
import { maskPhones } from '@coachingdesk/shared';
import type { ErrorContext, ErrorReporter } from './error-reporter';

export interface SentryOptions {
  dsn: string;
  environment: string;
  /** The deployed version (e.g. the git commit), so an error points at the right code. */
  release?: string;
  /** "api" or "worker": both report to one project, told apart by this tag. */
  service: 'api' | 'worker';
}

/**
 * Error tracking with Sentry (TECH_STACK). Errors only: no tracing, no automatic
 * instrumentation, no request data. Anything that looks like a phone number is masked before
 * the event leaves the server.
 */
export class SentryErrorReporter implements ErrorReporter {
  constructor(options: SentryOptions) {
    Sentry.init({
      dsn: options.dsn,
      environment: options.environment,
      release: options.release,
      // Collect nothing about the user or the request: no user info, cookies, headers,
      // bodies or query parameters (they can hold phone numbers and tokens).
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
      // Errors only: the default integrations instrument http, databases… (tracing we don't use)
      // and add request data. We pass what we want ourselves.
      defaultIntegrations: false,
      integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
      tracesSampleRate: 0,
      initialScope: { tags: { service: options.service } },
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: () => null, // breadcrumbs can carry URLs and log lines: none
    });
  }

  capture(error: unknown, context: ErrorContext = {}): void {
    try {
      Sentry.withScope((scope) => {
        const { userId, ...tags } = context;
        for (const [key, value] of Object.entries(tags)) {
          if (value !== undefined) {
            scope.setTag(key, value);
          }
        }
        if (userId !== undefined) {
          scope.setUser({ id: userId }); // the id only: how many users an error hits
        }
        Sentry.captureException(error);
      });
    } catch {
      // Reporting must never break the request or the job that failed.
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    await Sentry.flush(timeoutMs);
  }
}

/** Masks phone numbers in everything a Sentry event can carry as text. */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  delete event.request; // no URL, headers, cookies or body
  if (event.message) {
    event.message = maskPhones(event.message);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = maskPhones(exception.value);
    }
  }
  if (event.extra) {
    event.extra = JSON.parse(maskPhones(JSON.stringify(event.extra))) as typeof event.extra;
  }
  return event;
}
