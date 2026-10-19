import {
  AppError,
  FEE_CYCLES,
  type FeeCycle,
  InvalidMoneyError,
  Money,
} from '@coachingdesk/shared';
import { BatchSchedule, type BatchScheduleInput } from './batch-schedule';

/** What an owner/staff types when creating a batch (after Zod defaults are applied). */
export interface NewBatchInput {
  name: string;
  subject?: string | null;
  schedule: BatchScheduleInput;
  defaultFeePaise: number;
  defaultFeeCycle: FeeCycle;
}

/** PATCH: only the fields that change. */
export interface BatchChanges {
  name?: string;
  subject?: string | null;
  schedule?: BatchScheduleInput;
  defaultFeePaise?: number;
  defaultFeeCycle?: FeeCycle;
}

/**
 * Every field of a batch, as the entity holds it. Note schedule and defaultFee are VALUE
 * OBJECTS, not raw JSON/numbers: the repository builds them (BatchSchedule.of, Money.ofPaise)
 * when loading, so a Batch can never hold an invalid schedule or a negative fee.
 */
export interface BatchProps {
  id: string;
  instituteId: string;
  name: string;
  subject: string | null;
  schedule: BatchSchedule;
  defaultFee: Money;
  defaultFeeCycle: FeeCycle;
  archivedAt: Date | null;
}

/**
 * A group taught together at fixed days/time. Belongs to exactly one institute.
 * defaultFee/defaultFeeCycle are only DEFAULTS: they're copied into each new enrollment
 * (Step 12), and changing them never changes existing enrollments.
 */
export class Batch {
  readonly id: string;
  readonly instituteId: string;
  readonly name: string;
  readonly subject: string | null;
  readonly schedule: BatchSchedule;
  readonly defaultFee: Money;
  readonly defaultFeeCycle: FeeCycle;
  readonly archivedAt: Date | null;

  private constructor(props: BatchProps) {
    this.id = props.id;
    this.instituteId = props.instituteId;
    this.name = props.name;
    this.subject = props.subject;
    this.schedule = props.schedule;
    this.defaultFee = props.defaultFee;
    this.defaultFeeCycle = props.defaultFeeCycle;
    this.archivedAt = props.archivedAt;
  }

  static create(id: string, instituteId: string, input: NewBatchInput): Batch {
    return new Batch({
      id,
      instituteId,
      name: cleanName(input.name),
      subject: cleanSubject(input.subject),
      schedule: BatchSchedule.of(input.schedule),
      defaultFee: toFee(input.defaultFeePaise),
      defaultFeeCycle: checkCycle(input.defaultFeeCycle),
      archivedAt: null,
    });
  }

  /**
   * Rebuild a stored batch. Nothing to re-check here: the props already hold value objects,
   * which can only exist if they're valid (compare Institute.restore, which gets raw numbers).
   */
  static restore(props: BatchProps): Batch {
    return new Batch(props);
  }

  get isArchived(): boolean {
    return this.archivedAt !== null;
  }

  /** Returns a new Batch with the changes applied (same rules as create). */
  withChanges(changes: BatchChanges): Batch {
    if (this.isArchived) {
      // FR-2.1: archived batches keep their history; editing them would rewrite it.
      throw new AppError('CONFLICT', 'An archived batch cannot be changed', { batchId: this.id });
    }
    return new Batch({
      ...this.toProps(),
      name: changes.name === undefined ? this.name : cleanName(changes.name),
      subject: changes.subject === undefined ? this.subject : cleanSubject(changes.subject),
      schedule: changes.schedule === undefined ? this.schedule : BatchSchedule.of(changes.schedule),
      defaultFee:
        changes.defaultFeePaise === undefined ? this.defaultFee : toFee(changes.defaultFeePaise),
      defaultFeeCycle:
        changes.defaultFeeCycle === undefined
          ? this.defaultFeeCycle
          : checkCycle(changes.defaultFeeCycle),
    });
  }

  /**
   * Archive = hide from lists, keep all history. Idempotent: archiving twice returns the
   * batch unchanged (and keeps the FIRST archive time), so a retried request is harmless.
   */
  archive(at: Date): Batch {
    if (this.isArchived) {
      return this;
    }
    return new Batch({ ...this.toProps(), archivedAt: at });
  }

  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      subject: this.subject,
      schedule: this.schedule.toJSON(),
      defaultFeePaise: this.defaultFee.toPaise(),
      defaultFeeCycle: this.defaultFeeCycle,
      archivedAt: this.archivedAt?.toISOString() ?? null,
    };
  }

  toProps(): BatchProps {
    return {
      id: this.id,
      instituteId: this.instituteId,
      name: this.name,
      subject: this.subject,
      schedule: this.schedule,
      defaultFee: this.defaultFee,
      defaultFeeCycle: this.defaultFeeCycle,
      archivedAt: this.archivedAt,
    };
  }
}

// --- rules (private to this file) ---

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    throw invalid('name', 'Batch name must be 2 to 80 characters');
  }
  return name;
}

function cleanSubject(raw: string | null | undefined): string | null {
  const subject = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (subject.length > 60) {
    throw invalid('subject', 'Subject must be at most 60 characters');
  }
  return subject === '' ? null : subject;
}

function toFee(paise: number): Money {
  // Money has its own error type; translate it into our API error so the client gets a 422
  // that names the field, not a 500.
  try {
    return Money.ofPaise(paise);
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      throw invalid('defaultFeePaise', error.message);
    }
    throw error;
  }
}

function checkCycle(cycle: FeeCycle): FeeCycle {
  if (!FEE_CYCLES.includes(cycle)) {
    throw invalid('defaultFeeCycle', `Fee cycle must be one of: ${FEE_CYCLES.join(', ')}`);
  }
  return cycle;
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field });
}
