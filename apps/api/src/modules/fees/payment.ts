import { AppError, InvalidMoneyError, Money, type PhoneNumber } from '@coachingdesk/shared';

export const PAYMENT_METHODS = ['upi_link', 'cash', 'bank', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type OfflineMethod = Exclude<PaymentMethod, 'upi_link'>;
export const PAYMENT_STATUSES = ['active', 'voided', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PaymentProps {
  id: string;
  instituteId: string;
  guardianPhone: PhoneNumber | null; // null once the guardian's data was erased
  amount: Money;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date;
  note: string | null;
  recordedBy: string | null;
  idempotencyKey: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface OfflinePaymentInput {
  guardianPhone: PhoneNumber;
  amountPaise: number;
  method: OfflineMethod;
  paidAt: Date;
  note?: string | null;
  recordedBy: string;
  idempotencyKey: string | null;
}

/** A clock tolerance for "paid at": a phone a few minutes ahead must not get a 422. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Money received. Never deleted or edited: a mistake is voided (FR-4.4), history stays. */
export class Payment {
  readonly id: string;
  readonly instituteId: string;
  readonly guardianPhone: PhoneNumber | null;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly paidAt: Date;
  readonly note: string | null;
  readonly recordedBy: string | null;
  readonly idempotencyKey: string | null;
  readonly voidedAt: Date | null;
  readonly voidedBy: string | null;
  readonly voidReason: string | null;

  private constructor(props: PaymentProps) {
    this.id = props.id;
    this.instituteId = props.instituteId;
    this.guardianPhone = props.guardianPhone;
    this.amount = props.amount;
    this.method = props.method;
    this.status = props.status;
    this.paidAt = props.paidAt;
    this.note = props.note;
    this.recordedBy = props.recordedBy;
    this.idempotencyKey = props.idempotencyKey;
    this.voidedAt = props.voidedAt;
    this.voidedBy = props.voidedBy;
    this.voidReason = props.voidReason;
  }

  /** FR-4.4: cash / bank / other, entered by owner or staff. */
  static recordOffline(
    id: string,
    instituteId: string,
    input: OfflinePaymentInput,
    now: Date,
  ): Payment {
    let amount: Money;
    try {
      amount = Money.ofPaise(input.amountPaise);
    } catch (error) {
      if (error instanceof InvalidMoneyError) {
        throw invalid('amountPaise', error.message);
      }
      throw error;
    }
    if (amount.isZero()) {
      throw invalid('amountPaise', 'Amount must be more than zero');
    }
    if (input.paidAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      throw invalid('paidAt', 'A payment cannot be in the future');
    }
    const note = (input.note ?? '').trim();
    if (note.length > 500) {
      throw invalid('note', 'Note must be at most 500 characters');
    }
    return new Payment({
      id,
      instituteId,
      guardianPhone: input.guardianPhone,
      amount,
      method: input.method,
      status: 'active',
      paidAt: input.paidAt,
      note: note === '' ? null : note,
      recordedBy: input.recordedBy,
      idempotencyKey: input.idempotencyKey,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    });
  }

  static restore(props: PaymentProps): Payment {
    return new Payment(props);
  }

  get isActive(): boolean {
    return this.status === 'active';
  }

  /**
   * LLD §6.7: owner voids an OFFLINE payment entered by mistake. Online (UPI link) money is
   * reversed only by a provider refund, so it can't be voided here.
   */
  void(by: string, reason: string, at: Date): Payment {
    if (this.method === 'upi_link') {
      throw new AppError('CONFLICT', 'Online payments are reversed by a refund, not voided');
    }
    if (!this.isActive) {
      throw new AppError('CONFLICT', `This payment is already ${this.status}`);
    }
    const why = reason.trim().replace(/\s+/g, ' ');
    if (why.length === 0 || why.length > 200) {
      throw invalid('reason', 'reason must be 1 to 200 characters');
    }
    return new Payment({
      ...this.toProps(),
      status: 'voided',
      voidedAt: at,
      voidedBy: by,
      voidReason: why,
    });
  }

  toPublicJSON() {
    return {
      id: this.id,
      guardianPhone: this.guardianPhone?.toE164() ?? null,
      amountPaise: this.amount.toPaise(),
      method: this.method,
      status: this.status,
      paidAt: this.paidAt.toISOString(),
      note: this.note,
      voidedAt: this.voidedAt?.toISOString() ?? null,
      voidReason: this.voidReason,
    };
  }

  toProps(): PaymentProps {
    return {
      id: this.id,
      instituteId: this.instituteId,
      guardianPhone: this.guardianPhone,
      amount: this.amount,
      method: this.method,
      status: this.status,
      paidAt: this.paidAt,
      note: this.note,
      recordedBy: this.recordedBy,
      idempotencyKey: this.idempotencyKey,
      voidedAt: this.voidedAt,
      voidedBy: this.voidedBy,
      voidReason: this.voidReason,
    };
  }
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field });
}
