// Pure TypeScript: the batch form's rules, unit-tested in Node. They MIRROR the API's
// (Batch.create / BatchSchedule) so the user hears about a problem while typing; the API
// still checks everything again and has the last word.
import type { CreateBatchBody, FeeCycle, UpdateBatchBody } from '@coachingdesk/shared';
import type { Batch } from './batches-api';

/** What the form holds while the user types (strings where the user types text). */
export interface BatchFormValues {
  name: string;
  subject: string;
  days: number[]; // ISO weekdays, 1 = Monday ... 7 = Sunday
  start: string; // "HH:MM", 24-hour
  end: string;
  feeRupees: string; // what's typed: whole rupees, "" = no fee
  feeCycle: FeeCycle;
}

export type BatchFormField = 'name' | 'subject' | 'days' | 'time' | 'fee';
/** Problems per field: the value is the i18n key of the message to show. */
export type BatchFormErrors = Partial<Record<BatchFormField, string>>;

export const NEW_BATCH: BatchFormValues = {
  name: '',
  subject: '',
  days: [],
  start: '17:00',
  end: '18:00',
  feeRupees: '',
  feeCycle: 'monthly',
};

/** "  Class 10   Maths " -> "Class 10 Maths" (as the API stores it). */
export const tidy = (text: string): string => text.trim().replace(/\s+/g, ' ');

export function validateBatchForm(values: BatchFormValues): BatchFormErrors {
  const errors: BatchFormErrors = {};
  const name = tidy(values.name);
  if (name.length < 2 || name.length > 80) {
    errors.name = 'batchForm.nameInvalid';
  }
  if (tidy(values.subject).length > 60) {
    errors.subject = 'batchForm.subjectInvalid';
  }
  if (values.days.length === 0) {
    errors.days = 'batchForm.daysRequired';
  }
  if (!isHHMM(values.start) || !isHHMM(values.end) || values.start >= values.end) {
    // "HH:MM" strings compare correctly as text: "09:30" < "17:00".
    errors.time = 'batchForm.timeInvalid';
  }
  if (values.feeRupees !== '' && rupeesToPaise(values.feeRupees) === null) {
    errors.fee = 'batchForm.feeInvalid';
  }
  return errors;
}

/** "1500" -> 150000 paise; "" -> 0; anything else (decimals, letters, too big) -> null. */
export function rupeesToPaise(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 0;
  }
  if (!/^\d{1,7}$/.test(trimmed)) {
    return null; // whole rupees only, at most ₹99,99,999
  }
  return Number(trimmed) * 100;
}

export function paiseToRupeesText(paise: number | undefined): string {
  return paise === undefined || paise === 0 ? '' : String(Math.round(paise / 100));
}

export function isHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function toHHMM(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function fromHHMM(value: string): { hours: number; minutes: number } {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return { hours, minutes };
}

/** The form's values for an existing batch (edit screen). */
export function valuesFromBatch(batch: Batch): BatchFormValues {
  return {
    name: batch.name,
    subject: batch.subject ?? '',
    days: [...batch.schedule.days],
    start: batch.schedule.start,
    end: batch.schedule.end,
    feeRupees: paiseToRupeesText(batch.defaultFeePaise),
    feeCycle: batch.defaultFeeCycle,
  };
}

/** POST body for a new batch. Call only when validateBatchForm found nothing. */
export function toCreateBody(values: BatchFormValues): CreateBatchBody {
  const subject = tidy(values.subject);
  return {
    name: tidy(values.name),
    subject: subject === '' ? null : subject,
    schedule: {
      days: [...values.days].sort((a, b) => a - b),
      start: values.start,
      end: values.end,
    },
    defaultFeePaise: rupeesToPaise(values.feeRupees) ?? 0,
    defaultFeeCycle: values.feeCycle,
  };
}

/**
 * PATCH body: ONLY what changed (the API's PATCH style). null when nothing changed, so the
 * screen can skip the request. The schedule is sent whole if any part of it changed.
 */
export function toUpdateBody(original: Batch, values: BatchFormValues): UpdateBatchBody | null {
  const next = toCreateBody(values);
  const body: UpdateBatchBody = {};
  if (next.name !== original.name) {
    body.name = next.name;
  }
  if ((next.subject ?? null) !== original.subject) {
    body.subject = next.subject ?? null;
  }
  const scheduleChanged =
    next.schedule.start !== original.schedule.start ||
    next.schedule.end !== original.schedule.end ||
    next.schedule.days.join(',') !== [...original.schedule.days].sort((a, b) => a - b).join(',');
  if (scheduleChanged) {
    body.schedule = next.schedule;
  }
  if (next.defaultFeePaise !== (original.defaultFeePaise ?? 0)) {
    body.defaultFeePaise = next.defaultFeePaise;
  }
  if (next.defaultFeeCycle !== original.defaultFeeCycle) {
    body.defaultFeeCycle = next.defaultFeeCycle;
  }
  return Object.keys(body).length === 0 ? null : body;
}
