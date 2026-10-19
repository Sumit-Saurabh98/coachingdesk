import { describe, expect, it } from 'vitest';
import type { RefreshTokenRecord, RefreshTokenRepository } from '../refresh-token.repository';

export const CONTRACT_USER_ID = '00000000-0000-7000-8000-0000000000aa';

export function describeRefreshTokenRepositoryContract(
  name: string,
  create: () => RefreshTokenRepository,
): void {
  describe(`RefreshTokenRepository contract: ${name}`, () => {
    const now = new Date('2026-10-19T10:00:00Z');
    let n = 0;
    const record = (overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord => {
      n += 1;
      return {
        id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
        userId: CONTRACT_USER_ID,
        tokenHash: `hash-${n}`,
        familyId: '00000000-0000-7000-9000-000000000001',
        expiresAt: new Date('2027-01-17T10:00:00Z'),
        revokedAt: null,
        replacedBy: null,
        deviceInfo: { platform: 'android', appVersion: '1.0.0' },
        ...overrides,
      };
    };

    it('stores and finds a token by its hash', async () => {
      const repo = create();
      const token = record();
      await repo.create(token);
      expect(await repo.findByHash(token.tokenHash)).toEqual(token);
      expect(await repo.findByHash('unknown')).toBeNull();
    });

    it('rotates an active token: old one is retired, new one stored', async () => {
      const repo = create();
      const old = record();
      const replacement = record();
      await repo.create(old);

      expect(await repo.rotate(old.id, replacement, now)).toBe(true);

      expect(await repo.findByHash(old.tokenHash)).toMatchObject({
        replacedBy: replacement.id,
        revokedAt: now,
      });
      expect(await repo.findByHash(replacement.tokenHash)).toEqual(replacement);
    });

    it('refuses to rotate a token twice', async () => {
      const repo = create();
      const old = record();
      await repo.create(old);
      await repo.rotate(old.id, record(), now);

      const second = record();
      expect(await repo.rotate(old.id, second, now)).toBe(false);
      expect(await repo.findByHash(second.tokenHash)).toBeNull();
    });

    it('lets only one of two simultaneous rotations win', async () => {
      const repo = create();
      const old = record();
      await repo.create(old);

      const results = await Promise.all([
        repo.rotate(old.id, record(), now),
        repo.rotate(old.id, record(), now),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('revokes every active token of a family, and only that family', async () => {
      const repo = create();
      const a = record();
      const b = record();
      const otherFamily = record({ familyId: '00000000-0000-7000-9000-000000000002' });
      await repo.create(a);
      await repo.create(b);
      await repo.create(otherFamily);

      await repo.revokeFamily(a.familyId, now);

      expect((await repo.findByHash(a.tokenHash))?.revokedAt).toEqual(now);
      expect((await repo.findByHash(b.tokenHash))?.revokedAt).toEqual(now);
      expect((await repo.findByHash(otherFamily.tokenHash))?.revokedAt).toBeNull();
    });

    it("deletes all of a user's tokens (account deletion)", async () => {
      const repo = create();
      const a = record();
      const b = record({ familyId: '00000000-0000-7000-9000-000000000002' });
      await repo.create(a);
      await repo.create(b);

      await repo.deleteAllForUser(CONTRACT_USER_ID);

      expect(await repo.findByHash(a.tokenHash)).toBeNull();
      expect(await repo.findByHash(b.tokenHash)).toBeNull();
    });
  });
}
