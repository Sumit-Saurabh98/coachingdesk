import type { Db } from '@coachingdesk/db';
import { refreshTokens } from '@coachingdesk/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  DeviceInfo,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from './refresh-token.repository';

type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: Db) {}

  async create(record: RefreshTokenRecord): Promise<void> {
    await this.db.insert(refreshTokens).values(record);
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return row ? toRecord(row) : null;
  }

  async rotate(oldId: string, replacement: RefreshTokenRecord, now: Date): Promise<boolean> {
    // One transaction: either both statements happen, or neither does.
    return this.db.transaction(async (tx) => {
      // The WHERE clause is the guard: only an ACTIVE token can be rotated. If two requests rotate
      // the same token at once, Postgres row locking lets one UPDATE match; the other matches 0 rows.
      const retired = await tx
        .update(refreshTokens)
        .set({ replacedBy: replacement.id, revokedAt: now })
        .where(
          and(
            eq(refreshTokens.id, oldId),
            isNull(refreshTokens.revokedAt),
            isNull(refreshTokens.replacedBy),
          ),
        )
        .returning({ id: refreshTokens.id });
      if (retired.length === 0) {
        return false;
      }
      await tx.insert(refreshTokens).values(replacement);
      return true;
    });
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
  }
}

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    familyId: row.familyId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedBy: row.replacedBy,
    // jsonb comes back as `unknown`; we only ever write DeviceInfo into it.
    deviceInfo: (row.deviceInfo as DeviceInfo | null) ?? null,
  };
}
