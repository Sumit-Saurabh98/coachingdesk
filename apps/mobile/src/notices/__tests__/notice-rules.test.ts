import { describe, expect, it } from 'vitest';
import {
  cleanText,
  hasLink,
  nextDay,
  type NoticeFormValues,
  toggleBatch,
  toNoticeRequest,
  validateNotice,
  withKind,
} from '../notice-rules';

const today = '2026-10-21';
const base: NoticeFormValues = {
  kind: 'general',
  batchIds: ['b1'],
  text: 'Exam on Monday',
  date: today,
  resumeDate: '2026-10-22',
  reason: 'Diwali',
  time: '18:30',
};

describe('hasLink / cleanText', () => {
  it.each([
    ['visit www.example.com', true],
    ['see https://x.y', true],
    ['go to sharma.in', true],
    ['Exam on Monday. Bring pens.', false],
    ['Score 9.5 out of 10', false],
  ])('%j -> %s', (text, link) => {
    expect(hasLink(text)).toBe(link);
  });

  it('line breaks become " · ", spaces collapse', () => {
    expect(cleanText('  Exam Monday\n\nBring   pens ')).toBe('Exam Monday · Bring pens');
  });
});

describe('nextDay', () => {
  it.each([
    ['2026-10-21', '2026-10-22'],
    ['2026-10-31', '2026-11-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-28', '2028-02-29'],
  ])('%s -> %s', (day, next) => {
    expect(nextDay(day)).toBe(next);
  });
});

describe('validateNotice', () => {
  it('a valid general notice', () => {
    expect(validateNotice(base, today)).toEqual({});
  });

  it('general: some text, at most 500, no links; at least one batch', () => {
    expect(validateNotice({ ...base, text: '  ', batchIds: [] }, today)).toEqual({
      text: 'notices.textInvalid',
      batchIds: 'notices.batchesRequired',
    });
    expect(validateNotice({ ...base, text: 'x'.repeat(501) }, today).text).toBe(
      'notices.textInvalid',
    );
    expect(validateNotice({ ...base, text: 'see www.a.com' }, today).text).toBe('notices.noLinks');
  });

  it('holiday: not in the past, resume after it, a short reason', () => {
    const holiday = { ...base, kind: 'holiday' as const };
    expect(validateNotice(holiday, today)).toEqual({});
    expect(
      validateNotice(
        { ...holiday, date: '2026-10-20', resumeDate: '2026-10-20', reason: '' },
        today,
      ),
    ).toEqual({
      date: 'notices.datePast',
      resumeDate: 'notices.resumeAfter',
      reason: 'notices.reasonInvalid',
    });
  });

  it('timing change: exactly one batch', () => {
    const change = { ...base, kind: 'schedule_change' as const, batchIds: ['b1', 'b2'] };
    expect(validateNotice(change, today).batchIds).toBe('notices.oneBatch');
  });
});

describe('toNoticeRequest', () => {
  it('only the fields of the kind', () => {
    expect(toNoticeRequest({ ...base, text: 'Exam\nMonday' })).toEqual({
      kind: 'general',
      batchIds: ['b1'],
      text: 'Exam · Monday',
    });
    expect(toNoticeRequest({ ...base, kind: 'schedule_change' })).toEqual({
      kind: 'schedule_change',
      batchIds: ['b1'],
      date: today,
      time: '18:30',
    });
  });
});

describe('batch choice', () => {
  it('switching to a timing change keeps one batch; tapping replaces it', () => {
    const many = { ...base, batchIds: ['b1', 'b2'] };
    const change = withKind(many, 'schedule_change');
    expect(change.batchIds).toEqual(['b1']);
    expect(toggleBatch(change, 'b2')).toEqual(['b2']);
  });

  it('otherwise tapping toggles', () => {
    expect(toggleBatch(base, 'b2')).toEqual(['b1', 'b2']);
    expect(toggleBatch(base, 'b1')).toEqual([]);
  });
});
