import type { Clock, IdGenerator } from '@coachingdesk/shared';
import { formatMarks } from '../tests/class-test';
import type { ResultCard, ResultCardQueue } from '../tests/test.service';
import type { NewOutboxMessage, OutboxRepository } from './outbox.repository';
import { resultDedupeKey } from './result-messages';

export interface ResultInstituteLookup {
  get(instituteId: string): Promise<{ name: string; settings: { messageLanguage: 'en' | 'hi' } }>;
}

export interface OutboxResultCardsDeps {
  outbox: OutboxRepository;
  institutes: ResultInstituteLookup;
  ids: IdGenerator;
  clock: Clock;
}

const RESULT_PRIORITY = 3; // same as fee reminders: after receipts and absence alerts
/** Results aren't urgent, but a card that waited 3 days (quota, outage) is old news. */
const EXPIRES_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Result cards via the outbox (F-14, AGENTS rule 4): one message per student with marks.
 * The worker re-renders each card from the CURRENT marks at send time (ResultRevalidator).
 */
export class OutboxResultCards implements ResultCardQueue {
  constructor(private readonly deps: OutboxResultCardsDeps) {}

  async queue(instituteId: string, cards: readonly ResultCard[]): Promise<number> {
    if (cards.length === 0) {
      return 0;
    }
    const institute = await this.deps.institutes.get(instituteId);
    const now = this.deps.clock.now();
    // The parent's card, and a copy for the student's own number (KB #50).
    const copies = cards.flatMap((card) => [
      { card, to: card.guardianPhone, copy: 'guardian' as const },
      ...(card.studentPhone ? [{ card, to: card.studentPhone, copy: 'student' as const }] : []),
    ]);
    const messages: NewOutboxMessage[] = copies.map(({ card, to, copy }) => ({
      id: this.deps.ids.next(),
      instituteId,
      to,
      template: 'result_card',
      // KB §4: "{{student}}'s result for {{test}} at {{institute}}: {{marks}}/{{max}}."
      params: resultParams(card, institute.name),
      locale: institute.settings.messageLanguage,
      category: 'result',
      priority: RESULT_PRIORITY,
      scheduledFor: now, // the worker handles quiet hours, consent and quota
      expiresAt: new Date(now.getTime() + EXPIRES_AFTER_MS),
      dedupeKey: resultDedupeKey(card.testId, card.studentId, copy),
      related: { type: 'test', id: card.testId },
    }));
    return this.deps.outbox.enqueueAll(messages);
  }
}

export function resultParams(
  card: { studentName: string; testName: string; marks: number; maxMarks: number },
  institute: string,
): Record<string, string> {
  return {
    student: card.studentName,
    test: card.testName,
    institute,
    marks: formatMarks(card.marks),
    max: formatMarks(card.maxMarks),
  };
}
