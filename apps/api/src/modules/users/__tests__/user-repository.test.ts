import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { startTestDb } from '../../../test/postgres';
import { DrizzleUserRepository } from '../drizzle-user.repository';
import { InMemoryUserRepository } from '../user.repository';
import { describeUserRepositoryContract } from './user-repository.contract';

describeUserRepositoryContract('InMemoryUserRepository', () => new InMemoryUserRepository());

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
});
afterAll(async () => {
  await stop();
});

describeUserRepositoryContract('DrizzleUserRepository', () => new DrizzleUserRepository(db));
