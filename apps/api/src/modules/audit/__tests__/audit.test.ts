import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { institutes, users } from '@coachingdesk/db/schema';
import { FixedClock, SequentialIdGenerator } from '@coachingdesk/shared';
import { startTestDb } from '../../../test/postgres';
import { AuditLog } from '../audit-log';
import { type AuditRepository, InMemoryAuditRepository } from '../audit.repository';
import { DrizzleAuditRepository } from '../drizzle-audit.repository';

const A = '00000000-0000-7000-8000-0000000090a1';
const B = '00000000-0000-7000-8000-0000000090b1';
const ACTOR = '00000000-0000-7000-8000-0000000090f1';
const ENTITY = '00000000-0000-7000-8000-0000000091a1';

function describeContract(name: string, create: () => AuditRepository): void {
  describe(`AuditLog contract: ${name}`, () => {
    const log = () =>
      new AuditLog(
        create(),
        new SequentialIdGenerator(),
        new FixedClock(new Date('2026-10-19T10:00:00Z')),
      );

    it('records events; lists newest first, per institute, paged by id', async () => {
      const audit = log();
      for (const action of ['invoice.waive', 'payment.void', 'student.erase']) {
        await audit.record({
          instituteId: A,
          actorUserId: ACTOR,
          action,
          entityType: 'x',
          entityId: ENTITY,
          before: { status: 'due' },
          after: { status: 'waived' },
        });
      }
      await audit.record({
        instituteId: B,
        actorUserId: null,
        action: 'other',
        entityType: 'x',
        entityId: ENTITY,
      });

      const all = await audit.list(A, 10);
      const older = await audit.list(A, 10, all[0]!.id);

      expect(all.map((e) => e.action)).toEqual(['student.erase', 'payment.void', 'invoice.waive']);
      expect(all[2]).toMatchObject({
        before: { status: 'due' },
        after: { status: 'waived' },
        actorUserId: ACTOR,
      });
      expect(older.map((e) => e.action)).toEqual(['payment.void', 'invoice.waive']);
    });
  });
}

describeContract('InMemoryAuditRepository', () => new InMemoryAuditRepository());

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;
beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: ACTOR, phone: '+919000000090' });
  await db.insert(institutes).values([
    { id: A, name: 'A', type: 'tuition', createdBy: ACTOR },
    { id: B, name: 'B', type: 'tuition', createdBy: ACTOR },
  ]);
});
afterAll(async () => {
  await stop();
});

describeContract('DrizzleAuditRepository', () => new DrizzleAuditRepository(db));
