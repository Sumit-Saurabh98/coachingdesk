import {
  AppError,
  type Clock,
  type FeatureKey,
  type IdGenerator,
  InstituteClock,
  type PhoneNumber,
} from '@coachingdesk/shared';
import type { OutboxRepository } from './outbox.repository';
import { quietHoursEnd } from './quiet-hours';
import { feeReminderExpiry, feeReminderKey } from './reminder-planner';

// What "remind now" needs from other modules (their services fit; rule 12).
export interface RemindInvoiceLookup {
  get(instituteId: string, invoiceId: string): Promise<{ studentId: string; isOpen: boolean }>;
}
export interface RemindStudentLookup {
  get(instituteId: string, studentId: string): Promise<{ guardianPhone: PhoneNumber | null }>;
}
export interface RemindInstituteLookup {
  get(
    instituteId: string,
  ): Promise<{ timezone: string; settings: { messageLanguage: 'en' | 'hi' } }>;
}
export interface RemindFeatureLookup {
  get(instituteId: string): Promise<{ features: ReadonlySet<FeatureKey> }>;
}

export interface FeeRemindersDeps {
  outbox: OutboxRepository;
  invoices: RemindInvoiceLookup;
  students: RemindStudentLookup;
  institutes: RemindInstituteLookup;
  entitlements: RemindFeatureLookup;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * "Remind now" (LLD §6.2, API_DOCS §8). Same one-per-guardian-per-day rule as the automatic
 * reminders (same dedupe key); `force` (owner) allows ONE extra a day. Quiet hours always apply:
 * the answer says when it will actually go out.
 */
export class FeeReminders {
  constructor(private readonly deps: FeeRemindersDeps) {}

  async remindNow(
    instituteId: string,
    invoiceId: string,
    force: boolean,
  ): Promise<{ scheduledFor: Date }> {
    const invoice = await this.deps.invoices.get(instituteId, invoiceId); // 404
    if (!invoice.isOpen) {
      throw new AppError('NOTHING_DUE', 'Nothing is due on this invoice');
    }
    const { features } = await this.deps.entitlements.get(instituteId);
    if (!features.has('automatic_messages')) {
      // Free plan: no messages from our number ("Share via WhatsApp" opens WhatsApp instead).
      throw new AppError('FEATURE_NOT_IN_PLAN', 'Your plan does not include WhatsApp reminders', {
        feature: 'automatic_messages',
      });
    }
    const { guardianPhone } = await this.deps.students.get(instituteId, invoice.studentId);
    if (!guardianPhone) {
      throw new AppError('CONFLICT', "This student's guardian has no phone number on file");
    }
    const institute = await this.deps.institutes.get(instituteId);
    const today = new InstituteClock(this.deps.clock, institute.timezone).today();
    const now = this.deps.clock.now();
    const scheduledFor = quietHoursEnd(this.deps.clock, institute.timezone) ?? now;

    const queued = await this.deps.outbox.enqueueAll([
      {
        id: this.deps.ids.next(),
        instituteId,
        to: guardianPhone,
        template: 'fee_reminder', // the send worker renders the final text from current dues
        params: {},
        locale: institute.settings.messageLanguage,
        category: 'fee_reminder',
        priority: 3,
        scheduledFor,
        expiresAt: feeReminderExpiry(today, institute.timezone),
        dedupeKey: feeReminderKey(instituteId, guardianPhone, today, force),
        related: { type: 'guardian_dues', id: instituteId },
      },
    ]);
    if (queued === 0) {
      throw new AppError(
        'ALREADY_REMINDED_TODAY',
        force
          ? 'An extra reminder was already sent to this guardian today'
          : 'This guardian already got a fee reminder today',
      );
    }
    return { scheduledFor };
  }
}
