import {
  AppError,
  type Clock,
  type IdGenerator,
  type PhoneNumber,
  TRIAL_DAYS,
} from '@coachingdesk/shared';
import { planLimitReached } from '../entitlements/entitlements.service';
import type { UserService } from '../users/user.service';
import {
  type BillingSettingsChanges,
  type DetailsChanges,
  Institute,
  type NewInstituteInput,
} from './institute';
import type { InstituteRepository, MemberRole, Membership } from './institute.repository';
import type { User } from '../users/user';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What institutes needs from entitlements: the member limit (ISP). EntitlementsService fits. */
export interface MemberLimitLookup {
  limitFor(instituteId: string, limit: 'members'): Promise<number | null>;
}

export interface InstituteServiceDeps {
  institutes: InstituteRepository;
  users: UserService; // another module: we use its SERVICE, never its repository (rule 12)
  entitlements: MemberLimitLookup;
  ids: IdGenerator;
  clock: Clock;
}

/** A member as the owner sees them in the team list. */
export interface MemberView {
  userId: string;
  name: string | null;
  phone: PhoneNumber;
  role: MemberRole;
}

export interface NewMemberRequest {
  phone: PhoneNumber;
  name: string;
  role: 'teacher' | 'staff';
}

export interface CreatedInstitute {
  institute: Institute;
  role: 'owner';
  trialEndsAt: Date;
}

/** The public face of the institutes module. */
export class InstituteService {
  constructor(private readonly deps: InstituteServiceDeps) {}

  /** POST /v1/institutes: the caller becomes the owner, and the 30-day Pro trial starts now. */
  async create(ownerId: string, input: NewInstituteInput): Promise<CreatedInstitute> {
    // A valid token whose account is gone would otherwise fail on the foreign key with a 500.
    // getProfile turns that into a clear 401.
    await this.deps.users.getProfile(ownerId);

    const institute = Institute.create(this.deps.ids.next(), input, ownerId);
    const trialEndsAt = new Date(this.deps.clock.now().getTime() + TRIAL_DAYS * DAY_MS);
    await this.deps.institutes.createWithOwner(institute, { plan: 'pro', endsAt: trialEndsAt });
    return { institute, role: 'owner', trialEndsAt };
  }

  /**
   * The institutes a user belongs to, as plain data. The users module (GET /v1/me) calls this
   * through its own UserInstitutesLookup interface: this method's SHAPE matches it.
   */
  async listForUser(
    userId: string,
  ): Promise<Array<{ id: string; name: string; type: string; role: MemberRole }>> {
    const rows = await this.deps.institutes.listForUser(userId);
    return rows.map(({ institute, role }) => ({
      id: institute.id,
      name: institute.name,
      type: institute.type,
      role,
    }));
  }

  async findMembership(instituteId: string, userId: string): Promise<Membership | null> {
    return this.deps.institutes.findMembership(instituteId, userId);
  }

  /** Called only behind the tenancy guard, so the institute id is already a verified membership. */
  async get(instituteId: string): Promise<Institute> {
    const institute = await this.deps.institutes.findById(instituteId);
    if (!institute) {
      throw new AppError('NOT_FOUND', 'Institute not found');
    }
    return institute;
  }

  /** PATCH /v1/institutes/:id (owner only). The entity applies the rules; we load, change, save. */
  async update(
    instituteId: string,
    changes: DetailsChanges & BillingSettingsChanges,
  ): Promise<Institute> {
    const updated = (await this.get(instituteId))
      .withDetails({ name: changes.name, city: changes.city })
      .withBillingSettings({ billingDay: changes.billingDay, dueAfterDays: changes.dueAfterDays });
    await this.deps.institutes.update(updated);
    return updated;
  }

  /** GET /members (owner): the team, owner first, with names and phones from the users module. */
  async listMembers(instituteId: string): Promise<MemberView[]> {
    const members = await this.deps.institutes.listMembers(instituteId);
    const users = await this.deps.users.findByIds(members.map((m) => m.userId));
    const byId = new Map(users.map((u) => [u.id, u]));
    return members.flatMap((m) => {
      const user = byId.get(m.userId);
      return user ? [toView(user, m.role)] : [];
    });
  }

  /**
   * POST /members (owner). Adds by phone: the user row is created if the phone is new, and they
   * get access on their first OTP login (API_DOCS §4). 409 already a member, 402 plan limit.
   */
  async addMember(instituteId: string, request: NewMemberRequest): Promise<MemberView> {
    const { user } = await this.deps.users.findOrCreateByPhone(request.phone);
    // The name the owner typed is used only if the person hasn't set their own. Validate it
    // BEFORE adding, so a bad name can't leave a half-done member behind.
    const named = user.name === null ? user.withProfile({ name: request.name }) : user;

    const limit = await this.deps.entitlements.limitFor(instituteId, 'members');
    const result = await this.deps.institutes.addMemberWithinLimit(
      { instituteId, userId: user.id, role: request.role },
      limit,
    );
    if (result === 'already_member') {
      throw new AppError('CONFLICT', 'This person is already a member of the institute', {
        userId: user.id,
      });
    }
    if (result === 'limit_reached') {
      throw planLimitReached('members', limit ?? 0);
    }
    if (named !== user) {
      await this.deps.users.updateProfile(user.id, { name: named.name ?? undefined });
    }
    return toView(named, request.role);
  }

  /** DELETE /members/:userId (owner). The owner can't be removed (409); unknown member: 404. */
  async removeMember(instituteId: string, userId: string): Promise<void> {
    if (await this.deps.institutes.removeMember(instituteId, userId)) {
      return;
    }
    const membership = await this.deps.institutes.findMembership(instituteId, userId);
    if (membership?.role === 'owner') {
      throw new AppError('CONFLICT', 'The owner cannot be removed from the institute');
    }
    throw new AppError('NOT_FOUND', 'Member not found');
  }

  async ownsAnyInstitute(userId: string): Promise<boolean> {
    return this.deps.institutes.ownsAnyInstitute(userId);
  }

  async removeAllMembershipsOf(userId: string): Promise<void> {
    await this.deps.institutes.removeAllMembershipsOf(userId);
  }
}

function toView(user: User, role: MemberRole): MemberView {
  return { userId: user.id, name: user.name, phone: user.phone, role };
}
