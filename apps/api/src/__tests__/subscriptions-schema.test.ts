import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { institutes, subscriptions, users } from '@coachingdesk/db/schema';
import { startTestDb } from '../test/postgres';

/**
 * Database-level guarantees for `subscriptions`, tested against real Postgres with our migrations.
 * These are the LAST line of defence: even if application code has a bug, the database refuses
 * to store an impossible subscription.
 */
const USER_ID = '00000000-0000-7000-8000-0000000000aa';
const INSTITUTE_ID = '00000000-0000-7000-8000-0000000000bb';
const trialEnd = new Date('2026-11-18T10:00:00Z');

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: USER_ID, phone: '+919876543210' });
  await db
    .insert(institutes)
    .values({ id: INSTITUTE_ID, name: 'Sharma Classes', type: 'tuition', createdBy: USER_ID });
});
afterAll(async () => {
  await stop();
});

const trial = {
  instituteId: INSTITUTE_ID,
  plan: 'pro',
  status: 'trialing',
  currentPeriodEnd: trialEnd,
};

describe('subscriptions table', () => {
  it('stores a 30-day Pro trial', async () => {
    await db.insert(subscriptions).values(trial);
    const [row] = await db.select().from(subscriptions);
    expect(row).toMatchObject({ plan: 'pro', status: 'trialing', interval: null });
    expect(row?.currentPeriodEnd).toEqual(trialEnd);
  });

  it('allows exactly ONE subscription per institute', async () => {
    await db.insert(subscriptions).values(trial);
    await expect(db.insert(subscriptions).values(trial)).rejects.toThrow();
  });

  it('refuses a subscription for an institute that does not exist', async () => {
    await expect(
      db
        .insert(subscriptions)
        .values({ ...trial, instituteId: '00000000-0000-7000-8000-0000000000cc' }),
    ).rejects.toThrow();
  });

  it.each([
    ['an unknown plan', { plan: 'platinum' }],
    ['an unknown status', { status: 'paused' }],
    ['an unknown interval', { interval: 'week' }],
    ['a trial without an end date', { currentPeriodEnd: null }],
  ])('refuses %s', async (_case, override) => {
    await expect(db.insert(subscriptions).values({ ...trial, ...override })).rejects.toThrow();
  });

  it('allows free with no period end', async () => {
    await db
      .insert(subscriptions)
      .values({ instituteId: INSTITUTE_ID, plan: 'free', status: 'free' });
    expect(await db.select().from(subscriptions)).toHaveLength(1);
  });
});
