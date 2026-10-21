// Pure TypeScript: the test forms' rules, unit-tested in Node. They mirror the API's
// (ClassTest); the API checks again and decides.

/** The API's ceiling for maximum marks. */
export const MAX_MARKS_LIMIT = 1000;

/**
 * Marks as typed -> a number with at most 2 decimals (half marks are common: "17.5"), or null.
 * Exact decimal text, never float maths: "0.1" + "0.2" problems can't creep in.
 */
export function parseMarks(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  return Number(cleaned);
}

/** 17.5 -> "17.5"; 20 -> "20" (no needless ".00"). */
export function formatMarks(marks: number): string {
  return String(Number(marks.toFixed(2)));
}

export interface TestFormValues {
  name: string;
  date: string; // "YYYY-MM-DD"
  maxMarksText: string;
}

export type TestFormError = 'testForm.nameInvalid' | 'testForm.maxInvalid';

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

export function validateTestForm(
  values: TestFormValues,
): Partial<Record<'name' | 'maxMarks', TestFormError>> {
  const errors: Partial<Record<'name' | 'maxMarks', TestFormError>> = {};
  const name = tidy(values.name);
  if (name.length < 1 || name.length > 80) {
    errors.name = 'testForm.nameInvalid';
  }
  const max = parseMarks(values.maxMarksText);
  if (max === null || max <= 0 || max > MAX_MARKS_LIMIT) {
    errors.maxMarks = 'testForm.maxInvalid';
  }
  return errors;
}

/** Only call after validateTestForm found nothing. */
export function toTestRequest(values: TestFormValues): {
  name: string;
  date: string;
  maxMarks: number;
} {
  return {
    name: tidy(values.name),
    date: values.date,
    maxMarks: parseMarks(values.maxMarksText) ?? 0,
  };
}
