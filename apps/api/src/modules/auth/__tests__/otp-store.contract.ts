import { describe, expect, it } from 'vitest';
import { type Clock, FixedClock, PhoneNumber } from '@coachingdesk/shared';
import type { OtpEntry, OtpStore } from '../otp-store';

export function describeOtpStoreContract(name: string, create: (clock: Clock) => OtpStore): void {
  describe(`OtpStore contract: ${name}`, () => {
    const phone = PhoneNumber.parse('9876543210');
    const otherPhone = PhoneNumber.parse('9123456789');
    const entry: OtpEntry = {
      codeHash: 'a'.repeat(64),
      attempts: 0,
      expiresAt: new Date('2026-10-19T10:05:00Z'),
    };
    const setup = () => create(new FixedClock(new Date('2026-10-19T10:00:00Z')));

    it('finds nothing when nothing was saved', async () => {
      expect(await setup().find(phone)).toBeNull();
    });

    // Catches conversion bugs: Redis returns strings, we must get back numbers and a Date.
    it('returns exactly what was saved', async () => {
      const store = setup();
      await store.save(phone, entry);
      expect(await store.find(phone)).toEqual(entry);
    });

    it('replaces the previous entry on save', async () => {
      const store = setup();
      await store.save(phone, entry);
      await store.recordFailedAttempt(phone);
      await store.save(phone, { ...entry, codeHash: 'b'.repeat(64) });
      expect(await store.find(phone)).toEqual({ ...entry, codeHash: 'b'.repeat(64), attempts: 0 });
    });

    it('counts failed attempts and returns the new count', async () => {
      const store = setup();
      await store.save(phone, entry);
      expect(await store.recordFailedAttempt(phone)).toBe(1);
      expect(await store.recordFailedAttempt(phone)).toBe(2);
      expect((await store.find(phone))?.attempts).toBe(2);
    });

    // The test that forces the Lua script: plain HINCRBY would create an entry here.
    it('returns null and creates nothing when no code is pending', async () => {
      const store = setup();
      expect(await store.recordFailedAttempt(phone)).toBeNull();
      expect(await store.find(phone)).toBeNull();
    });

    it('gives every simultaneous attempt its own count', async () => {
      const store = setup();
      await store.save(phone, entry);
      const counts = await Promise.all(
        Array.from({ length: 10 }, () => store.recordFailedAttempt(phone)),
      );
      expect([...counts].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
    });

    it('deletes, and keeps phones separate', async () => {
      const store = setup();
      await store.save(phone, entry);
      await store.save(otherPhone, entry);
      await store.delete(phone);
      expect(await store.find(phone)).toBeNull();
      expect(await store.find(otherPhone)).toEqual(entry);
    });
  });
}
