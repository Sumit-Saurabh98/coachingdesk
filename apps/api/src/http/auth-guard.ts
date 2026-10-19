import { AppError } from '@coachingdesk/shared';
import type { FastifyRequest } from 'fastify';
import type { JwtAccessTokens } from '../modules/auth/access-tokens';

export interface AuthContext {
  userId: string;
}

// Module augmentation: teach TypeScript that every FastifyRequest has an `auth` field.
// null = "not checked / not logged in". The guard fills it in.
declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

// "Bearer " followed by token characters only. Anything else (Basic auth, an empty value,
// spaces, a missing header) doesn't match and gets a 401.
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/**
 * Creates the guard. It's a factory function: it needs JwtAccessTokens, which we pass in
 * (dependency injection, the same idea as constructors) instead of importing a global.
 * Usage on a route: app.get('/v1/me', { preHandler: requireAuth }, handler)
 */
export function createAuthGuard(accessTokens: JwtAccessTokens) {
  return async function requireAuth(request: FastifyRequest): Promise<void> {
    const match = BEARER.exec(request.headers.authorization ?? '');
    if (!match?.[1]) {
      throw new AppError('UNAUTHENTICATED', 'Please log in.');
    }
    // verify() throws UNAUTHENTICATED for expired, forged or garbage tokens (Step 8).
    request.auth = await accessTokens.verify(match[1]);
  };
}

/**
 * Controllers call this to get the logged-in user's id.
 * If a route forgot the guard, that's a BUG in our code, not a user problem: a plain Error
 * (500, and logged) makes it obvious in tests instead of silently returning "please log in".
 */
export function currentUserId(request: FastifyRequest): string {
  if (!request.auth) {
    throw new Error('currentUserId() called on a route without the requireAuth guard');
  }
  return request.auth.userId;
}
