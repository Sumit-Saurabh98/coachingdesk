import { describe, expect, it } from 'vitest';
import { PhoneNumber } from '@coachingdesk/shared';
import type { OutboxMessage } from '../outbox.repository';
import { parseResultDedupeKey, resultDedupeKey } from '../result-messages';
import { type CurrentResultLookup, ResultRevalidator } from '../result-revalidator';

const message = (dedupeKey: string): OutboxMessage => ({
  id: 'm1',
  instituteId: 'inst-1',
  to: PhoneNumber.parse('9812345678'),
  template: 'result_card',
  params: { student: 'Aarav', test: 'Unit 3', institute: 'Sharma Classes', marks: '40', max: '50' },
  locale: 'en',
  category: 'result',
  priority: 3,
  scheduledFor: new Date(),
  expiresAt: null,
  dedupeKey,
  related: { type: 'test', id: 't1' },
  createdAt: new Date(),
  status: 'sending',
  attempts: 0,
  providerMessageId: null,
  skipReason: null,
  errorCode: null,
});

const lookup = (result: Awaited<ReturnType<CurrentResultLookup['currentResult']>>) => ({
  calls: [] as string[][],
  async currentResult(instituteId: string, testId: string, studentId: string) {
    this.calls.push([instituteId, testId, studentId]);
    return result;
  },
});

describe('result dedupe keys', () => {
  it('round-trip', () => {
    expect(parseResultDedupeKey(resultDedupeKey('t1', 's1'))).toEqual({
      testId: 't1',
      studentId: 's1',
    });
  });

  it.each(['absence:t1:s1', 'result:t1', 'result:t1:s1:x', 'result::s1'])('rejects %j', (key) => {
    expect(parseResultDedupeKey(key)).toBeNull();
  });
});

describe('ResultRevalidator', () => {
  it('re-renders the card from the CURRENT marks (a corrected typo is what gets sent)', async () => {
    const results = lookup({
      studentName: 'Aarav Sharma',
      testName: 'Unit 3 (final)',
      marks: 42.5,
      isAbsent: false,
      maxMarks: 45,
    });

    const outcome = await new ResultRevalidator(results).check(message('result:t1:s1'));

    expect(results.calls).toEqual([['inst-1', 't1', 's1']]);
    expect(outcome).toEqual({
      kind: 'send',
      params: {
        student: 'Aarav Sharma',
        test: 'Unit 3 (final)',
        institute: 'Sharma Classes',
        marks: '42.5',
        max: '45',
      },
    });
  });

  it.each([
    ['the test or score is gone', null],
    [
      'the student is now marked absent',
      { studentName: 'A', testName: 'T', marks: null, isAbsent: true, maxMarks: 50 },
    ],
  ])('skips as stale when %s', async (_label, result) => {
    expect(await new ResultRevalidator(lookup(result)).check(message('result:t1:s1'))).toEqual({
      kind: 'skip',
      reason: 'stale',
    });
  });

  it('a malformed key is stale (never guess who it was for)', async () => {
    const results = lookup(null);
    expect(await new ResultRevalidator(results).check(message('result:t1'))).toEqual({
      kind: 'skip',
      reason: 'stale',
    });
    expect(results.calls).toEqual([]);
  });
});
