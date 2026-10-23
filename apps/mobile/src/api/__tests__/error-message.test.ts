import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api-error';
import { errorMessage } from '../error-message';

// A fake t(): returns the key and options, so we can see WHICH text was chosen.
const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction;

const http = (code: string, details: Record<string, unknown> = {}, status = 400) =>
  new ApiError({ kind: 'http', status, code, message: 'server text', details });

describe('errorMessage', () => {
  it.each([
    [new ApiError({ kind: 'network', message: 'x' }), 'errors.network'],
    [new ApiError({ kind: 'timeout', message: 'x' }), 'errors.timeout'],
    [http('OTP_INVALID', { attemptsLeft: 3 }), 'errors.otpInvalid {"count":3}'],
    [http('OTP_INVALID', { attemptsLeft: 0 }), 'errors.otpLocked'],
    [http('OTP_EXPIRED'), 'errors.otpExpired'],
    [http('RATE_LIMITED', { retryAfterSeconds: 61 }, 429), 'errors.rateLimited {"count":2}'],
    [http('RATE_LIMITED', { retryAfterSeconds: 5 }, 429), 'errors.rateLimited {"count":1}'],
    [http('PLAN_LIMIT_REACHED', { limit: 25 }, 402), 'errors.planLimit {"limit":25}'],
    [http('VALIDATION_FAILED', {}, 422), 'errors.validation'],
    [http('SERVICE_UNAVAILABLE', {}, 503), 'errors.unavailable'],
    [http('INSTITUTE_PENDING_DELETION', {}, 409), 'errors.pendingDeletion'],
    [http('OWNER_OF_INSTITUTES', {}, 409), 'errors.ownerOfInstitutes'],
    [http('TERMS_OUTDATED', {}, 409), 'errors.termsOutdated'],
    [http('SOMETHING_NEW_FROM_A_NEWER_SERVER'), 'errors.generic'],
    [new Error('not ours'), 'errors.generic'],
  ])('%s -> %s', (error, expected) => {
    expect(errorMessage(t, error)).toBe(expected);
  });

  it("never shows the server's own (English, developer) message", () => {
    expect(errorMessage(t, http('OTP_EXPIRED'))).not.toContain('server text');
  });
});
