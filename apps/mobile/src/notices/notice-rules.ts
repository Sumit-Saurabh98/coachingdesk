// Pure TypeScript: the "new notice" form's rules, unit-tested in Node. They mirror the API's
// (notice-content.ts); the API checks again and decides.

export type NoticeKind = 'holiday' | 'schedule_change' | 'general';

export interface NoticeFormValues {
  kind: NoticeKind;
  batchIds: string[];
  text: string; // general
  date: string; // holiday: first day off; schedule_change: the day of the new time
  resumeDate: string; // holiday: classes start again
  reason: string; // holiday
  time: string; // schedule_change "HH:MM"
}

export type NoticeField = 'batchIds' | 'text' | 'date' | 'resumeDate' | 'reason';

/** The i18n keys of the form's messages. */
export type NoticeError =
  | 'notices.batchesRequired'
  | 'notices.oneBatch'
  | 'notices.textInvalid'
  | 'notices.noLinks'
  | 'notices.datePast'
  | 'notices.resumeAfter'
  | 'notices.reasonInvalid';

// The same as the API: no links in notices (shared number; spam/phishing risk, KB "Messaging").
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|org|net|io|co|ly|me|app|info|xyz)\b)/i;

export function hasLink(text: string): boolean {
  return LINK.test(text);
}

/** How WhatsApp will get it: line breaks become " · ", runs of spaces one space. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\s*[\r\n]+\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Problems per field: the value is the i18n key of the message. */
export function validateNotice(
  values: NoticeFormValues,
  today: string,
): Partial<Record<NoticeField, NoticeError>> {
  const errors: Partial<Record<NoticeField, NoticeError>> = {};
  if (values.batchIds.length === 0) {
    errors.batchIds = 'notices.batchesRequired';
  } else if (values.kind === 'schedule_change' && values.batchIds.length !== 1) {
    errors.batchIds = 'notices.oneBatch';
  }
  if (values.kind === 'general') {
    const text = cleanText(values.text);
    if (text.length === 0 || text.length > 500) {
      errors.text = 'notices.textInvalid';
    } else if (hasLink(text)) {
      errors.text = 'notices.noLinks';
    }
  }
  if (values.kind !== 'general' && values.date < today) {
    errors.date = 'notices.datePast';
  }
  if (values.kind === 'holiday') {
    if (values.resumeDate <= values.date) {
      errors.resumeDate = 'notices.resumeAfter';
    }
    const reason = cleanText(values.reason);
    if (reason.length === 0 || reason.length > 80) {
      errors.reason = 'notices.reasonInvalid';
    } else if (hasLink(reason)) {
      errors.reason = 'notices.noLinks';
    }
  }
  return errors;
}

export type SendNoticeRequest =
  | { kind: 'general'; batchIds: string[]; text: string }
  | { kind: 'holiday'; batchIds: string[]; date: string; resumeDate: string; reason: string }
  | { kind: 'schedule_change'; batchIds: string[]; date: string; time: string };

/** Only the fields of the chosen kind (the API is strict about extra ones). */
export function toNoticeRequest(values: NoticeFormValues): SendNoticeRequest {
  switch (values.kind) {
    case 'general':
      return { kind: 'general', batchIds: values.batchIds, text: cleanText(values.text) };
    case 'holiday':
      return {
        kind: 'holiday',
        batchIds: values.batchIds,
        date: values.date,
        resumeDate: values.resumeDate,
        reason: cleanText(values.reason),
      };
    case 'schedule_change':
      return {
        kind: 'schedule_change',
        batchIds: values.batchIds.slice(0, 1),
        date: values.date,
        time: values.time,
      };
  }
}

/** Switching kind: a timing change is for ONE batch, so keep only the first one chosen. */
export function withKind(values: NoticeFormValues, kind: NoticeKind): NoticeFormValues {
  return {
    ...values,
    kind,
    batchIds: kind === 'schedule_change' ? values.batchIds.slice(0, 1) : values.batchIds,
  };
}

/** Tapping a batch chip: toggle it; for a timing change, it REPLACES the one chosen. */
export function toggleBatch(values: NoticeFormValues, batchId: string): string[] {
  if (values.kind === 'schedule_change') {
    return [batchId];
  }
  return values.batchIds.includes(batchId)
    ? values.batchIds.filter((id) => id !== batchId)
    : [...values.batchIds, batchId];
}

/** "2026-10-31" -> "2026-11-01" (the default "classes resume" day). */
export function nextDay(isoDate: string): string {
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
  // UTC: a calendar date has no time zone, so none can shift it.
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}
