import {
  type Clock,
  type FeatureKey,
  type IdGenerator,
  InstituteClock,
  type LocalDate,
  type PhoneNumber,
  zonedInstant,
} from '@coachingdesk/shared';
import type { NewOutboxMessage, OutboxRepository } from './outbox.repository';

// What planning needs from other modules (their services fit; rule 12).
export interface ReminderInstituteLookup {
  get(instituteId: string): Promise<{
    timezone: string;
    settings: { reminderOffsets: number[]; messageLanguage: 'en' | 'hi' };
  }>;
}
export interface ReminderFeatureLookup {
  get(instituteId: string): Promise<{ features: ReadonlySet<FeatureKey> }>;
}
export interface DueInvoicesLookup {
  openDueOn(instituteId: string, dates: LocalDate[]): Promise<Array<{ studentId: string }>>;
}
export interface ReminderStudentLookup {
  findByIds(
    instituteId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; isActive: boolean; guardianPhone: PhoneNumber | null }>>;
}

export interface ReminderPlannerDeps {
  outbox: OutboxRepository;
  institutes: ReminderInstituteLookup;
  entitlements: ReminderFeatureLookup;
  invoices: DueInvoicesLookup;
  students: ReminderStudentLookup;
  ids: IdGenerator;
  clock: Clock;
}

const FEE_REMINDER_PRIORITY = 3;

/** The dedupe key that makes "max one fee reminder per guardian per day" (FR-5.2) a DB rule. */
export function feeReminderKey(
  instituteId: string,
  phone: PhoneNumber,
  day: LocalDate,
  manual = false,
): string {
  return `fee_reminder:${manual ? 'manual:' : ''}${instituteId}:${phone.toE164()}:${day.toString()}`;
}

/** A reminder planned today is stale after 21:00 tomorrow (it would have gone at 08:00). */
export function feeReminderExpiry(today: LocalDate, timezone: string): Date {
  return zonedInstant(today.addDays(1), '21:00', timezone);
}

/**
 * Plans the day's automatic fee reminders (LLD §6.2, FR-5.1/5.2). Safe to run many times a
 * day: the dedupe key allows one reminder per guardian per day. The text is NOT decided here:
 * FeeReminderRenderer works it out at send time from what is due then.
 */
export class ReminderPlanner {
  constructor(private readonly deps: ReminderPlannerDeps) {}

  async planFor(instituteId: string): Promise<{ guardians: number; queued: number }> {
    const [institute, { features }] = await Promise.all([
      this.deps.institutes.get(instituteId),
      this.deps.entitlements.get(instituteId),
    ]);
    const offsets = institute.settings.reminderOffsets;
    if (!features.has('automatic_messages') || offsets.length === 0) {
      return { guardians: 0, queued: 0 }; // Free plan, or the owner turned reminders off
    }
    const today = new InstituteClock(this.deps.clock, institute.timezone).today();
    // offset = days BEFORE the due date: due = today + offset (3 -> due in 3 days, -7 -> 7 days late)
    const dueDates = offsets.map((offset) => today.addDays(offset));
    const invoices = await this.deps.invoices.openDueOn(instituteId, dueDates);
    const students = await this.deps.students.findByIds(instituteId, [
      ...new Set(invoices.map((i) => i.studentId)),
    ]);

    // One reminder per GUARDIAN: siblings share it (FR-5.2). Left students get none (FR-2.5).
    const phones = new Map<string, PhoneNumber>();
    for (const student of students) {
      if (student.isActive && student.guardianPhone) {
        phones.set(student.guardianPhone.toE164(), student.guardianPhone);
      }
    }
    const now = this.deps.clock.now();
    const messages: NewOutboxMessage[] = [...phones.values()].map((phone) => ({
      id: this.deps.ids.next(),
      instituteId,
      to: phone,
      template: 'fee_reminder', // the renderer picks fee_reminder or fee_reminder_multi at send time
      params: {},
      locale: institute.settings.messageLanguage,
      category: 'fee_reminder',
      priority: FEE_REMINDER_PRIORITY,
      scheduledFor: now, // the worker moves it out of quiet hours
      expiresAt: feeReminderExpiry(today, institute.timezone),
      dedupeKey: feeReminderKey(instituteId, phone, today),
      related: { type: 'guardian_dues', id: instituteId },
    }));
    const queued = await this.deps.outbox.enqueueAll(messages);
    return { guardians: phones.size, queued };
  }
}

/** The worker job: plan for every active institute; one failure never blocks the others. */
export class ReminderScheduler {
  constructor(
    private readonly institutes: { listActive(): Promise<Array<{ id: string }>> },
    private readonly planner: { planFor(instituteId: string): Promise<{ queued: number }> },
  ) {}

  async runOnce(): Promise<{
    institutes: number;
    queued: number;
    failed: Array<{ instituteId: string; error: string }>;
  }> {
    const institutes = await this.institutes.listActive();
    const summary = {
      institutes: institutes.length,
      queued: 0,
      failed: [] as Array<{ instituteId: string; error: string }>,
    };
    for (const { id } of institutes) {
      try {
        summary.queued += (await this.planner.planFor(id)).queued;
      } catch (error) {
        summary.failed.push({ instituteId: id, error: String(error) });
      }
    }
    return summary;
  }
}
