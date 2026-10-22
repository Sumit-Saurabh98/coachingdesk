import { AppError, type Clock, type IdGenerator, TERMS_VERSION } from '@coachingdesk/shared';
import type { TermsAcceptanceRepository } from './terms-acceptance.repository';

/**
 * Who agreed to which Terms of Service and Privacy Policy, and when (KB #54). Only the CURRENT
 * version can be accepted: an app showing older terms gets TERMS_OUTDATED and must show the new
 * ones first, so nobody "agrees" to text they never saw.
 */
export class TermsService {
  constructor(
    private readonly acceptances: TermsAcceptanceRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Throws TERMS_OUTDATED (409) unless `version` is the current one. No I/O: check it first. */
  assertCurrent(version: string): void {
    if (version !== TERMS_VERSION) {
      throw new AppError(
        'TERMS_OUTDATED',
        'The terms have changed: please read and accept them again',
        {
          currentVersion: TERMS_VERSION,
        },
      );
    }
  }

  async accept(userId: string, version: string): Promise<void> {
    this.assertCurrent(version);
    await this.acceptances.record({
      id: this.ids.next(),
      userId,
      version,
      acceptedAt: this.clock.now(),
    });
  }

  /** Has this user accepted the CURRENT terms? false = the app asks them to. */
  async hasAcceptedCurrent(userId: string): Promise<boolean> {
    return (await this.acceptances.latestVersion(userId)) === TERMS_VERSION;
  }

  async deleteAllFor(userId: string): Promise<void> {
    await this.acceptances.deleteAllFor(userId);
  }
}
