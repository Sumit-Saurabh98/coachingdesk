import { describe, expect, it } from 'vitest';
import { Institute } from '../institute';
import type { InstituteRepository } from '../institute.repository';

/** Users that must exist before the contract runs (Postgres has foreign keys to users). */
export const CONTRACT_OWNER_ID = '00000000-0000-7000-8000-0000000000a1';
export const CONTRACT_OTHER_USER_ID = '00000000-0000-7000-8000-0000000000a2';

const instituteId = (n: number) =>
  `00000000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;
const trial = { plan: 'pro' as const, endsAt: new Date('2026-11-18T10:00:00Z') };

const newInstitute = (n: number, name = `Institute ${n}`) =>
  Institute.create(instituteId(n), { name, type: 'tuition', city: 'Pune' }, CONTRACT_OWNER_ID);

export function describeInstituteRepositoryContract(
  name: string,
  create: () => InstituteRepository,
): void {
  describe(`InstituteRepository contract: ${name}`, () => {
    it('creates an institute that can be found again, unchanged', async () => {
      const repo = create();
      const institute = newInstitute(1);

      await repo.createWithOwner(institute, trial);

      expect((await repo.findById(institute.id))?.toProps()).toEqual(institute.toProps());
    });

    it('makes the creator the owner', async () => {
      const repo = create();
      await repo.createWithOwner(newInstitute(1), trial);

      expect(await repo.findMembership(instituteId(1), CONTRACT_OWNER_ID)).toEqual({
        instituteId: instituteId(1),
        userId: CONTRACT_OWNER_ID,
        role: 'owner',
      });
    });

    it('has no membership for anyone else', async () => {
      const repo = create();
      await repo.createWithOwner(newInstitute(1), trial);
      expect(await repo.findMembership(instituteId(1), CONTRACT_OTHER_USER_ID)).toBeNull();
    });

    it('lists the institutes a user belongs to, oldest first', async () => {
      const repo = create();
      await repo.createWithOwner(newInstitute(1, 'First'), trial);
      await repo.createWithOwner(newInstitute(2, 'Second'), trial);

      const mine = await repo.listForUser(CONTRACT_OWNER_ID);

      expect(mine.map((m) => [m.institute.name, m.role])).toEqual([
        ['First', 'owner'],
        ['Second', 'owner'],
      ]);
      expect(await repo.listForUser(CONTRACT_OTHER_USER_ID)).toEqual([]);
    });

    it('saves edits', async () => {
      const repo = create();
      const institute = newInstitute(1);
      await repo.createWithOwner(institute, trial);

      await repo.update(institute.withBillingSettings({ billingDay: 5, dueAfterDays: 3 }));

      expect((await repo.findById(institute.id))?.toPublicJSON()).toMatchObject({
        billingDay: 5,
        dueAfterDays: 3,
      });
    });

    it('refuses to update an institute that does not exist', async () => {
      await expect(create().update(newInstitute(9))).rejects.toThrow();
    });

    it('returns null for an unknown institute', async () => {
      expect(await create().findById(instituteId(9))).toBeNull();
    });
  });
}
