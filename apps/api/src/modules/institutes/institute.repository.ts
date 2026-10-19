import type { InMemorySubscriptionRepository } from '../subscriptions/subscription.repository';
import { Institute } from './institute';

export const MEMBER_ROLES = ['owner', 'teacher', 'staff'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface Membership {
  instituteId: string;
  userId: string;
  role: MemberRole;
}

export type AddMemberResult = 'added' | 'already_member' | 'limit_reached';

/** The trial every new institute starts with (KNOWLEDGE_BASE §3: 30 days of Pro). */
export interface TrialSubscription {
  plan: 'pro';
  endsAt: Date;
}

export interface InstituteRepository {
  /**
   * Creates the institute, its owner membership (owner = institute.createdBy) and its trial
   * subscription in ONE transaction: all three rows are stored, or none.
   * (Documented exception to AGENTS.md rule 12: the subscriptions module owns every change
   * to the subscription AFTER this initial row. See KNOWLEDGE_BASE decision #26.)
   */
  createWithOwner(institute: Institute, trial: TrialSubscription): Promise<void>;
  findById(id: string): Promise<Institute | null>;
  /** Saves editable fields (name, city, billing settings). Throws if the institute doesn't exist. */
  update(institute: Institute): Promise<void>;
  findMembership(instituteId: string, userId: string): Promise<Membership | null>;
  /** Every non-archived institute the user belongs to, with their role, oldest first. */
  listForUser(userId: string): Promise<Array<{ institute: Institute; role: MemberRole }>>;
  /**
   * Adds a teacher/staff member if the institute has room: members besides the owner must stay
   * within maxMembers (null = unlimited). Count + insert are atomic (row lock), like students.
   */
  addMemberWithinLimit(membership: Membership, maxMembers: number | null): Promise<AddMemberResult>;
  /** The institute's members, oldest first (the owner is always first: created with it). */
  listMembers(instituteId: string): Promise<Membership[]>;
  /** Removes a NON-owner member. Returns false if there was no such member. */
  removeMember(instituteId: string, userId: string): Promise<boolean>;
}

/** Tests and local dev only. */
export class InMemoryInstituteRepository implements InstituteRepository {
  private readonly institutes = new Map<string, Institute>();
  private readonly memberships: Membership[] = [];
  readonly trials = new Map<string, TrialSubscription>();

  /**
   * In Postgres, institutes and subscriptions live in ONE database, written in one transaction.
   * Passing the subscriptions fake here gives tests the same picture: create an institute,
   * and the subscriptions module can read its trial.
   */
  constructor(private readonly subscriptions?: InMemorySubscriptionRepository) {}

  async createWithOwner(institute: Institute, trial: TrialSubscription): Promise<void> {
    if (this.institutes.has(institute.id)) {
      throw new Error(`InMemoryInstituteRepository: institute ${institute.id} already exists`);
    }
    this.institutes.set(institute.id, institute);
    this.memberships.push({
      instituteId: institute.id,
      userId: institute.createdBy,
      role: 'owner',
    });
    this.trials.set(institute.id, { ...trial });
    this.subscriptions?.put({
      instituteId: institute.id,
      plan: trial.plan,
      status: 'trialing',
      currentPeriodEnd: trial.endsAt,
      graceUntil: null,
    });
  }

  async findById(id: string): Promise<Institute | null> {
    return this.institutes.get(id) ?? null;
  }

  async update(institute: Institute): Promise<void> {
    if (!this.institutes.has(institute.id)) {
      throw new Error(`InMemoryInstituteRepository: no institute ${institute.id}`);
    }
    this.institutes.set(institute.id, institute);
  }

  async findMembership(instituteId: string, userId: string): Promise<Membership | null> {
    const found = this.memberships.find(
      (m) => m.instituteId === instituteId && m.userId === userId,
    );
    return found ? { ...found } : null;
  }

  async listForUser(userId: string): Promise<Array<{ institute: Institute; role: MemberRole }>> {
    return this.memberships
      .filter((m) => m.userId === userId)
      .map((m) => ({ institute: this.institutes.get(m.instituteId), role: m.role }))
      .filter((r): r is { institute: Institute; role: MemberRole } => {
        return r.institute !== undefined && r.institute.archivedAt === null;
      });
  }

  async addMemberWithinLimit(
    membership: Membership,
    maxMembers: number | null,
  ): Promise<AddMemberResult> {
    const ofInstitute = this.memberships.filter((m) => m.instituteId === membership.instituteId);
    if (ofInstitute.some((m) => m.userId === membership.userId)) {
      return 'already_member';
    }
    const nonOwners = ofInstitute.filter((m) => m.role !== 'owner').length;
    if (maxMembers !== null && nonOwners + 1 > maxMembers) {
      return 'limit_reached';
    }
    this.memberships.push({ ...membership });
    return 'added';
  }

  async listMembers(instituteId: string): Promise<Membership[]> {
    return this.memberships.filter((m) => m.instituteId === instituteId).map((m) => ({ ...m }));
  }

  async removeMember(instituteId: string, userId: string): Promise<boolean> {
    const index = this.memberships.findIndex(
      (m) => m.instituteId === instituteId && m.userId === userId && m.role !== 'owner',
    );
    if (index === -1) {
      return false;
    }
    this.memberships.splice(index, 1);
    return true;
  }

  /** TEST HELPER ONLY: add a member directly, skipping the plan limit. */
  addMember(membership: Membership): void {
    this.memberships.push({ ...membership });
  }
}
