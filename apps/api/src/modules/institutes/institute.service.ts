import { AppError, type Clock, type IdGenerator } from '@coachingdesk/shared';
import type { UserService } from '../users/user.service';
import {
  type BillingSettingsChanges,
  type DetailsChanges,
  Institute,
  type NewInstituteInput,
} from './institute';
import type { InstituteRepository, MemberRole, Membership } from './institute.repository';

const TRIAL_DAYS = 30; // KNOWLEDGE_BASE §3: 30 days of Pro on signup
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstituteServiceDeps {
  institutes: InstituteRepository;
  users: UserService; // another module: we use its SERVICE, never its repository (rule 12)
  ids: IdGenerator;
  clock: Clock;
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
}
