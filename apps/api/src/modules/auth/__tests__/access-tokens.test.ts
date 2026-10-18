import { describe, expect, it } from 'vitest';
import { FixedClock } from '@coachingdesk/shared';
import { JwtAccessTokens } from '../access-tokens';

const SECRET = 'jwt-test-secret-that-is-at-least-32-chars';

describe('JwtAccessTokens', () => {
  const setup = () => {
    const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
    return { clock, tokens: new JwtAccessTokens(SECRET, clock) };
  };

  it('issues a token that verifies back to the same user', async () => {
    const { tokens } = setup();
    const token = await tokens.issue('user-1');
    expect(await tokens.verify(token)).toEqual({ userId: 'user-1' });
  });

  it('expires after 15 minutes', async () => {
    const { tokens, clock } = setup();
    const token = await tokens.issue('user-1');

    clock.advanceMinutes(14);
    await expect(tokens.verify(token)).resolves.toEqual({ userId: 'user-1' });

    clock.advanceMinutes(1);
    await expect(tokens.verify(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a token signed with a different secret', async () => {
    const { clock, tokens } = setup();
    const forged = await new JwtAccessTokens(
      'another-secret-that-is-also-32-chars-long',
      clock,
    ).issue('user-1');
    await expect(tokens.verify(forged)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a token whose payload was edited', async () => {
    const { tokens } = setup();
    const [header, , signature] = (await tokens.issue('user-1')).split('.');
    const fakePayload = Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url');
    await expect(tokens.verify(`${header}.${fakePayload}.${signature}`)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects garbage', async () => {
    const { tokens } = setup();
    await expect(tokens.verify('not-a-jwt')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a short secret', () => {
    expect(() => new JwtAccessTokens('short', new FixedClock(new Date()))).toThrow();
  });
});
