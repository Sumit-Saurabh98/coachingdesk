/**
 * Where unexpected errors (our bugs) are sent, so someone finds out (NFR-11). Business errors
 * (AppError: wrong OTP, plan limit…) are NOT reported: they're expected answers, not bugs.
 *
 * The context holds ids only (random UUIDs), never phone numbers, names or request bodies:
 * error reports leave India (AGENTS rule 9, DPDP).
 */
export interface ErrorContext {
  /** API: the request id the user sees in the error response; find the log line with it. */
  requestId?: string;
  /** API: "GET /v1/institutes/:instituteId/students" (the route pattern, not the real URL). */
  route?: string;
  userId?: string;
  instituteId?: string;
  /** Worker: which job failed, e.g. "outbox", "billing". */
  job?: string;
}

export interface ErrorReporter {
  /** Never throws: reporting an error must not cause another one. */
  capture(error: unknown, context?: ErrorContext): void;
  /** Sends what's queued before the process exits. */
  flush(timeoutMs: number): Promise<void>;
}

/** No SENTRY_DSN (local development, tests): errors are only logged, as before. */
export class NoopErrorReporter implements ErrorReporter {
  capture(_error: unknown, _context?: ErrorContext): void {}
  async flush(_timeoutMs: number): Promise<void> {}
}

/** Tests only: remembers what was reported. */
export class RecordingErrorReporter implements ErrorReporter {
  readonly captured: Array<{ error: unknown; context: ErrorContext }> = [];

  capture(error: unknown, context: ErrorContext = {}): void {
    this.captured.push({ error, context });
  }

  async flush(): Promise<void> {}
}
