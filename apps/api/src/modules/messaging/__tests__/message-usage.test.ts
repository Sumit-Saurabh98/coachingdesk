import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { institutes, messageUsage, users } from '@coachingdesk/db/schema';
import { FixedClock, LocalDate } from '@coachingdesk/shared';
import { startTestDb } from '../../../test/postgres';
import { DrizzleMessageUsageRepository } from '../drizzle-message-usage.repository';
import { MessageQuota } from '../message-quota';
import {
  InMemoryMessageUsageRepository,
  type MessageUsageRepository,
  type UsageLimits,
} from '../message-usage.repository';

const INSTITUTE = '00000000-0000-7000-8000-0000000080a1';
const day = (text: string) => LocalDate.parse(text);
const limits = (overrides: Partial<UsageLimits> = {}): UsageLimits => ({
  monthFrom: day('2026-10-01'),
  monthly: 1000,
  daily: null,
  trialTotal: null,
  ...overrides,
});

function describeContract(name: string, create: () => MessageUsageRepository): void {
  describe(`MessageUsageRepository contract: ${name}`, () => {
    it('counts each take; usage reports today and the month', async () => {
      const repo = create();
      await repo.tryTake(INSTITUTE, day('2026-10-18'), limits());
      await repo.tryTake(INSTITUTE, day('2026-10-19'), limits());
      await repo.tryTake(INSTITUTE, day('2026-10-19'), limits());
      expect(await repo.usage(INSTITUTE, day('2026-10-19'), day('2026-10-01'))).toEqual({
        today: 2,
        month: 3,
      });
    });

    it('stops at the monthly quota (and counts nothing more)', async () => {
      const repo = create();
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await repo.tryTake(INSTITUTE, day('2026-10-19'), limits({ monthly: 2 })));
      }
      expect(results).toEqual([true, true, false]);
      expect((await repo.usage(INSTITUTE, day('2026-10-19'), day('2026-10-01'))).month).toBe(2);
    });

    it('a new month starts from zero; Free (quota 0) can send nothing', async () => {
      const repo = create();
      await repo.tryTake(INSTITUTE, day('2026-10-31'), limits({ monthly: 1 }));
      expect(
        await repo.tryTake(
          INSTITUTE,
          day('2026-11-01'),
          limits({ monthly: 1, monthFrom: day('2026-11-01') }),
        ),
      ).toBe(true);
      expect(await create().tryTake(INSTITUTE, day('2026-10-19'), limits({ monthly: 0 }))).toBe(
        false,
      );
    });

    it('the daily cap and the trial total', async () => {
      const repo = create();
      const trial = limits({ daily: 2, trialTotal: { since: day('2026-10-18'), limit: 3 } });
      expect(await repo.tryTake(INSTITUTE, day('2026-10-18'), trial)).toBe(true);
      expect(await repo.tryTake(INSTITUTE, day('2026-10-18'), trial)).toBe(true);
      expect(await repo.tryTake(INSTITUTE, day('2026-10-18'), trial)).toBe(false); // daily
      expect(await repo.tryTake(INSTITUTE, day('2026-10-19'), trial)).toBe(true);
      expect(await repo.tryTake(INSTITUTE, day('2026-10-19'), trial)).toBe(false); // trial total 3
    });

    it('release gives a unit back (never below zero)', async () => {
      const repo = create();
      await repo.tryTake(INSTITUTE, day('2026-10-19'), limits({ monthly: 1 }));
      await repo.release(INSTITUTE, day('2026-10-19'));
      await repo.release(INSTITUTE, day('2026-10-19'));
      expect(await repo.tryTake(INSTITUTE, day('2026-10-19'), limits({ monthly: 1 }))).toBe(true);
    });
  });
}

describeContract('InMemoryMessageUsageRepository', () => new InMemoryMessageUsageRepository());

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;
beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  const owner = '00000000-0000-7000-8000-0000000080f1';
  await db.insert(users).values({ id: owner, phone: '+919000000080' });
  await db
    .insert(institutes)
    .values({ id: INSTITUTE, name: 'A', type: 'tuition', createdBy: owner });
});
afterAll(async () => {
  await stop();
});

describeContract('DrizzleMessageUsageRepository', () => new DrizzleMessageUsageRepository(db));

describe('DrizzleMessageUsageRepository (Postgres only)', () => {
  it('CONCURRENCY: 20 workers taking at once with a daily cap of 5 -> exactly 5 taken', async () => {
    const repo = new DrizzleMessageUsageRepository(db);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.tryTake(INSTITUTE, day('2026-10-19'), limits({ daily: 5 })),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    const [row] = await db.select().from(messageUsage);
    expect(row?.sent).toBe(5);
  });
});

describe('MessageQuota', () => {
  it("uses the institute's local day and month (00:30 IST on Nov 1 is November)", async () => {
    const usage = new InMemoryMessageUsageRepository();
    const clock = new FixedClock(new Date('2026-10-31T19:00:00Z')); // Nov 1, 00:30 IST
    const quota = new MessageQuota(
      usage,
      { messagingLimits: async () => ({ monthly: 1000, daily: null, trialTotal: null }) },
      clock,
    );
    expect(await quota.tryConsume(INSTITUTE, 'Asia/Kolkata')).toBe(true);
    expect(await quota.report(INSTITUTE, 'Asia/Kolkata')).toMatchObject({
      month: '2026-11',
      used: 1,
      todayUsed: 1,
      limit: 1000,
    });
  });
});
