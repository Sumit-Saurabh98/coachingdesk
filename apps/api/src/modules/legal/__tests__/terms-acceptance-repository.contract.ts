import { describe, expect, it } from 'vitest';
import type { TermsAcceptanceRepository } from '../terms-acceptance.repository';

/** One set of tests for every TermsAcceptanceRepository: the fake must behave like Postgres. */
export function describeTermsAcceptanceContract(
  name: string,
  create: () => Promise<{ repo: TermsAcceptanceRepository; userIds: [string, string] }>,
): void {
  const at = (iso: string) => new Date(iso);

  describe(`${name} (TermsAcceptanceRepository contract)`, () => {
    it('no acceptance yet -> null', async () => {
      const { repo, userIds } = await create();
      expect(await repo.latestVersion(userIds[0])).toBeNull();
    });

    it('keeps the history; the latest acceptance wins (by time, then id)', async () => {
      const { repo, userIds } = await create();
      const [u] = userIds;
      await repo.record({
        id: '01900000-0000-7000-8000-000000000002',
        userId: u,
        version: '2026-12-01',
        acceptedAt: at('2026-12-02T10:00:00Z'),
      });
      await repo.record({
        id: '01900000-0000-7000-8000-000000000001',
        userId: u,
        version: '2026-10-22',
        acceptedAt: at('2026-10-23T10:00:00Z'),
      });
      expect(await repo.latestVersion(u)).toBe('2026-12-01');

      // Same moment: the later id (UUIDv7 = later) wins.
      await repo.record({
        id: '01900000-0000-7000-8000-000000000004',
        userId: u,
        version: 'b',
        acceptedAt: at('2027-01-01T00:00:00Z'),
      });
      await repo.record({
        id: '01900000-0000-7000-8000-000000000003',
        userId: u,
        version: 'a',
        acceptedAt: at('2027-01-01T00:00:00Z'),
      });
      expect(await repo.latestVersion(u)).toBe('b');
    });

    it("users don't see each other's acceptances; deleting removes only that user's", async () => {
      const { repo, userIds } = await create();
      const [a, b] = userIds;
      await repo.record({
        id: '01900000-0000-7000-8000-00000000000a',
        userId: a,
        version: '2026-10-22',
        acceptedAt: at('2026-10-23T10:00:00Z'),
      });
      await repo.record({
        id: '01900000-0000-7000-8000-00000000000b',
        userId: b,
        version: '2026-10-22',
        acceptedAt: at('2026-10-23T10:00:00Z'),
      });

      await repo.deleteAllFor(a);

      expect(await repo.latestVersion(a)).toBeNull();
      expect(await repo.latestVersion(b)).toBe('2026-10-22');
    });
  });
}
