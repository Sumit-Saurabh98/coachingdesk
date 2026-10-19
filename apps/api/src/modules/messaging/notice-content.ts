import { AppError, type LocalDate, type SendNoticeBody } from '@coachingdesk/shared';

export interface NoticeContent {
  template: 'notice' | 'notice_holiday' | 'notice_schedule_change';
  params: Record<string, string>; // the same for every guardian
}

// Anything that looks like a link: http(s)://, www., or a bare domain. KB: notices carry no
// third-party links (spam/phishing risk on the shared number; Meta would re-categorise them).
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|org|net|io|co|ly|me|app|info|xyz)\b)/i;

/**
 * WhatsApp template parameters can't contain newlines, tabs or more than 4 spaces in a row
 * (KB "Messaging"): line breaks become " · ", runs of whitespace one space.
 */
export function sanitizeParam(raw: string): string {
  return raw
    .replace(/\s*[\r\n]+\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Builds and validates what guardians will read (422 with the field on any problem). */
export function buildNoticeContent(
  body: SendNoticeBody,
  context: { institute: string; batchNames: string[]; today: LocalDate },
): NoticeContent {
  switch (body.kind) {
    case 'general': {
      const text = sanitizeParam(body.text);
      if (text.length === 0 || text.length > 500) {
        throw invalid('text', 'Notice text must be 1 to 500 characters');
      }
      if (LINK.test(text)) {
        throw invalid('text', 'Links are not allowed in notices');
      }
      return { template: 'notice', params: { institute: context.institute, text } };
    }
    case 'holiday': {
      notInPast(body.date, context.today, 'date');
      if (!body.resumeDate.isAfter(body.date)) {
        throw invalid('resumeDate', 'Classes must resume after the holiday');
      }
      const reason = sanitizeParam(body.reason);
      if (reason.length === 0 || reason.length > 80) {
        throw invalid('reason', 'Reason must be 1 to 80 characters');
      }
      if (LINK.test(reason)) {
        throw invalid('reason', 'Links are not allowed in notices');
      }
      return {
        template: 'notice_holiday',
        params: {
          institute: context.institute,
          date: display(body.date),
          reason,
          resume_date: display(body.resumeDate),
        },
      };
    }
    case 'schedule_change': {
      notInPast(body.date, context.today, 'date');
      return {
        template: 'notice_schedule_change',
        params: {
          batch: context.batchNames[0] ?? '',
          institute: context.institute,
          time: body.time,
          date: display(body.date),
        },
      };
    }
  }
}

function notInPast(date: LocalDate, today: LocalDate, field: string): void {
  if (date.isBefore(today)) {
    throw invalid(field, 'The date cannot be in the past');
  }
}

function display(date: LocalDate): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field });
}
