import {
  AppError,
  type Clock,
  type FeatureKey,
  type IdGenerator,
  InstituteClock,
  type LocalDate,
  MESSAGE_CAPS,
  type PhoneNumber,
  type SendNoticeBody,
} from '@coachingdesk/shared';
import { buildNoticeContent } from './notice-content';
import type { NoticeRecord, NoticeRepository } from './notice.repository';
import type { NewOutboxMessage, OutboxRepository } from './outbox.repository';
import { feeReminderExpiry } from './reminder-planner';

// What notices need from other modules (their services fit; rule 12).
export interface NoticeDeps {
  notices: NoticeRepository;
  outbox: OutboxRepository;
  institutes: {
    get(instituteId: string): Promise<{
      name: string;
      timezone: string;
      settings: { messageLanguage: 'en' | 'hi' };
    }>;
  };
  batches: {
    get(
      instituteId: string,
      batchId: string,
    ): Promise<{ id: string; name: string; isArchived: boolean }>;
  };
  enrollments: { studentIdsInBatchToday(instituteId: string, batchId: string): Promise<string[]> };
  students: {
    findByIds(
      instituteId: string,
      ids: readonly string[],
    ): Promise<Array<{ isActive: boolean; guardianPhone: PhoneNumber | null }>>;
  };
  entitlements: {
    get(instituteId: string): Promise<{ features: ReadonlySet<FeatureKey> }>;
    messagingLimits(instituteId: string, now: Date): Promise<{ trialTotal: unknown }>;
  };
  quota: {
    report(
      instituteId: string,
      timezone: string,
    ): Promise<{ used: number; limit: number; todayUsed: number; todayLimit: number | null }>;
  };
  ids: IdGenerator;
  clock: Clock;
}

const NOTICE_PRIORITY = 4; // after receipts, absence alerts, fee reminders

/** Notices to the guardians of chosen batches (F-15; API_DOCS §10). */
export class NoticeService {
  constructor(private readonly deps: NoticeDeps) {}

  /** POST /notices/preview: who would get it, and is there quota left (nothing is sent). */
  async preview(instituteId: string, body: SendNoticeBody) {
    const { phones, institute } = await this.prepare(instituteId, body);
    const usage = await this.deps.quota.report(instituteId, institute.timezone);
    const remainingMonth = Math.max(0, usage.limit - usage.used);
    const remainingToday =
      usage.todayLimit === null ? remainingMonth : Math.max(0, usage.todayLimit - usage.todayUsed);
    return {
      recipients: phones.length,
      messagesNeeded: phones.length,
      quotaRemaining: Math.min(remainingMonth, remainingToday),
    };
  }

  /** POST /notices: records the notice and queues one message per guardian. */
  async send(instituteId: string, userId: string, body: SendNoticeBody) {
    const { phones, institute, content, today } = await this.prepare(instituteId, body);
    const { trialTotal } = await this.deps.entitlements.messagingLimits(
      instituteId,
      this.deps.clock.now(),
    );
    const dailyLimit = trialTotal
      ? MESSAGE_CAPS.noticesPerDayTrial
      : MESSAGE_CAPS.noticesPerDayPaid;

    const notice: NoticeRecord = {
      id: this.deps.ids.next(),
      instituteId,
      kind: body.kind,
      batchIds: [...new Set(body.batchIds)],
      content: content.params,
      sentBy: userId,
      recipients: phones.length,
      day: today,
      createdAt: this.deps.clock.now(),
    };
    if (!(await this.deps.notices.createWithinDailyLimit(notice, dailyLimit))) {
      throw new AppError(
        'DAILY_LIMIT_REACHED',
        `At most ${dailyLimit} notices a day on your plan`,
        {
          limit: dailyLimit,
        },
      );
    }
    const now = this.deps.clock.now();
    const messages: NewOutboxMessage[] = phones.map((phone) => ({
      id: this.deps.ids.next(),
      instituteId,
      to: phone,
      template: content.template,
      params: content.params,
      locale: institute.settings.messageLanguage,
      category: 'notice',
      priority: NOTICE_PRIORITY,
      scheduledFor: now, // the worker handles quiet hours, consent and quota
      expiresAt: feeReminderExpiry(today, institute.timezone), // stale after 21:00 tomorrow
      dedupeKey: `notice:${notice.id}:${phone.toE164()}`,
      related: { type: 'notice', id: notice.id },
    }));
    const queued = await this.deps.outbox.enqueueAll(messages);
    return { notice, queued };
  }

  async list(instituteId: string, limit: number): Promise<NoticeRecord[]> {
    return this.deps.notices.list(instituteId, limit);
  }

  /** Shared by preview and send: plan, batches, content rules, distinct guardian phones. */
  private async prepare(instituteId: string, body: SendNoticeBody) {
    const { features } = await this.deps.entitlements.get(instituteId);
    if (!features.has('automatic_messages')) {
      throw new AppError('FEATURE_NOT_IN_PLAN', 'Your plan does not include WhatsApp notices', {
        feature: 'automatic_messages',
      });
    }
    const institute = await this.deps.institutes.get(instituteId);
    const today = new InstituteClock(this.deps.clock, institute.timezone).today();
    const batches = [];
    for (const batchId of new Set(body.batchIds)) {
      const batch = await this.deps.batches.get(instituteId, batchId); // 404
      if (batch.isArchived) {
        throw new AppError('CONFLICT', 'This batch is archived', { batchId });
      }
      batches.push(batch);
    }
    const content = buildNoticeContent(body, {
      institute: institute.name,
      batchNames: batches.map((b) => b.name),
      today,
    });
    const studentIds = new Set<string>();
    for (const batch of batches) {
      for (const id of await this.deps.enrollments.studentIdsInBatchToday(instituteId, batch.id)) {
        studentIds.add(id);
      }
    }
    const students = await this.deps.students.findByIds(instituteId, [...studentIds]);
    // One message per GUARDIAN, even with children in several of the batches.
    const phones = new Map<string, PhoneNumber>();
    for (const s of students) {
      if (s.isActive && s.guardianPhone) {
        phones.set(s.guardianPhone.toE164(), s.guardianPhone);
      }
    }
    return { phones: [...phones.values()], institute, content, today: today as LocalDate };
  }
}
