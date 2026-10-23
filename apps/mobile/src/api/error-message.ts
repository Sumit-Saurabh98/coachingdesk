import type { TFunction } from 'i18next';
import { ApiError } from './api-error';

/**
 * Any error from an API call -> one sentence for the user, in THEIR language.
 * We never show the server's own message: it's English only, and written for developers.
 * Codes not listed here fall back to a generic "something went wrong".
 */
export function errorMessage(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) {
    return t('errors.generic');
  }
  if (error.kind === 'network') {
    return t('errors.network');
  }
  if (error.kind === 'timeout') {
    return t('errors.timeout');
  }
  switch (error.code) {
    case 'OTP_INVALID': {
      const left = numberDetail(error, 'attemptsLeft');
      return left === 0 || left === null
        ? t('errors.otpLocked')
        : t('errors.otpInvalid', { count: left });
    }
    case 'OTP_EXPIRED':
      return t('errors.otpExpired');
    case 'RATE_LIMITED': {
      // The server says how long to wait in seconds; people think in minutes.
      const seconds = numberDetail(error, 'retryAfterSeconds') ?? 60;
      return t('errors.rateLimited', { count: Math.max(1, Math.ceil(seconds / 60)) });
    }
    case 'PLAN_LIMIT_REACHED': {
      // details.limit: how many the plan allows (e.g. 25 active students on Free).
      const limit = numberDetail(error, 'limit');
      return limit === null ? t('errors.generic') : t('errors.planLimit', { limit });
    }
    case 'VALIDATION_FAILED':
      return t('errors.validation');
    case 'SERVICE_UNAVAILABLE':
      return t('errors.unavailable');
    case 'INSTITUTE_PENDING_DELETION':
      return t('errors.pendingDeletion');
    case 'OWNER_OF_INSTITUTES':
      return t('errors.ownerOfInstitutes');
    case 'TERMS_OUTDATED':
      // The server has newer terms than this app shows: only an app update can show them.
      return t('errors.termsOutdated');
    default:
      return t('errors.generic');
  }
}

function numberDetail(error: ApiError, key: string): number | null {
  const value = error.details[key];
  return typeof value === 'number' ? value : null;
}
