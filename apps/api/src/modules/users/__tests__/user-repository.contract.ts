import { describe, expect, it } from 'vitest';
import { PhoneNumber } from '@coachingdesk/shared';
import { User } from '../user';
import type { UserRepository } from '../user.repository';

export function describeUserRepositoryContract(name: string, create: () => UserRepository): void {
  describe(`UserRepository contract: ${name}`, () => {
    const phone = PhoneNumber.parse('9876543210');
    const id1 = '00000000-0000-7000-8000-000000000001';
    const id2 = '00000000-0000-7000-8000-000000000002';

    it('creates a new user with default name and locale', async () => {
      const result = await create().findOrCreateByPhone(phone, id1);
      expect(result.created).toBe(true);
      expect(result.user.toPublicJSON()).toEqual({ id: id1, name: null, locale: 'en' });
      expect(result.user.phone.equals(phone)).toBe(true);
    });

    it('finds the existing user instead of creating a second one', async () => {
      const users = create();
      await users.findOrCreateByPhone(phone, id1);

      const again = await users.findOrCreateByPhone(phone, id2);

      expect(again).toMatchObject({ created: false, user: { id: id1 } });
    });

    it('creates exactly one user when two logins race', async () => {
      const users = create();
      const results = await Promise.all([
        users.findOrCreateByPhone(phone, id1),
        users.findOrCreateByPhone(phone, id2),
      ]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(results[0]?.user.id).toBe(results[1]?.user.id);
    });

    it('finds by id, and returns null for unknown ids', async () => {
      const users = create();
      await users.findOrCreateByPhone(phone, id1);
      expect((await users.findById(id1))?.phone.equals(phone)).toBe(true);
      expect(await users.findById(id2)).toBeNull();
    });

    it('finds several users by id at once, skipping unknown ids', async () => {
      const users = create();
      await users.findOrCreateByPhone(phone, id1);
      await users.findOrCreateByPhone(PhoneNumber.parse('9123456789'), id2);

      const found = await users.findByIds([id2, '00000000-0000-7000-8000-000000000099', id1]);

      expect(found.map((u) => u.id).sort()).toEqual([id1, id2]);
      expect(await users.findByIds([])).toEqual([]);
    });

    // NEW in 9d
    it('saves profile changes', async () => {
      const users = create();
      const { user } = await users.findOrCreateByPhone(phone, id1);

      await users.updateProfile(user.withProfile({ name: 'Neha Sharma', locale: 'hi' }));

      // Read it back with findById: proves it was really STORED, not just changed in memory.
      const saved = await users.findById(id1);
      expect(saved?.toPublicJSON()).toEqual({ id: id1, name: 'Neha Sharma', locale: 'hi' });
      expect(saved?.phone.equals(phone)).toBe(true);
    });

    // NEW in 9d
    it('refuses to update a user that does not exist', async () => {
      // Built directly with `new User`, never saved: it doesn't exist in the repository.
      const ghost = new User(id2, phone, 'Ghost', 'en');
      await expect(create().updateProfile(ghost)).rejects.toThrow();
    });
  });
}
