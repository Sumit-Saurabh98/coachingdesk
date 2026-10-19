import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { users } from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { DrizzleRefreshTokenRepository } from '../drizzle-refresh-token.repository';
import { InMemoryRefreshTokenRepository } from '../refresh-token.repository';
import {
  CONTRACT_USER_ID,
  describeRefreshTokenRepositoryContract,
} from './refresh-token-repository.contract';

describeRefreshTokenRepositoryContract(
  'InMemoryRefreshTokenRepository',
  () => new InMemoryRefreshTokenRepository(),
);

// The real thing: Postgres 18 in Docker, with our migrations applied
let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  // refresh_tokens.user_id is a foreign key, so the contract's user must exist in Postgres.
  await db.insert(users).values({ id: CONTRACT_USER_ID, phone: '+919999999999' });
});
afterAll(async () => {
  await stop();
});

describeRefreshTokenRepositoryContract(
  'DrizzleRefreshTokenRepository',
  () => new DrizzleRefreshTokenRepository(db),
);
