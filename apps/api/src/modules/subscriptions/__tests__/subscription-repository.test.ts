import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { users } from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { DrizzleInstituteRepository } from '../../institutes/drizzle-institute.repository';
import { Institute } from '../../institutes/institute';
import { InMemoryInstituteRepository } from '../../institutes/institute.repository';
import { DrizzleSubscriptionRepository } from '../drizzle-subscription.repository';
import {
  InMemorySubscriptionRepository,
  type SubscriptionRepository,
} from '../subscription.repository';

const OWNER_ID = '00000000-0000-7000-8000-0000000006a1';
const INSTITUTE_ID = '00000000-0000-7000-8000-0000000006b1';
const trialEnd = new Date('2026-11-18T10:00:00Z');

/**
 * Contract: after an institute is created (through the INSTITUTES repository, the way the app
 * does it), the subscriptions repository reads back its trial row. Unknown institute -> null.
 */
function describeContract(
  name: string,
  setup: () => {
    subscriptions: SubscriptionRepository;
    createInstitute: () => Promise<void>;
  },
): void {
  describe(`SubscriptionRepository contract: ${name}`, () => {
    it('reads the trial row written when the institute was created', async () => {
      const { subscriptions, createInstitute } = setup();
      await createInstitute();

      expect(await subscriptions.findByInstitute(INSTITUTE_ID)).toMatchObject({
        instituteId: INSTITUTE_ID,
        plan: 'pro',
        status: 'trialing',
        currentPeriodEnd: trialEnd,
        graceUntil: null,
      });
    });

    it('returns null for an institute without a subscription', async () => {
      expect(await setup().subscriptions.findByInstitute(INSTITUTE_ID)).toBeNull();
    });
  });
}

const institute = () =>
  Institute.create(INSTITUTE_ID, { name: 'Sharma Classes', type: 'tuition' }, OWNER_ID);

describeContract('InMemorySubscriptionRepository', () => {
  const subscriptions = new InMemorySubscriptionRepository();
  const institutes = new InMemoryInstituteRepository(subscriptions);
  return {
    subscriptions,
    createInstitute: () =>
      institutes.createWithOwner(institute(), { plan: 'pro', endsAt: trialEnd }),
  };
});

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: OWNER_ID, phone: '+919000000006' });
});
afterAll(async () => {
  await stop();
});

describeContract('DrizzleSubscriptionRepository', () => ({
  subscriptions: new DrizzleSubscriptionRepository(db),
  createInstitute: () =>
    new DrizzleInstituteRepository(db).createWithOwner(institute(), {
      plan: 'pro',
      endsAt: trialEnd,
    }),
}));
