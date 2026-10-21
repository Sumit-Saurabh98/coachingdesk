import {
  AppError,
  type LocalDate,
  type PhoneNumber,
  type StudentStatus,
} from '@coachingdesk/shared';

/** What owner/staff enter for a new student. Phone and date are already value objects (Zod). */
export interface NewStudentInput {
  name: string;
  guardianName?: string | null;
  guardianPhone: PhoneNumber;
  studentPhone?: PhoneNumber | null;
  joinedOn: LocalDate;
  notes?: string | null;
  rollNumber?: string | null;
}

/** PATCH: only the fields that change. Status changes go through leave(), not here. */
export interface StudentChanges {
  name?: string;
  guardianName?: string | null;
  guardianPhone?: PhoneNumber;
  studentPhone?: PhoneNumber | null;
  joinedOn?: LocalDate;
  notes?: string | null;
  rollNumber?: string | null;
}

export interface StudentProps {
  id: string;
  instituteId: string;
  name: string;
  guardianName: string | null;
  /** null only for an erased student (DB check students_guardian_phone_check). */
  guardianPhone: PhoneNumber | null;
  /** The student's own mobile (optional). Messages go there only with its own consent. */
  studentPhone: PhoneNumber | null;
  status: StudentStatus;
  joinedOn: LocalDate;
  leftOn: LocalDate | null;
  notes: string | null;
  /** Optional, text ("12", "12A"); unique among the institute's active students (DB index). */
  rollNumber: string | null;
  erasedAt: Date | null;
}

/**
 * A learner at one institute. The GUARDIAN is the contact: guardianPhone is who gets messages
 * and whose pay page shows this student's dues. Siblings share a guardian phone.
 *
 * Lifecycle: active --leave(on)--> left. A left student stays (history, old dues) but stops
 * getting new invoices and reminders (FR-2.5) and stops counting toward the plan limit.
 */
export class Student {
  readonly id: string;
  readonly instituteId: string;
  readonly name: string;
  readonly guardianName: string | null;
  readonly guardianPhone: PhoneNumber | null;
  readonly studentPhone: PhoneNumber | null;
  readonly status: StudentStatus;
  readonly joinedOn: LocalDate;
  readonly leftOn: LocalDate | null;
  readonly notes: string | null;
  readonly rollNumber: string | null;
  readonly erasedAt: Date | null;

  private constructor(props: StudentProps) {
    this.id = props.id;
    this.instituteId = props.instituteId;
    this.name = props.name;
    this.guardianName = props.guardianName;
    this.guardianPhone = props.guardianPhone;
    this.studentPhone = props.studentPhone;
    this.status = props.status;
    this.joinedOn = props.joinedOn;
    this.leftOn = props.leftOn;
    this.notes = props.notes;
    this.rollNumber = props.rollNumber;
    this.erasedAt = props.erasedAt;
  }

  static create(id: string, instituteId: string, input: NewStudentInput): Student {
    return new Student({
      id,
      instituteId,
      name: cleanName(input.name),
      guardianName: cleanGuardianName(input.guardianName),
      guardianPhone: input.guardianPhone,
      studentPhone: checkStudentPhone(input.studentPhone ?? null, input.guardianPhone),
      status: 'active',
      joinedOn: input.joinedOn,
      leftOn: null,
      notes: cleanNotes(input.notes),
      rollNumber: cleanRollNumber(input.rollNumber),
      erasedAt: null,
    });
  }

  /** Rebuild a stored student (phone and dates are already value objects, built by the repo). */
  static restore(props: StudentProps): Student {
    return new Student(props);
  }

  get isActive(): boolean {
    return this.status === 'active';
  }

  withChanges(changes: StudentChanges): Student {
    this.assertNotErased();
    const joinedOn = changes.joinedOn ?? this.joinedOn;
    if (this.leftOn && this.leftOn.isBefore(joinedOn)) {
      throw invalid('joinedOn', 'Join date cannot be after the date the student left');
    }
    const guardianPhone = changes.guardianPhone ?? this.guardianPhone;
    const studentPhone = checkStudentPhone(
      changes.studentPhone === undefined ? this.studentPhone : changes.studentPhone,
      guardianPhone,
    );
    return new Student({
      ...this.toProps(),
      name: changes.name === undefined ? this.name : cleanName(changes.name),
      guardianName:
        changes.guardianName === undefined
          ? this.guardianName
          : cleanGuardianName(changes.guardianName),
      guardianPhone,
      studentPhone,
      joinedOn,
      notes: changes.notes === undefined ? this.notes : cleanNotes(changes.notes),
      rollNumber:
        changes.rollNumber === undefined ? this.rollNumber : cleanRollNumber(changes.rollNumber),
    });
  }

