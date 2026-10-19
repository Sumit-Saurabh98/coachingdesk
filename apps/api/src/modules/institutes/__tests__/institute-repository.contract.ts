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

    it('lists active institutes', async () => {
      const repo = create();
      await repo.createWithOwner(newInstitute(1, 'First'), trial);
      await repo.createWithOwner(newInstitute(2, 'Second'), trial);
      expect((await repo.listActive()).map((i) => i.name)).toEqual(['First', 'Second']);
    });

    it('returns null for an unknown institute', async () => {
      expect(await create().findById(instituteId(9))).toBeNull();
    });

    describe('members', () => {
      const teacher = {
        instituteId: instituteId(1),
        userId: CONTRACT_OTHER_USER_ID,
        role: 'teacher' as const,
      };

      it('adds a member; the owner stays first in the list', async () => {
        const repo = create();
        await repo.createWithOwner(newInstitute(1), trial);

        expect(await repo.addMemberWithinLimit(teacher, 5)).toBe('added');

        expect(await repo.listMembers(instituteId(1))).toEqual([
          { instituteId: instituteId(1), userId: CONTRACT_OWNER_ID, role: 'owner' },
          teacher,
        ]);
      });

      it('already_member: the same person twice (any role)', async () => {
        const repo = create();
        await repo.createWithOwner(newInstitute(1), trial);
        await repo.addMemberWithinLimit(teacher, 5);

        expect(await repo.addMemberWithinLimit({ ...teacher, role: 'staff' }, 5)).toBe(
          'already_member',
        );
        expect(await repo.addMemberWithinLimit({ ...teacher, userId: CONTRACT_OWNER_ID }, 5)).toBe(
          'already_member',
        );
      });

      it('limit_reached: the owner does not count, members do', async () => {
        const repo = create();
        await repo.createWithOwner(newInstitute(1), trial);

        expect(await repo.addMemberWithinLimit(teacher, 0)).toBe('limit_reached');
        expect(await repo.addMemberWithinLimit(teacher, 1)).toBe('added');
        expect(await repo.listMembers(instituteId(1))).toHaveLength(2);
      });

      it('knows owners, and removes all NON-owner memberships of a user', async () => {
        const repo = create();
        await repo.createWithOwner(newInstitute(1), trial);
        await repo.addMemberWithinLimit(teacher, 5);

        expect(await repo.ownsAnyInstitute(CONTRACT_OWNER_ID)).toBe(true);
        expect(await repo.ownsAnyInstitute(CONTRACT_OTHER_USER_ID)).toBe(false);

        await repo.removeAllMembershipsOf(CONTRACT_OTHER_USER_ID);
        await repo.removeAllMembershipsOf(CONTRACT_OWNER_ID); // owners are never removed this way

        expect((await repo.listMembers(instituteId(1))).map((m) => m.role)).toEqual(['owner']);
      });

      it('removes a member, never the owner', async () => {
        const repo = create();
        await repo.createWithOwner(newInstitute(1), trial);
        await repo.addMemberWithinLimit(teacher, 5);

        expect(await repo.removeMember(instituteId(1), CONTRACT_OTHER_USER_ID)).toBe(true);
        expect(await repo.removeMember(instituteId(1), CONTRACT_OTHER_USER_ID)).toBe(false);
        expect(await repo.removeMember(instituteId(1), CONTRACT_OWNER_ID)).toBe(false);
        expect(await repo.findMembership(instituteId(1), CONTRACT_OWNER_ID)).not.toBeNull();
      });
    });
  });
}
