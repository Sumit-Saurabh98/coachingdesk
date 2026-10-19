import {
  AppError,
  FEE_CYCLES,
  type FeeCycle,
  InvalidMoneyError,
  type LocalDate,
  Money,
} from '@coachingdesk/shared';

/** A new enrollment, after the service filled in the batch defaults. */
export interface NewEnrollmentInput {
  studentId: string;
  batchId: string;
  feePaise: number;
  discountPaise: number;
  feeCycle: FeeCycle;
  startDate: LocalDate;
}

/** Changes to the money terms. Apply from the NEXT billing period (LLD §6.1). */
export interface EnrollmentTermsChanges {
  feePaise?: number;
  discountPaise?: number;
  feeCycle?: FeeCycle;
}

export interface EnrollmentProps {
  id: string;
  instituteId: string;
  studentId: string;
  batchId: string;
  fee: Money;
  discount: Money;
  feeCycle: FeeCycle;
  cycleAnchor: LocalDate | null; // set by billing (Phase 3)
  startDate: LocalDate;
  endDate: LocalDate | null;
}

/**
 * Student <-> batch, with THIS student's money terms. Billing reads these, never the batch:
 * the batch's default fee is copied in at enrollment and can then be changed per student.
 */
export class Enrollment {
  readonly id: string;
  readonly instituteId: string;
  readonly studentId: string;
  readonly batchId: string;
  readonly fee: Money;
  readonly discount: Money;
  readonly feeCycle: FeeCycle;
  readonly cycleAnchor: LocalDate | null;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;

  private constructor(props: EnrollmentProps) {
    this.id = props.id;
    this.instituteId = props.instituteId;
    this.studentId = props.studentId;
    this.batchId = props.batchId;
    this.fee = props.fee;
    this.discount = props.discount;
    this.feeCycle = props.feeCycle;
    this.cycleAnchor = props.cycleAnchor;
    this.startDate = props.startDate;
    this.endDate = props.endDate;
  }

  static create(id: string, instituteId: string, input: NewEnrollmentInput): Enrollment {
    const fee = toMoney('feePaise', input.feePaise);
    const discount = toMoney('discountPaise', input.discountPaise);
    assertDiscountFits(fee, discount);
    return new Enrollment({
      id,
      instituteId,
      studentId: input.studentId,
      batchId: input.batchId,
      fee,
      discount,
      feeCycle: checkCycle(input.feeCycle),
      cycleAnchor: null,
      startDate: input.startDate,
      endDate: null,
    });
  }

  static restore(props: EnrollmentProps): Enrollment {
    return new Enrollment(props);
  }

  /** What one billing period costs: fee minus discount. Never negative (discount <= fee). */
  get netFee(): Money {
    return this.fee.subtract(this.discount);
  }

  /** Enrolled on this date? Start and end dates are both inclusive. */
  isActiveOn(date: LocalDate): boolean {
    return !date.isBefore(this.startDate) && (this.endDate === null || !date.isAfter(this.endDate));
  }

  withTerms(changes: EnrollmentTermsChanges): Enrollment {
    const fee = changes.feePaise === undefined ? this.fee : toMoney('feePaise', changes.feePaise);
    const discount =
      changes.discountPaise === undefined
        ? this.discount
        : toMoney('discountPaise', changes.discountPaise);
    // Checked on the COMBINATION: lowering only the fee can make the old discount too big.
    assertDiscountFits(fee, discount);
    return new Enrollment({
      ...this.toProps(),
      fee,
      discount,
      feeCycle: changes.feeCycle === undefined ? this.feeCycle : checkCycle(changes.feeCycle),
    });
  }

  /**
   * The student stops attending this batch after `on` (inclusive). Setting it again moves the
   * date (owners correct mistakes); it can't be before the start.
   */
  endOn(on: LocalDate): Enrollment {
    if (on.isBefore(this.startDate)) {
      throw invalid('endDate', 'End date cannot be before the start date');
    }
    return new Enrollment({ ...this.toProps(), endDate: on });
  }

  toPublicJSON() {
    return {
      id: this.id,
      studentId: this.studentId,
      batchId: this.batchId,
      feePaise: this.fee.toPaise(),
      discountPaise: this.discount.toPaise(),
      netFeePaise: this.netFee.toPaise(),
      feeCycle: this.feeCycle,
      startDate: this.startDate.toString(),
      endDate: this.endDate?.toString() ?? null,
    };
  }

  toProps(): EnrollmentProps {
    return {
      id: this.id,
      instituteId: this.instituteId,
      studentId: this.studentId,
      batchId: this.batchId,
      fee: this.fee,
      discount: this.discount,
      feeCycle: this.feeCycle,
      cycleAnchor: this.cycleAnchor,
      startDate: this.startDate,
      endDate: this.endDate,
    };
  }
}

// --- rules (private to this file) ---

function assertDiscountFits(fee: Money, discount: Money): void {
  if (discount.isGreaterThan(fee)) {
    throw invalid('discountPaise', 'Discount cannot be more than the fee');
  }
}

function toMoney(field: string, paise: number): Money {
  try {
    return Money.ofPaise(paise);
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      throw invalid(field, error.message);
    }
    throw error;
  }
}

function checkCycle(cycle: FeeCycle): FeeCycle {
  if (!FEE_CYCLES.includes(cycle)) {
    throw invalid('feeCycle', `Fee cycle must be one of: ${FEE_CYCLES.join(', ')}`);
  }
  return cycle;
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field });
}
