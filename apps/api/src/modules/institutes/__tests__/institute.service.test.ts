import { describe, expect, it } from 'vitest';
import { FixedClock, PhoneNumber, SequentialIdGenerator } from '@coachingdesk/shared';
import { InMemoryUserRepository } from '../../users/user.repository';
import { UserService } from '../../users/user.service';
import { InMemoryInstituteRepository } from '../institute.repository';
import { InstituteService } from '../institute.service';

async function setup() {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const ids = new SequentialIdGenerator();
  const users = new UserService(new InMemoryUserRepository(), ids);
  const repository = new InMemoryInstituteRepository();
  const service = new InstituteService({ institutes: repository, users, ids, clock });
  const { user: owner } = await users.findOrCreateByPhone(PhoneNumber.parse('9876543210'));
  return { service, repository, owner };
}

describe('InstituteService.create', () => {
  it('creates the institute with the caller as owner and a 30-day Pro trial', async () => {
    const { service, repository, owner } = await setup();

    const created = await service.create(owner.id, { name: 'Sharma Classes', type: 'tuition' });

    expect(created.role).toBe('owner');
    expect(created.trialEndsAt.toISOString()).toBe('2026-11-18T10:00:00.000Z');
    expect(await repository.findMembership(created.institute.id, owner.id)).toMatchObject({
      role: 'owner',
    });
    expect(repository.trials.get(created.institute.id)).toEqual({
      plan: 'pro',
      endsAt: created.trialEndsAt,
    });
  });

  it('stores nothing when the entity rejects the input', async () => {
    const { service, owner } = await setup();
    await expect(service.create(owner.id, { name: 'A', type: 'tuition' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await service.listForUser(owner.id)).toEqual([]);
  });

  it('answers 401 when the account behind the token no longer exists', async () => {
    const { service } = await setup();
    await expect(
      service.create('deleted-user', { name: 'Sharma Classes', type: 'tuition' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('InstituteService.listForUser', () => {
  it('lists the user’s institutes as plain data with their role', async () => {
    const { service, owner } = await setup();
    const a = await service.create(owner.id, { name: 'Sharma Classes', type: 'tuition' });
    const b = await service.create(owner.id, { name: 'Kathak Academy', type: 'academy' });

    expect(await service.listForUser(owner.id)).toEqual([
      { id: a.institute.id, name: 'Sharma Classes', type: 'tuition', role: 'owner' },
      { id: b.institute.id, name: 'Kathak Academy', type: 'academy', role: 'owner' },
    ]);
  });
});
