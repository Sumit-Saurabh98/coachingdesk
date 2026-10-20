import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { institutes, users } from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { InMemoryDataExportRepository } from '../data-export.repository';
import { DrizzleDataExportRepository } from '../drizzle-data-export.repository';
import {
  CONTRACT,
  describeDataExportRepositoryContract,
  exportId,
  queue,
} from './data-export-repository.contract';

describeDataExportRepositoryContract(
  'InMemoryDataExportRepository',
  () => new InMemoryDataExportRepository(),
);

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: CONTRACT.u1, phone: '+919000000051' });
  await db.insert(institutes).values([
    { id: CONTRACT.instituteA, name: 'A', type: 'tuition', createdBy: CONTRACT.u1 },
    { id: CONTRACT.instituteB, name: 'B', type: 'tuition', createdBy: CONTRACT.u1 },
  ]);
});
afterAll(async () => {
  await stop();
});

describeDataExportRepositoryContract(
  'DrizzleDataExportRepository',
  () => new DrizzleDataExportRepository(db),
);

describe('DrizzleDataExportRepository (Postgres only)', () => {
  it('CONCURRENCY: five taps at once queue ONE export', async () => {
    const repo = new DrizzleDataExportRepository(db);
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => queue(repo, n)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.export.id)).size).toBe(1);
  });

  it('CONCURRENCY: two workers never claim the same export', async () => {
    const repo = new DrizzleDataExportRepository(db);
    await queue(repo, 1, CONTRACT.instituteA);
    await queue(repo, 2, CONTRACT.instituteB);
    const now = new Date('2026-10-20T11:00:00Z');

    const claims = await Promise.all([1, 2, 3, 4].map(() => repo.claimNext(now, new Date(0))));

    const ids = claims.flatMap((c) => (c ? [c.id] : []));
    expect(ids.sort()).toEqual([exportId(1), exportId(2)]);
  });
});
