import { describe, expect, it } from 'vitest';
import { FixedClock, SequentialIdGenerator } from '@coachingdesk/shared';
import { JwtAccessTokens } from '../access-tokens';
import { InMemoryRefreshTokenRepository } from '../refresh-token.repository';
import { SessionService } from '../session.service';

function setup() {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const accessTokens = new JwtAccessTokens('jwt-test-secret-that-is-at-least-32-chars', clock);
  const sessions = new SessionService({
    refreshTokens: new InMemoryRefreshTokenRepository(),
    accessTokens,
    ids: new SequentialIdGenerator(),
    clock,
  });
  return { sessions, accessTokens, clock };
}

describe('SessionService', () => {
  it('starts a session with an access token for the user', async () => {
    const { sessions, accessTokens } = setup();

    const tokens = await sessions.start('user-1', null);

    expect(await accessTokens.verify(tokens.accessToken)).toEqual({ userId: 'user-1' });
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rotates: refresh returns a NEW refresh token', async () => {
    const { sessions } = setup();
    const first = await sessions.start('user-1', null);

    const second = await sessions.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(sessions.refresh(second.refreshToken)).resolves.toBeDefined();
  });

  it('detects reuse of an old token and logs the whole session out', async () => {
    const { sessions } = setup();
    const first = await sessions.start('user-1', null);
    const second = await sessions.refresh(first.refreshToken);

    // An attacker replays the stolen FIRST token...
    await expect(sessions.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    // ...so even the real user's newest token is now dead. They must log in again.
    await expect(sessions.refresh(second.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('lets exactly one of two simultaneous refreshes win, then kills the session', async () => {
    const { sessions } = setup();
    const first = await sessions.start('user-1', null);

    const results = await Promise.allSettled([
      sessions.refresh(first.refreshToken),
      sessions.refresh(first.refreshToken),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('expires 90 days after the last refresh (sliding)', async () => {
    const { sessions, clock } = setup();
    const first = await sessions.start('user-1', null);

    clock.advanceMinutes(80 * 24 * 60); // day 80: still fine, and the refresh extends the session
    const second = await sessions.refresh(first.refreshToken);

    clock.advanceMinutes(80 * 24 * 60); // day 160, but only 80 days since the last refresh
    const third = await sessions.refresh(second.refreshToken);

    clock.advanceMinutes(90 * 24 * 60); // 90 days of inactivity
    await expect(sessions.refresh(third.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects an unknown token', async () => {
    const { sessions } = setup();
    await expect(sessions.refresh('x'.repeat(43))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('logout ends the session; logging out again is harmless', async () => {
    const { sessions } = setup();
    const tokens = await sessions.start('user-1', null);

    await sessions.logout(tokens.refreshToken);
    await expect(sessions.logout(tokens.refreshToken)).resolves.toBeUndefined();

    await expect(sessions.refresh(tokens.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});
