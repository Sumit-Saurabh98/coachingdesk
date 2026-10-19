import type { Revalidation, Revalidator } from './outbox-dispatcher';
import type { OutboxMessage } from './outbox.repository';
import { resultParams } from './outbox-result-cards';
import { parseResultDedupeKey } from './result-messages';

/** TestService.currentResult fits. null = the test or the score is gone. */
export interface CurrentResultLookup {
  currentResult(
    instituteId: string,
    testId: string,
    studentId: string,
  ): Promise<{
    studentName: string;
    testName: string;
    marks: number | null;
    isAbsent: boolean;
    maxMarks: number;
  } | null>;
}

/**
 * LLD §6.3: a result card is sent only if the score still exists, and it shows the marks as
 * they are NOW: a teacher who fixed a typo after tapping "Send" sends the corrected card.
 * Test deleted, score removed, or changed to absent -> skipped (stale).
 */
export class ResultRevalidator implements Revalidator {
  constructor(private readonly results: CurrentResultLookup) {}

  async check(message: OutboxMessage): Promise<Revalidation> {
    const key = parseResultDedupeKey(message.dedupeKey);
    if (!key) {
      return { kind: 'skip', reason: 'stale' };
    }
    const result = await this.results.currentResult(message.instituteId, key.testId, key.studentId);
    if (!result || result.isAbsent || result.marks === null) {
      return { kind: 'skip', reason: 'stale' };
    }
    return {
      kind: 'send',
      params: resultParams(
        {
          studentName: result.studentName,
          testName: result.testName,
          marks: result.marks,
          maxMarks: result.maxMarks,
        },
        message.params.institute ?? '',
      ),
    };
  }
}
