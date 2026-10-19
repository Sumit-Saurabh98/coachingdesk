import { describe, expect, it } from 'vitest';
import { PhoneNumber } from '@coachingdesk/shared';
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
  });
}
