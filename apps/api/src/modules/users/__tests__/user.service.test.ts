import { describe, expect, it } from 'vitest';
import { PhoneNumber, SequentialIdGenerator, UpdateMeBody } from '@coachingdesk/shared';
import { InMemoryUserRepository } from '../user.repository';
import { UserService } from '../user.service';

function setup() {
  const repository = new InMemoryUserRepository();
  const service = new UserService(repository, new SequentialIdGenerator());
  return { service, repository };
}

const phone = PhoneNumber.parse('9876543210');

describe('UserService', () => {
  it('returns the profile of an existing user', async () => {
    const { service } = setup();
    const { user } = await service.findOrCreateByPhone(phone);

    expect((await service.getProfile(user.id)).toPublicJSON()).toEqual(user.toPublicJSON());
  });

  it('updates and SAVES the profile', async () => {
    const { service, repository } = setup();
    const { user } = await service.findOrCreateByPhone(phone);

    const updated = await service.updateProfile(user.id, { name: ' Neha  Sharma ', locale: 'hi' });

    expect(updated.toPublicJSON()).toMatchObject({ name: 'Neha Sharma', locale: 'hi' });
    // Read straight from the repository: proves it was stored, not only returned.
    expect((await repository.findById(user.id))?.name).toBe('Neha Sharma');
  });

  it('does not save anything when the name breaks the rules', async () => {
    const { service, repository } = setup();
    const { user } = await service.findOrCreateByPhone(phone);

    await expect(service.updateProfile(user.id, { name: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect((await repository.findById(user.id))?.name).toBeNull();
  });

  it('answers 401 for an account that no longer exists', async () => {
    const { service } = setup();
    await expect(service.getProfile('missing-user')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(service.updateProfile('missing-user', { name: 'X' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('UpdateMeBody', () => {
  it.each([
    [{ name: 'Neha' }, true],
    [{ locale: 'hi' }, true],
    [{ name: 'Neha', locale: 'en' }, true],
    [{}, false], // nothing to change
    [{ locale: 'fr' }, false], // unsupported language
    [{ name: 'Neha', phone: '9123456789' }, false], // phone can't be changed here: strict
  ])('%j -> valid: %s', (body, valid) => {
    expect(UpdateMeBody.safeParse(body).success).toBe(valid);
  });
});
