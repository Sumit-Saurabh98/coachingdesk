import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { institutes, notices, users } from '@coachingdesk/db/schema';
import { LocalDate } from '@coachingdesk/shared';
import { startTestDb } from '../../../test/postgres';
import { DrizzleNoticeRepository } from '../drizzle-notice.repository';
import {
  InMemoryNoticeRepository,
  type NoticeRecord,
  type NoticeRepository,
} from '../notice.repository';

const A = '00000000-0000-7000-8000-00000000a0a1';
const OWNER = '00000000-0000-7000-8000-00000000a0f1';
let n = 0;
const notice = (day = '2026-10-19'): NoticeRecord => ({
  id: `00000000-0000-7000-8000-00000000a1${String(++n % 100).padStart(2, '0')}`,
  instituteId: A,
  kind: 'general',
  batchIds: ['00000000-0000-7000-8000-00000000a2a1'],
  content: { institute: 'X', text: 'Hello' },
  sentBy: OWNER,
  recipients: 3,
  day: LocalDate.parse(day),
  createdAt: new Date('2026-10-19T10:00:00Z'),
});

function describeContract(name: string, create: () => NoticeRepository): void {
  describe(`NoticeRepository contract: ${name}`, () => {
    it('allows up to the daily limit, per day; lists newest first', async () => {
      const repo = create();
      expect(await repo.createWithinDailyLimit(notice(), 2)).toBe(true);
      expect(await repo.createWithinDailyLimit(notice(), 2)).toBe(true);
      expect(await repo.createWithinDailyLimit(notice(), 2)).toBe(false);
      expect(await repo.createWithinDailyLimit(notice('2026-10-20'), 2)).toBe(true);

      const listed = await repo.list(A, 10);
      expect(listed).toHaveLength(3);
      expect(listed[0]?.day.toString()).toBe('2026-10-20');
      expect(listed[0]?.content).toEqual({ institute: 'X', text: 'Hello' });
    });
  });
}

describeContract('InMemoryNoticeRepository', () => new InMemoryNoticeRepository());

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;
beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: OWNER, phone: '+919000000100' });
  await db.insert(institutes).values({ id: A, name: 'A', type: 'tuition', createdBy: OWNER });
});
afterAll(async () => {
  await stop();
});

describeContract('DrizzleNoticeRepository', () => new DrizzleNoticeRepository(db));

describe('DrizzleNoticeRepository (Postgres only)', () => {
  it('CONCURRENCY: 10 "Send" taps at once with a limit of 2 -> exactly 2 notices', async () => {
    const repo = new DrizzleNoticeRepository(db);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.createWithinDailyLimit(notice(), 2)),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await db.$count(notices)).toBe(2);
  });
});
