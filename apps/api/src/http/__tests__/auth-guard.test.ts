import { afterEach, describe, expect, it } from 'vitest';
import { FixedClock } from '@coachingdesk/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { JwtAccessTokens } from '../../modules/auth/access-tokens';
import { createAuthGuard, currentUserId } from '../auth-guard';
import { registerErrorHandler } from '../error-handler';

let app: FastifyInstance;

function setup() {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const accessTokens = new JwtAccessTokens('jwt-test-secret-that-is-at-least-32-chars', clock);
  const requireAuth = createAuthGuard(accessTokens);

  app = Fastify();
  // Fastify wants every request field declared up front (keeps requests fast and same-shaped).
  app.decorateRequest('auth', null);
  registerErrorHandler(app);
  app.get('/protected', { preHandler: requireAuth }, async (request) => ({
    userId: currentUserId(request),
  }));
  app.get('/forgot-the-guard', async (request) => ({ userId: currentUserId(request) }));

  return { clock, accessTokens };
}

afterEach(async () => {
  await app.close();
});

const get = (url: string, authorization?: string) =>
  app.inject({ method: 'GET', url, headers: authorization ? { authorization } : {} });

describe('requireAuth', () => {
  it('lets a valid access token through and exposes the user id', async () => {
    const { accessTokens } = setup();
    const token = await accessTokens.issue('user-1');

    const response = await get('/protected', `Bearer ${token}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: 'user-1' });
  });

  // it.each with [name, value] pairs: one test per bad header, each named in the output.
  it.each([
    ['no header', undefined],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['empty bearer', 'Bearer '],
    ['garbage token', 'Bearer not.a.jwt'],
  ])('returns 401 for %s', async (_case, header) => {
    setup();
    const response = await get('/protected', header);
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 once the token has expired', async () => {
    const { accessTokens, clock } = setup();
    const token = await accessTokens.issue('user-1');

    clock.advanceMinutes(15);

    expect((await get('/protected', `Bearer ${token}`)).statusCode).toBe(401);
  });

  it('fails loudly (500) if a route reads the user without the guard', async () => {
    setup();
    expect((await get('/forgot-the-guard')).statusCode).toBe(500);
  });
});
