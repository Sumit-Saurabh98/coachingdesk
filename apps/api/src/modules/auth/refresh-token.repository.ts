export interface DeviceInfo {
  platform: 'android' | 'ios' | 'web';
  appVersion: string;
}

/** One row of refresh_tokens. `tokenHash` is a SHA-256 of the token; the token itself is never stored. */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
  deviceInfo: DeviceInfo | null;
}

export interface RefreshTokenRepository {
  create(record: RefreshTokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /**
   * ATOMICALLY retires `oldId` (sets replacedBy + revokedAt) and stores `replacement`, but only if
   * `oldId` is still active. Returns false if someone else already rotated or revoked it.
   * That "false" is how a stolen token used in parallel with the real app gets detected.
   */
  rotate(oldId: string, replacement: RefreshTokenRecord, now: Date): Promise<boolean>;
  /** Revokes every still-active token of a login (a "family"). Used by logout and reuse detection. */
  revokeFamily(familyId: string, now: Date): Promise<void>;
}

/** Tests and local dev only. */
export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly records = new Map<string, RefreshTokenRecord>();

  async create(record: RefreshTokenRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const record of this.records.values()) {
      if (record.tokenHash === tokenHash) {
        return { ...record };
      }
    }
    return null;
  }

  async rotate(oldId: string, replacement: RefreshTokenRecord, now: Date): Promise<boolean> {
    const old = this.records.get(oldId);
    if (!old || old.revokedAt !== null || old.replacedBy !== null) {
      return false;
    }
    old.replacedBy = replacement.id;
    old.revokedAt = now;
    this.records.set(replacement.id, { ...replacement });
    return true;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    for (const record of this.records.values()) {
      if (record.familyId === familyId && record.revokedAt === null) {
        record.revokedAt = now;
      }
    }
  }
}
