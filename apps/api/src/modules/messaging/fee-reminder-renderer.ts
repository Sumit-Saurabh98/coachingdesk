import { type LocalDate, Money, type PhoneNumber } from '@coachingdesk/shared';
import type { Revalidation, Revalidator } from './outbox-dispatcher';
import type { OutboxMessage } from './outbox.repository';
import { joinNames, rupees } from './message-format';

// What a fee reminder needs from other modules (their services fit; rule 12).
export interface GuardianStudentsLookup {
  activeByGuardianPhone(
    instituteId: string,
    phone: PhoneNumber,
  ): Promise<Array<{ id: string; name: string; guardianName: string | null }>>;
}
export interface OpenDuesLookup {
  openForStudents(
    instituteId: string,
    studentIds: string[],
  ): Promise<Array<{ studentId: string; remaining: Money; dueDate: LocalDate }>>;
}
export interface InstituteNameLookup {
  get(instituteId: string): Promise<{ name: string }>;
}

/**
 * Renders a fee reminder at SEND time (LLD §6.2, §6.3; FR-5.4): the guardian's open dues NOW,
 * across siblings (FR-5.2: one message per guardian). Paid everything while the message waited?
 * Skipped ('nothing_due'). Students who left get no reminders (FR-2.5).
 */
export class FeeReminderRenderer implements Revalidator {
  constructor(
    private readonly students: GuardianStudentsLookup,
    private readonly invoices: OpenDuesLookup,
    private readonly institutes: InstituteNameLookup,
  ) {}

  async check(message: OutboxMessage): Promise<Revalidation> {
    const students = await this.students.activeByGuardianPhone(message.instituteId, message.to);
    const dues = (
      await this.invoices.openForStudents(
        message.instituteId,
        students.map((s) => s.id),
      )
    ).filter((d) => !d.remaining.isZero());
    if (dues.length === 0) {
      return { kind: 'skip', reason: 'nothing_due' };
    }
    const owing = students.filter((s) => dues.some((d) => d.studentId === s.id));
    const total = dues.reduce((sum, d) => sum.add(d.remaining), Money.zero());
    const { name: institute } = await this.institutes.get(message.instituteId);
    // Same guardian for all siblings: any sibling's record may carry the name.
    const guardian = students.find((s) => s.guardianName)?.guardianName ?? 'Parent';

    if (owing.length === 1) {
      // KB template fee_reminder: "Hello {{guardian}}, {{student}}'s fee of ₹{{amount}} at
      // {{institute}} is due on {{date}}." (the oldest open due date)
      const oldest = dues.reduce((a, b) => (b.dueDate.isBefore(a.dueDate) ? b : a));
      return {
        kind: 'send',
        template: 'fee_reminder',
        params: {
          guardian,
          student: owing[0]!.name,
          amount: rupees(total),
          institute,
          date: displayDate(oldest.dueDate),
        },
      };
    }
    // fee_reminder_multi: "Hello {{guardian}}, fees of ₹{{total}} are due for {{students}} at {{institute}}."
    return {
      kind: 'send',
      template: 'fee_reminder_multi',
      params: {
        guardian,
        total: rupees(total),
        students: joinNames(owing.map((s) => s.name)),
        institute,
      },
    };
  }
}

function displayDate(date: LocalDate): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}
