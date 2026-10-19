import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { batches, institutes, users } from '@coachingdesk/db/schema';
import { eq } from 'drizzle-orm';
import { startTestDb } from '../../../test/postgres';
import { Batch } from '../batch';
import { InMemoryBatchRepository } from '../batch.repository';
import { DrizzleBatchRepository } from '../drizzle-batch.repository';
import {
  CONTRACT_INSTITUTE_A,
  CONTRACT_INSTITUTE_B,
  describeBatchRepositoryContract,
} from './batch-repository.contract';

describeBatchRepositoryContract('InMemoryBatchRepository', () => new InMemoryBatchRepository());

const OWNER_ID = '00000000-0000-7000-8000-0000000003f1';

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  // Foreign keys: a batch needs an institute, an institute needs a user.
  await db.insert(users).values({ id: OWNER_ID, phone: '+919000000003' });
  await db.insert(institutes).values([
    { id: CONTRACT_INSTITUTE_A, name: 'Institute A', type: 'tuition', createdBy: OWNER_ID },
    { id: CONTRACT_INSTITUTE_B, name: 'Institute B', type: 'tuition', createdBy: OWNER_ID },
  ]);
});
afterAll(async () => {
  await stop();
});

describeBatchRepositoryContract('DrizzleBatchRepository', () => new DrizzleBatchRepository(db));

// Postgres-only: these need a real database to prove.
describe('DrizzleBatchRepository (Postgres only)', () => {
  const batch = (defaultFeePaise: number) =>
    Batch.create('00000000-0000-7000-8000-000000000501', CONTRACT_INSTITUTE_A, {
      name: 'Annual course',
      schedule: { days: [6, 7], start: '09:00', end: '12:00' },
      defaultFeePaise,
      defaultFeeCycle: 'yearly',
    });

  it('stores fees above the 32-bit limit exactly (bigint column, not integer)', async () => {
    // Rs 5 crore = 5,000,000,000 paise: more than a 32-bit int (2,147,483,647) can hold.
    const repo = new DrizzleBatchRepository(db);
    await repo.create(batch(5_000_000_000));

    const found = await repo.findById(CONTRACT_INSTITUTE_A, batch(0).id);
    expect(found?.defaultFee.toPaise()).toBe(5_000_000_000);
  });

  it('stores the schedule as JSON in snake_case columns', async () => {
    await new DrizzleBatchRepository(db).create(batch(150000));

    const [row] = await db
      .select()
      .from(batches)
      .where(eq(batches.id, batch(0).id));
    expect(row?.schedule).toEqual({ days: [6, 7], start: '09:00', end: '12:00' });
    expect(row?.defaultFeeCycle).toBe('yearly');
  });

  it('the CHECK constraint rejects a negative fee even if code skipped the entity', async () => {
    await expect(
      db.insert(batches).values({
        id: '00000000-0000-7000-8000-000000000502',
        instituteId: CONTRACT_INSTITUTE_A,
        name: 'Broken',
        schedule: { days: [1], start: '10:00', end: '11:00' },
        defaultFeePaise: -1,
        defaultFeeCycle: 'monthly',
      }),
    ).rejects.toThrow();
  });
});
