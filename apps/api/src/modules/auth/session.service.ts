import { createHash, randomBytes } from 'node:crypto';
import { AppError, type Clock, type IdGenerator } from '@coachingdesk/shared';
import type { JwtAccessTokens } from './access-tokens';
import type {
  DeviceInfo,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from './refresh-token.repository';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionServiceDeps {
  refreshTokens: RefreshTokenRepository;
  accessTokens: JwtAccessTokens;
  ids: IdGenerator;
  clock: Clock;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Refresh-token sessions (FR-1.2, docs/ARCHITECTURE.md §9):
 * - random 256-bit token, only its SHA-256 hash stored
 * - ROTATED on every use: each refresh returns a new token and retires the old one
 * - REUSE DETECTION: presenting a retired token means it was stolen (or replayed),
 *   so the whole family (every token from that login) is revoked
 * - sliding 90 days: each refresh extends the session, so active users stay logged in
 */
export class SessionService {
  constructor(
    private readonly deps: SessionServiceDeps,
    private readonly refreshTokenTtlDays = 90,
  ) {}

  /** A new login: new family, first refresh token, first access token. */
  async start(userId: string, deviceInfo: DeviceInfo | null): Promise<SessionTokens> {
    const { token, record } = this.newRefreshToken(userId, this.deps.ids.next(), deviceInfo);
    await this.deps.refreshTokens.create(record);
    return { accessToken: await this.deps.accessTokens.issue(userId), refreshToken: token };
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const now = this.deps.clock.now();
    const current = await this.deps.refreshTokens.findByHash(hashToken(refreshToken));
    if (!current) {
      throw sessionExpired();
    }

    // Already used or revoked: someone is replaying an old token. Kill the whole login.
    if (current.revokedAt !== null || current.replacedBy !== null) {
      await this.deps.refreshTokens.revokeFamily(current.familyId, now);
      throw sessionExpired();
    }

    if (now.getTime() >= current.expiresAt.getTime()) {
      throw sessionExpired();
    }

    const { token, record } = this.newRefreshToken(
      current.userId,
      current.familyId,
      current.deviceInfo,
    );
    const rotated = await this.deps.refreshTokens.rotate(current.id, record, now);
    if (!rotated) {
      // We lost a race: the same token was used twice at the same moment. Treat it as reuse.
      await this.deps.refreshTokens.revokeFamily(current.familyId, now);
      throw sessionExpired();
    }

    return { accessToken: await this.deps.accessTokens.issue(current.userId), refreshToken: token };
  }

  /** Ends this login on every device that shares it. Unknown tokens are ignored (logout is idempotent). */
  async logout(refreshToken: string): Promise<void> {
    const current = await this.deps.refreshTokens.findByHash(hashToken(refreshToken));
    if (current) {
      await this.deps.refreshTokens.revokeFamily(current.familyId, this.deps.clock.now());
    }
  }

  private newRefreshToken(
    userId: string,
    familyId: string,
    deviceInfo: DeviceInfo | null,
  ): { token: string; record: RefreshTokenRecord } {
    // 32 random bytes = 256 bits: unguessable. base64url = safe in JSON and URLs.
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      record: {
        id: this.deps.ids.next(),
        userId,
        tokenHash: hashToken(token),
        familyId,
        expiresAt: new Date(this.deps.clock.now().getTime() + this.refreshTokenTtlDays * DAY_MS),
        revokedAt: null,
        replacedBy: null,
        deviceInfo,
      },
    };
  }
}

// Plain SHA-256 (no secret) is enough here, unlike OTPs: a 256-bit random token can't be
// brute-forced, so there's nothing to "pre-compute". The hash just keeps a DB leak from
// handing out working tokens.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionExpired(): AppError {
  return new AppError('UNAUTHENTICATED', 'Your session has expired. Please log in again.');
}
