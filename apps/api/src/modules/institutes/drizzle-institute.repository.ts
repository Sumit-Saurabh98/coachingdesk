import type { Db } from '@coachingdesk/db';
import { institutes, memberships, subscriptions } from '@coachingdesk/db/schema';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { Institute, INSTITUTE_TYPES, type InstituteType } from './institute';
import {
  type AddMemberResult,
  MEMBER_ROLES,
  type InstituteRepository,
  type MemberRole,
  type Membership,
  type TrialSubscription,
} from './institute.repository';

type InstituteRow = typeof institutes.$inferSelect;

export class DrizzleInstituteRepository implements InstituteRepository {
  constructor(private readonly db: Db) {}

  async createWithOwner(institute: Institute, trial: TrialSubscription): Promise<void> {
    // db.transaction: if ANY statement throws, Postgres rolls back ALL of them.
    // A half-created institute (no owner, or no subscription) can never be left behind.
    await this.db.transaction(async (tx) => {
      const p = institute.toProps();
      await tx.insert(institutes).values({
        id: p.id,
        name: p.name,
        type: p.type,
        city: p.city,
        timezone: p.timezone,
        billingDay: p.billingDay,
        dueAfterDays: p.dueAfterDays,
        createdBy: p.createdBy,
      });
      await tx
        .insert(memberships)
        .values({ instituteId: p.id, userId: p.createdBy, role: 'owner' });
      await tx.insert(subscriptions).values({
        instituteId: p.id,
        plan: trial.plan,
        status: 'trialing',
        currentPeriodEnd: trial.endsAt,
      });
    });
  }

  async findById(id: string): Promise<Institute | null> {
    const [row] = await this.db.select().from(institutes).where(eq(institutes.id, id));
    return row ? toInstitute(row) : null;
  }

  async update(institute: Institute): Promise<void> {
    const p = institute.toProps();
    const updated = await this.db
      .update(institutes)
      .set({ name: p.name, city: p.city, billingDay: p.billingDay, dueAfterDays: p.dueAfterDays })
      .where(eq(institutes.id, p.id))
      .returning({ id: institutes.id });
    if (updated.length === 0) {
      throw new Error(`DrizzleInstituteRepository: no institute ${p.id}`);
    }
  }

  async findMembership(instituteId: string, userId: string): Promise<Membership | null> {
    const [row] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.instituteId, instituteId), eq(memberships.userId, userId)));
    return row
      ? { instituteId: row.instituteId, userId: row.userId, role: toRole(row.role) }
      : null;
  }

  async listForUser(userId: string): Promise<Array<{ institute: Institute; role: MemberRole }>> {
    // One query with a JOIN, not one query per institute ("N+1 queries" is a classic slow-down).
    const rows = await this.db
      .select({ institute: institutes, role: memberships.role })
      .from(memberships)
      .innerJoin(institutes, eq(institutes.id, memberships.instituteId))
      .where(and(eq(memberships.userId, userId), isNull(institutes.archivedAt)))
      .orderBy(asc(memberships.createdAt), asc(institutes.id));
    return rows.map((row) => ({ institute: toInstitute(row.institute), role: toRole(row.role) }));
  }

  async addMemberWithinLimit(
    membership: Membership,
    maxMembers: number | null,
  ): Promise<AddMemberResult> {
    return this.db.transaction(async (tx) => {
      // Same pattern as students (decision #28): lock the institute row, then count + insert.
      const [locked] = await tx
        .select({ id: institutes.id })
        .from(institutes)
        .where(eq(institutes.id, membership.instituteId))
        .for('update');
      if (!locked) {
        throw new Error(`DrizzleInstituteRepository: no institute ${membership.instituteId}`);
      }
      const [existing] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.instituteId, membership.instituteId),
            eq(memberships.userId, membership.userId),
          ),
        );
      if (existing) {
        return 'already_member';
      }
      if (maxMembers !== null) {
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(memberships)
          .where(
            and(eq(memberships.instituteId, membership.instituteId), ne(memberships.role, 'owner')),
          );
        if ((row?.count ?? 0) + 1 > maxMembers) {
          return 'limit_reached';
        }
      }
      await tx.insert(memberships).values(membership);
      return 'added';
    });
  }

  async listMembers(instituteId: string): Promise<Membership[]> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(eq(memberships.instituteId, instituteId))
      .orderBy(asc(memberships.createdAt), asc(memberships.userId));
    return rows.map((row) => ({
      instituteId: row.instituteId,
      userId: row.userId,
      role: toRole(row.role),
    }));
  }

  async removeMember(instituteId: string, userId: string): Promise<boolean> {
    // The owner is never removed here: `role <> 'owner'` is part of the WHERE.
    const removed = await this.db
      .delete(memberships)
      .where(
        and(
          eq(memberships.instituteId, instituteId),
          eq(memberships.userId, userId),
          ne(memberships.role, 'owner'),
        ),
      )
      .returning({ userId: memberships.userId });
    return removed.length > 0;
  }

  async ownsAnyInstitute(userId: string): Promise<boolean> {
    const count = await this.db.$count(
      memberships,
      and(eq(memberships.userId, userId), eq(memberships.role, 'owner')),
    );
    return count > 0;
  }

  async removeAllMembershipsOf(userId: string): Promise<void> {
    await this.db
      .delete(memberships)
      .where(and(eq(memberships.userId, userId), ne(memberships.role, 'owner')));
  }
}

function toInstitute(row: InstituteRow): Institute {
  return Institute.restore({
    id: row.id,
    name: row.name,
    type: toType(row.type),
    city: row.city,
    timezone: row.timezone,
    billingDay: row.billingDay,
    dueAfterDays: row.dueAfterDays,
    createdBy: row.createdBy,
    archivedAt: row.archivedAt,
  });
}

// The DB CHECK constraints guarantee these values; the guards turn `string` into our union types.
function toType(value: string): InstituteType {
  if ((INSTITUTE_TYPES as readonly string[]).includes(value)) {
    return value as InstituteType;
  }
  throw new Error(`Unexpected institute type in database: ${value}`);
}

function toRole(value: string): MemberRole {
  if ((MEMBER_ROLES as readonly string[]).includes(value)) {
    return value as MemberRole;
  }
  throw new Error(`Unexpected member role in database: ${value}`);
}
