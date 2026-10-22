import { describe, expect, it } from 'vitest';
import { FixedClock, SequentialIdGenerator, TERMS_VERSION } from '@coachingdesk/shared';
import { InMemoryTermsAcceptanceRepository } from '../terms-acceptance.repository';
import { TermsService } from '../terms.service';

function service() {
  return new TermsService(
    new InMemoryTermsAcceptanceRepository(),
    new SequentialIdGenerator(),
    new FixedClock(new Date('2026-10-23T10:00:00Z')),
  );
}

describe('TermsService (KB #54)', () => {
  it('a new user has not accepted; accepting the current version counts', async () => {
    const terms = service();
    expect(await terms.hasAcceptedCurrent('u1')).toBe(false);
    await terms.accept('u1', TERMS_VERSION);
    expect(await terms.hasAcceptedCurrent('u1')).toBe(true);
    expect(await terms.hasAcceptedCurrent('u2')).toBe(false);
  });

  it('an old (or made-up) version is refused: 409 TERMS_OUTDATED with the current one', async () => {
    const terms = service();
    await expect(terms.accept('u1', '2020-01-01')).rejects.toMatchObject({
      code: 'TERMS_OUTDATED',
      details: { currentVersion: TERMS_VERSION },
    });
    expect(await terms.hasAcceptedCurrent('u1')).toBe(false);
  });

  it('deleting the account forgets the acceptance', async () => {
    const terms = service();
    await terms.accept('u1', TERMS_VERSION);
    await terms.deleteAllFor('u1');
    expect(await terms.hasAcceptedCurrent('u1')).toBe(false);
  });
});
