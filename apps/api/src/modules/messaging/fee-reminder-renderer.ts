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
  /** Students whose OWN number this is (KB #50). */
  activeByStudentPhone(
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
  /** reminderUpiId: the UPI ID to print, or null when the owner hasn't turned it on (FR-7.5). */
  get(instituteId: string): Promise<{ name: string; reminderUpiId: string | null }>;
}

/**
 * Renders a fee reminder at SEND time (LLD §6.2, §6.3; FR-5.4): the guardian's open dues NOW,
 * across siblings (FR-5.2: one message per guardian). Paid everything while the message waited?
 * Skipped ('nothing_due'). Students who left get no reminders (FR-2.5).
 *
 * With the owner's "show my UPI ID" on (FR-7.5), the `_upi` twin of the template adds the line
 * "Pay by UPI to: {{upi}}". WhatsApp templates are fixed text, so the line is a second template,
 * not an optional part of one. Read at send time too: switching it off stops it at once.
 */
export class FeeReminderRenderer implements Revalidator {
  constructor(
    private readonly students: GuardianStudentsLookup,
    private readonly invoices: OpenDuesLookup,
    private readonly institutes: InstituteNameLookup,
  ) {}

  async check(message: OutboxMessage): Promise<Revalidation> {
    // A parent's number: all their children's dues. A student's own number: only theirs, and
    // the greeting is the student's own name (KB #50).
    const asGuardian = await this.students.activeByGuardianPhone(message.instituteId, message.to);
    const ownNumber =
      asGuardian.length > 0
        ? []
        : await this.students.activeByStudentPhone(message.instituteId, message.to);
    const students = asGuardian.length > 0 ? asGuardian : ownNumber;
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
    const { name: institute, reminderUpiId } = await this.institutes.get(message.instituteId);
    const upi: Record<string, string> = reminderUpiId === null ? {} : { upi: reminderUpiId };
    const withUpi = (template: string) => (reminderUpiId === null ? template : `${template}_upi`);
    // Same guardian for all siblings: any sibling's record may carry the name.
    const guardian =
      ownNumber[0]?.name ?? students.find((s) => s.guardianName)?.guardianName ?? 'Parent';

    if (owing.length === 1) {
      // KB template fee_reminder: "Hello {{guardian}}, {{student}}'s fee of ₹{{amount}} at
      // {{institute}} is due on {{date}}." (the oldest open due date)
      const oldest = dues.reduce((a, b) => (b.dueDate.isBefore(a.dueDate) ? b : a));
      return {
        kind: 'send',
        template: withUpi('fee_reminder'),
        params: {
          guardian,
          student: owing[0]!.name,
          amount: rupees(total),
          institute,
          date: displayDate(oldest.dueDate),
          ...upi,
        },
      };
    }
    // fee_reminder_multi: "Hello {{guardian}}, fees of ₹{{total}} are due for {{students}} at {{institute}}."
    return {
      kind: 'send',
      template: withUpi('fee_reminder_multi'),
      params: {
        guardian,
        total: rupees(total),
        students: joinNames(owing.map((s) => s.name)),
        institute,
        ...upi,
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