  /**
   * Mark as left on a date. Idempotent: leaving again returns the student unchanged, keeping
   * the FIRST leave date, so a retried request can't move it.
   */
  leave(on: LocalDate): Student {
    this.assertNotErased();
    if (!this.isActive) {
      return this;
    }
    if (on.isBefore(this.joinedOn)) {
      throw invalid('leftOn', 'A student cannot leave before the date they joined');
    }
    return new Student({ ...this.toProps(), status: 'left', leftOn: on });
  }

  /**
   * LLD §6.9 erasure (a guardian's request, owner action): personal data is removed for good;
   * the record stays so invoices and payments keep their amounts. An active student is marked
   * left (on `today`, or the join date if that is later) so billing stops. Idempotent.
   */
  erase(today: LocalDate, at: Date): Student {
    if (this.erasedAt) {
      return this;
    }
    const leftOn = this.leftOn ?? (today.isBefore(this.joinedOn) ? this.joinedOn : today);
    return new Student({
      ...this.toProps(),
      name: 'Erased student',
      guardianName: null,
      guardianPhone: null,
      studentPhone: null,
      notes: null,
      rollNumber: null,
      status: 'left',
      leftOn,
      erasedAt: at,
    });
  }

  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      guardianName: this.guardianName,
      // Members see the full number (they call parents). Logs and public pages use masked().
      guardianPhone: this.guardianPhone?.toE164() ?? null,
      studentPhone: this.studentPhone?.toE164() ?? null,
      status: this.status,
      joinedOn: this.joinedOn.toString(),
      leftOn: this.leftOn?.toString() ?? null,
      notes: this.notes,
      rollNumber: this.rollNumber,
    };
  }

  toProps(): StudentProps {
    return {
      id: this.id,
      instituteId: this.instituteId,
      name: this.name,
      guardianName: this.guardianName,
      guardianPhone: this.guardianPhone,
      studentPhone: this.studentPhone,
      status: this.status,
      joinedOn: this.joinedOn,
      leftOn: this.leftOn,
      notes: this.notes,
      rollNumber: this.rollNumber,
      erasedAt: this.erasedAt,
    };
  }

  private assertNotErased(): void {
    if (this.erasedAt) {
      // Erasure is irreversible (LLD §6.9): editing would put personal data back.
      throw new AppError('CONFLICT', 'This student was erased and cannot be changed', {
        studentId: this.id,
      });
    }
  }
}

// --- rules (private to this file) ---

const tidy = (raw: string | null | undefined) => (raw ?? '').trim().replace(/\s+/g, ' ');

function cleanName(raw: string): string {
  const name = tidy(raw);
  if (name.length < 2 || name.length > 80) {
    throw invalid('name', 'Student name must be 2 to 80 characters');
  }
  return name;
}

function cleanGuardianName(raw: string | null | undefined): string | null {
  const name = tidy(raw);
  if (name.length > 80) {
    throw invalid('guardianName', 'Guardian name must be at most 80 characters');
  }
  return name === '' ? null : name;
}

function cleanNotes(raw: string | null | undefined): string | null {
  // Notes keep their line breaks: only the ends are trimmed.
  const notes = (raw ?? '').trim();
  if (notes.length > 1000) {
    throw invalid('notes', 'Notes must be at most 1000 characters');
  }
  return notes === '' ? null : notes;
}

/** The student's own number can't be the parent's: that would just send everything twice. */
function checkStudentPhone(
  phone: PhoneNumber | null,
  guardianPhone: PhoneNumber | null,
): PhoneNumber | null {
  if (phone && guardianPhone && phone.equals(guardianPhone)) {
    throw invalid('studentPhone', "The student's number must be different from the parent's");
  }
  return phone;
}

function cleanRollNumber(raw: string | null | undefined): string | null {
  const roll = tidy(raw);
  if (roll.length > 20) {
    throw invalid('rollNumber', 'Roll number must be at most 20 characters');
  }
  return roll === '' ? null : roll;
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field });
}
