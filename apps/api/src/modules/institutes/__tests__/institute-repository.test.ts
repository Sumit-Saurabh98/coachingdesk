import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { institutes, memberships, subscriptions, users } from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { DrizzleInstituteRepository } from '../drizzle-institute.repository';
import { Institute } from '../institute';
import { InMemoryInstituteRepository } from '../institute.repository';
import {
  CONTRACT_OTHER_USER_ID,
  CONTRACT_OWNER_ID,
  describeInstituteRepositoryContract,
} from './institute-repository.contract';

describeInstituteRepositoryContract(
  'InMemoryInstituteRepository',
  () => new InMemoryInstituteRepository(),
);

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values([
    { id: CONTRACT_OWNER_ID, phone: '+919000000001' },
    { id: CONTRACT_OTHER_USER_ID, phone: '+919000000002' },
  ]);
});
afterAll(async () => {
  await stop();
});

describeInstituteRepositoryContract(
  'DrizzleInstituteRepository',
  () => new DrizzleInstituteRepository(db),
);

// Postgres-only: these need a real database to prove.
describe('DrizzleInstituteRepository (Postgres only)', () => {
  const institute = Institute.create(
    '00000000-0000-7000-8000-000000000201',
    { name: 'Sharma Classes', type: 'tuition' },
    CONTRACT_OWNER_ID,
  );

  it('stores the trial subscription in the same transaction', async () => {
    const endsAt = new Date('2026-11-18T10:00:00Z');
    await new DrizzleInstituteRepository(db).createWithOwner(institute, { plan: 'pro', endsAt });

    const [subscription] = await db.select().from(subscriptions);
    expect(subscription).toMatchObject({
      instituteId: institute.id,
      plan: 'pro',
      status: 'trialing',
      currentPeriodEnd: endsAt,
    });
  });

  it('rolls EVERYTHING back if one of the three inserts fails', async () => {
    // A plan the CHECK constraint rejects makes the 3rd insert (subscription) fail...
    const badTrial = { plan: 'platinum' as 'pro', endsAt: new Date('2026-11-18T10:00:00Z') };

    await expect(
      new DrizzleInstituteRepository(db).createWithOwner(institute, badTrial),
    ).rejects.toThrow();

    // ...and the institute and membership rows written BEFORE it are gone too.
    expect(await db.select().from(institutes)).toHaveLength(0);
    expect(await db.select().from(memberships)).toHaveLength(0);
  });
});
