import { AppError, type Clock } from '@coachingdesk/shared';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'coachingdesk';
const AUDIENCE = 'coachingdesk-api';

/**
 * Short-lived access tokens (JWT, HS256, 15 min by default; docs/ARCHITECTURE.md §9).
 * Stateless: verifying needs no database lookup, which is why they must expire quickly.
 * A plain class, no interface: there's one way we sign tokens.
 */
export class JwtAccessTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly clock: Clock,
    private readonly ttlSeconds = 15 * 60,
  ) {
    if (secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }
    this.key = new TextEncoder().encode(secret);
  }

  async issue(userId: string): Promise<string> {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + this.ttlSeconds)
      .sign(this.key);
  }

  /** Returns the user id, or throws UNAUTHENTICATED for anything wrong (expired, forged, garbage). */
  async verify(token: string): Promise<{ userId: string }> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'], // never accept "alg: none" or a different algorithm
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: this.clock.now(), // our Clock decides "now", so expiry is testable
      });
      if (!payload.sub) {
        throw new Error('missing subject');
      }
      return { userId: payload.sub };
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please log in again.');
    }
  }
}
