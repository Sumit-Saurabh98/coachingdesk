import { describe, expect, it } from 'vitest';
import { LocalDate, SendNoticeBody } from '@coachingdesk/shared';
import { buildNoticeContent, sanitizeParam } from '../notice-content';

const B = '01a152ab-abaa-7097-b07d-c570865c11e3';
const context = {
  institute: 'Sharma Classes',
  batchNames: ['Maths'],
  today: LocalDate.parse('2026-10-19'),
};
const build = (body: unknown) => buildNoticeContent(SendNoticeBody.parse(body), context);
const fieldError = (field: string) =>
  expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field } });

describe('sanitizeParam', () => {
  it('line breaks -> " · ", tabs and long spaces -> one space', () => {
    expect(sanitizeParam('  Exam on Monday\n\nBring   pens\tand ruler  ')).toBe(
      'Exam on Monday · Bring pens and ruler',
    );
  });
});

describe('buildNoticeContent', () => {
  it('general: the notice template with clean text', () => {
    expect(build({ kind: 'general', batchIds: [B], text: 'Exam on Monday.\nBring pens.' })).toEqual(
      {
        template: 'notice',
        params: { institute: 'Sharma Classes', text: 'Exam on Monday. · Bring pens.' },
      },
    );
  });

  it.each(['Join at https://bit.ly/x', 'see www.example.com', 'visit exam-results.in'])(
    'general: refuses links (%s)',
    (text) => {
      expect(() => build({ kind: 'general', batchIds: [B], text })).toThrow(fieldError('text'));
    },
  );

  it('general: 1 to 500 characters', () => {
    expect(() => build({ kind: 'general', batchIds: [B], text: '   ' })).toThrow(
      fieldError('text'),
    );
    expect(() => build({ kind: 'general', batchIds: [B], text: 'x'.repeat(501) })).toThrow(
      fieldError('text'),
    );
  });

  it('holiday: dates shown for parents; must resume after it; not in the past', () => {
    expect(
      build({
        kind: 'holiday',
        batchIds: [B],
        date: '2026-10-24',
        resumeDate: '2026-10-27',
        reason: 'Diwali',
      }),
    ).toEqual({
      template: 'notice_holiday',
      params: {
        institute: 'Sharma Classes',
        date: '24 Oct 2026',
        reason: 'Diwali',
        resume_date: '27 Oct 2026',
      },
    });
    expect(() =>
      build({
        kind: 'holiday',
        batchIds: [B],
        date: '2026-10-24',
        resumeDate: '2026-10-24',
        reason: 'x',
      }),
    ).toThrow(fieldError('resumeDate'));
    expect(() =>
      build({
        kind: 'holiday',
        batchIds: [B],
        date: '2026-10-18',
        resumeDate: '2026-10-20',
        reason: 'x',
      }),
    ).toThrow(fieldError('date'));
  });

  it('schedule_change: one batch, its name in the message', () => {
    expect(
      build({ kind: 'schedule_change', batchIds: [B], date: '2026-10-21', time: '18:30' }),
    ).toEqual({
      template: 'notice_schedule_change',
      params: { batch: 'Maths', institute: 'Sharma Classes', time: '18:30', date: '21 Oct 2026' },
    });
    expect(
      SendNoticeBody.safeParse({
        kind: 'schedule_change',
        batchIds: [B, B],
        date: '2026-10-21',
        time: '18:30',
      }).success,
    ).toBe(false);
  });
});
