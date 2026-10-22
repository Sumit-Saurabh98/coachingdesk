import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { users } from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { DrizzleTermsAcceptanceRepository } from '../drizzle-terms-acceptance.repository';
import { InMemoryTermsAcceptanceRepository } from '../terms-acceptance.repository';
import { describeTermsAcceptanceContract } from './terms-acceptance-repository.contract';

const USER_A = '01900000-0000-7000-8000-0000000000a1';
const USER_B = '01900000-0000-7000-8000-0000000000b1';

describeTermsAcceptanceContract('InMemoryTermsAcceptanceRepository', async () => ({
  repo: new InMemoryTermsAcceptanceRepository(),
  userIds: [USER_A, USER_B],
}));

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

describeTermsAcceptanceContract('DrizzleTermsAcceptanceRepository', async () => {
  // The rows point at users (foreign key), so the users must exist.
  await db.insert(users).values([
    { id: USER_A, phone: '+919800000001' },
    { id: USER_B, phone: '+919800000002' },
  ]);
  return { repo: new DrizzleTermsAcceptanceRepository(db), userIds: [USER_A, USER_B] };
});
