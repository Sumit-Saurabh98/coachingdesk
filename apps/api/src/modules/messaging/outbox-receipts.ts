import type { Clock, FeatureKey, IdGenerator, PhoneNumber } from '@coachingdesk/shared';
import type { ReceiptQueue } from '../fees/payment.service';
import type { OutboxRepository } from './outbox.repository';
import { receiptDedupeKey } from './receipt-messages';

export interface OutboxReceiptsDeps {
  outbox: OutboxRepository;
  institutes: { get(instituteId: string): Promise<{ settings: { messageLanguage: 'en' | 'hi' } }> };
  entitlements: { get(instituteId: string): Promise<{ features: ReadonlySet<FeatureKey> }> };
  ids: IdGenerator;
  clock: Clock;
}

const RECEIPT_PRIORITY = 1; // first of all: the guardian just paid and is waiting for it
/** A receipt that couldn't go out for 3 days (outage) is not worth sending any more. */
const EXPIRES_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Payment receipts via the outbox (FR-4.6, AGENTS rule 4). Queued with no text: the worker
 * renders it at send time from the payment as it is then (ReceiptRenderer), and skips it if
 * the payment was voided meanwhile.
 */
export class OutboxReceipts implements ReceiptQueue {
  constructor(private readonly deps: OutboxReceiptsDeps) {}

  async paymentRecorded(input: {
    instituteId: string;
    paymentId: string;
    guardianPhone: PhoneNumber;
    studentPhones: Array<{ studentId: string; phone: PhoneNumber }>;
  }): Promise<boolean> {
    // FR-4.6: "if messaging is enabled for the plan" (Free shares receipts by hand).
    const { features } = await this.deps.entitlements.get(input.instituteId);
    if (!features.has('automatic_messages')) {
      return false;
    }
    const institute = await this.deps.institutes.get(input.instituteId);
    const now = this.deps.clock.now();
    // The guardian's receipt, plus a copy for each paid-for student's own number (KB #50).
    const recipients = [
      { to: input.guardianPhone, studentId: undefined },
      ...input.studentPhones.map((s) => ({ to: s.phone, studentId: s.studentId })),
    ];
    const added = await this.deps.outbox.enqueueAll(
      recipients.map(({ to, studentId }) => ({
        id: this.deps.ids.next(),
        instituteId: input.instituteId,
        to,
        template: 'payment_receipt',
        params: {}, // rendered at send time
        locale: institute.settings.messageLanguage,
        category: 'receipt',
        priority: RECEIPT_PRIORITY,
        scheduledFor: now,
        expiresAt: new Date(now.getTime() + EXPIRES_AFTER_MS),
        dedupeKey: receiptDedupeKey(input.paymentId, studentId),
        related: { type: 'payment', id: input.paymentId },
      })),
    );
    return added > 0;
  }
}
