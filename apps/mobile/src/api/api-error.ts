import type { ErrorCode } from '@coachingdesk/shared';

/**
 * Every way a call to our API can fail, as ONE error type. Screens only ever handle this:
 *  - 'http':    the server answered with an error (4xx/5xx) and its code, e.g. OTP_INVALID
 *  - 'network': no answer at all (offline, wrong address, server down)
 *  - 'timeout': the server took too long (very slow mobile data)
 */
export type ApiErrorKind = 'http' | 'network' | 'timeout';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null; // HTTP status for 'http', else null
  // The API's error code (API_DOCS "Common error codes"). A string, not just ErrorCode:
  // an older app talking to a newer server may receive a code it doesn't know yet.
  readonly code: ErrorCode | (string & {}) | null;
  readonly details: Record<string, unknown>;
  // Matches the server's log line: support can find exactly what happened.
  readonly requestId: string | null;

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    status?: number | null;
    code?: string | null;
    details?: Record<string, unknown>;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  /** 4xx: the request itself is wrong (bad OTP, not allowed...). Retrying won't help. */
  get isClientError(): boolean {
    return this.kind === 'http' && this.status !== null && this.status >= 400 && this.status < 500;
  }
}
