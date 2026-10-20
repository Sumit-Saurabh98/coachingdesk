import { AppError, type Money } from '@coachingdesk/shared';
import type { Revalidation, Revalidator } from './outbox-dispatcher';
import type { OutboxMessage } from './outbox.repository';
import { joinNames, rupees } from './message-format';
import { parseReceiptDedupeKey } from './receipt-messages';

/** PaymentService.receipt fits. */
export interface ReceiptLookup {
  receipt(
    instituteId: string,
    paymentId: string,
  ): Promise<{
    payment: { status: string; amount: Money };
    institute: { name: string };
    lines: Array<{ studentName: string }>;
  }>;
}

/**
 * LLD §6.3: a receipt is sent only while the payment is still active (voided -> stale), and
 * says what the payment is NOW. KB template payment_receipt:
 * "Received ₹{{amount}} for {{students}} at {{institute}}. Thank you!"
 */
export class ReceiptRenderer implements Revalidator {
  constructor(private readonly payments: ReceiptLookup) {}

  async check(message: OutboxMessage): Promise<Revalidation> {
    const key = parseReceiptDedupeKey(message.dedupeKey);
    if (!key) {
      return { kind: 'skip', reason: 'stale' };
    }
    let receipt;
    try {
      receipt = await this.payments.receipt(message.instituteId, key.paymentId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') {
        return { kind: 'skip', reason: 'stale' }; // the institute was purged meanwhile
      }
      throw error; // a real failure: the dispatcher retries
    }
    // Erased students have no name: leave them out rather than print a blank.
    const names = [...new Set(receipt.lines.map((l) => l.studentName).filter((n) => n !== ''))];
    if (receipt.payment.status !== 'active' || names.length === 0) {
      return { kind: 'skip', reason: 'stale' };
    }
    return {
      kind: 'send',
      params: {
        amount: rupees(receipt.payment.amount),
        students: joinNames(names),
        institute: receipt.institute.name,
      },
    };
  }
}
