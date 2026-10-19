import { describe, expect, it } from 'vitest';
import { PhoneNumber } from '@coachingdesk/shared';
import { User } from '../user';

// A brand-new user, as created at first login: no name yet, English.
const user = new User('user-1', PhoneNumber.parse('9876543210'), null, 'en');

describe('User.withProfile', () => {
  it('sets the name, tidying spaces', () => {
    expect(user.withProfile({ name: '  Neha   Sharma ' }).name).toBe('Neha Sharma');
  });

  it('changes only what was given', () => {
    const named = user.withProfile({ name: 'Neha' });
    const hindi = named.withProfile({ locale: 'hi' }); // no name sent: keeps 'Neha'
    expect(hindi.toPublicJSON()).toEqual({ id: 'user-1', name: 'Neha', locale: 'hi' });
  });

  it('returns a NEW user and leaves the original untouched', () => {
    const renamed = user.withProfile({ name: 'Neha' });
    expect(renamed).not.toBe(user); // a different object...
    expect(user.name).toBeNull(); // ...and the original is unchanged
  });

  it('keeps identity: same id and phone', () => {
    const renamed = user.withProfile({ name: 'Neha' });
    expect(renamed.id).toBe(user.id);
    expect(renamed.phone.equals(user.phone)).toBe(true);
  });

  // %j prints the value as JSON in the test name, so you can see the empty strings.
  it.each(['', '   ', 'x'.repeat(61)])('rejects the name %j', (name) => {
    expect(() => user.withProfile({ name })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field: 'name' } }),
    );
  });

  // Our users are in India: Devanagari must work just like English.
  it('accepts names in Hindi', () => {
    expect(user.withProfile({ name: 'नेहा शर्मा' }).name).toBe('नेहा शर्मा');
  });
});

describe('User.toPublicJSON', () => {
  it('never includes the phone number', () => {
    expect(Object.keys(user.toPublicJSON())).toEqual(['id', 'name', 'locale']);
  });
});
