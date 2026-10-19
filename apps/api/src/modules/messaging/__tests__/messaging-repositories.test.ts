import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { institutes, users } from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { InMemoryConsentRepository } from '../consent.repository';
import { DrizzleConsentRepository } from '../drizzle-consent.repository';
import { DrizzleOutboxRepository } from '../drizzle-outbox.repository';
import { InMemoryOutboxRepository } from '../outbox.repository';
import {
  CONTRACT,
  describeConsentRepositoryContract,
  describeOutboxRepositoryContract,
  message,
} from './messaging-repositories.contract';

describeOutboxRepositoryContract('InMemoryOutboxRepository', () => new InMemoryOutboxRepository());
describeConsentRepositoryContract(
  'InMemoryConsentRepository',
  () => new InMemoryConsentRepository(),
);

const OWNER_ID = '00000000-0000-7000-8000-0000000040f1';
let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: OWNER_ID, phone: '+919000000040' });
  await db.insert(institutes).values([
    { id: CONTRACT.instituteA, name: 'A', type: 'tuition', createdBy: OWNER_ID },
    { id: CONTRACT.instituteB, name: 'B', type: 'tuition', createdBy: OWNER_ID },
  ]);
});
afterAll(async () => {
  await stop();
});

describeOutboxRepositoryContract('DrizzleOutboxRepository', () => new DrizzleOutboxRepository(db));
describeConsentRepositoryContract(
  'DrizzleConsentRepository',
  () => new DrizzleConsentRepository(db),
);

describe('DrizzleOutboxRepository (Postgres only)', () => {
  it('CONCURRENCY: two workers claiming at once never get the same message', async () => {
    const repo = new DrizzleOutboxRepository(db);
    await repo.enqueueAll(Array.from({ length: 20 }, () => message()));
    const now = new Date('2026-10-19T11:00:00Z');

    const [a, b] = await Promise.all([repo.claimDue(now, 15), repo.claimDue(now, 15)]);

    const ids = [...a, ...b].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids).toHaveLength(20); // and nothing lost
  });

  it('releaseStuck: a crashed worker\'s "sending" rows go back to the queue', async () => {
    const repo = new DrizzleOutboxRepository(db);
    await repo.enqueueAll([message()]);
    await repo.claimDue(new Date('2026-10-19T11:00:00Z'), 10);

    expect(await repo.releaseStuck(new Date(Date.now() - 60_000))).toBe(0); // still fresh
    expect(await repo.releaseStuck(new Date(Date.now() + 60_000))).toBe(1);
  });
});
