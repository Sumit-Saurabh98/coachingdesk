import type { PhoneNumber } from '@coachingdesk/shared';
import type { AuditRecorder } from '../audit/audit-log';

// Each module erases its own data, through its own service (rule 12). Nobody depends on
// privacy, so this module can depend on all of them without an import cycle.
export interface ErasableStudents {
  get(
    instituteId: string,
    studentId: string,
  ): Promise<{ guardianPhone: PhoneNumber | null; studentPhone: PhoneNumber | null }>;
  erase(instituteId: string, studentId: string): Promise<{ toPublicJSON(): object }>;
  byGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<unknown[]>;
}
export interface ErasablePayments {
  forgetGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<void>;
}
export interface ErasableConsent {
  forget(instituteId: string, phone: PhoneNumber): Promise<void>;
}
export interface ErasableMessages {
  forgetStudent(instituteId: string, studentId: string): Promise<number>;
  forgetPhone(instituteId: string, phone: PhoneNumber): Promise<number>;
}

export interface ErasureServiceDeps {
  students: ErasableStudents;
  payments: ErasablePayments;
  consent: ErasableConsent;
  messages: ErasableMessages;
  audit: AuditRecorder;
}

/**
 * Student erasure (LLD §6.9; DPDP; on a guardian's request, owner action). Irreversible.
 * - The student: name -> "Erased student", guardian + notes cleared, marked left (billing stops).
 *   Invoices and payment AMOUNTS stay, so the institute's totals remain correct.
 * - Absence alerts about the student lose their text; queued ones are cancelled.
 * - The guardian's phone (payments, consent, message log) is removed ONLY if no other student
 *   here still has it: a sibling's guardian is the same person, still a parent of the institute.
 * Every step is idempotent: if anything fails halfway, running it again finishes the job.
 */
export class ErasureService {
  constructor(private readonly deps: ErasureServiceDeps) {}

  async eraseStudent(
    instituteId: string,
    studentId: string,
    actorUserId: string,
  ): Promise<{ toPublicJSON(): object }> {
    const { guardianPhone, studentPhone } = await this.deps.students.get(instituteId, studentId); // 404
    const erased = await this.deps.students.erase(instituteId, studentId);
    await this.deps.messages.forgetStudent(instituteId, studentId);

    // The student's own number belongs to this student alone: its consent and queued
    // messages go too (unless, oddly, it is also some family's guardian number here).
    if (studentPhone) {
      const isAGuardian = await this.deps.students.byGuardianPhone(instituteId, studentPhone);
      if (isAGuardian.length === 0) {
        await this.deps.consent.forget(instituteId, studentPhone);
        await this.deps.messages.forgetPhone(instituteId, studentPhone);
      }
    }

    let guardianForgotten = false;
    if (guardianPhone) {
      const stillUsedBy = await this.deps.students.byGuardianPhone(instituteId, guardianPhone);
      if (stillUsedBy.length === 0) {
        await this.deps.payments.forgetGuardianPhone(instituteId, guardianPhone);
        await this.deps.consent.forget(instituteId, guardianPhone);
        await this.deps.messages.forgetPhone(instituteId, guardianPhone);
        guardianForgotten = true;
      }
    }
    await this.deps.audit.record({
      instituteId,
      actorUserId,
      action: 'student.erase',
      entityType: 'student',
      entityId: studentId,
      after: { erased: true, guardianForgotten },
    });
    return erased;
  }
}
