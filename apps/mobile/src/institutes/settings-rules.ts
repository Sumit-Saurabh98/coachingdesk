// Pure TypeScript: the institute settings screen's rules, unit-tested in Node. They mirror the
// API's (Institute entity); the API checks again and decides.

/** offset = days BEFORE the due date (3 = three days before, 0 = on it, -7 = a week late). */
export const REMINDER_CHOICES: readonly number[] = [7, 3, 1, 0, -1, -3, -7, -14];
export const MAX_REMINDERS = 6;

/** Tapping a reminder day: on/off, kept in calendar order (before -> after). At most 6. */
export function toggleOffset(offsets: readonly number[], offset: number): number[] {
  if (offsets.includes(offset)) {
    return offsets.filter((o) => o !== offset);
  }
  if (offsets.length >= MAX_REMINDERS) {
    return [...offsets];
  }
  return [...offsets, offset].sort((a, b) => b - a);
}

/** How a reminder day reads: an i18n key and its count. */
export function offsetLabel(offset: number): {
  key:
    'instituteSettings.daysBefore' | 'instituteSettings.onDueDate' | 'instituteSettings.daysAfter';
  count: number;
} {
  if (offset > 0) {
    return { key: 'instituteSettings.daysBefore', count: offset };
  }
  if (offset === 0) {
    return { key: 'instituteSettings.onDueDate', count: 0 };
  }
  return { key: 'instituteSettings.daysAfter', count: -offset };
}

export interface InstituteSettings {
  absenceAlerts: boolean;
  messageLanguage: 'en' | 'hi';
  reminderOffsets: number[];
  // Optional: a cached institute saved before Step 37 doesn't have it (missing = off).
  showUpiInReminders?: boolean;
}

export interface InstituteDetail {
  id: string;
  name: string;
  city: string | null;
  billingDay: number;
  dueAfterDays: number;
  settings: InstituteSettings;
  upiId?: string | null; // FR-7.5; missing in a cache from before Step 37
}

export interface SettingsValues {
  name: string;
  city: string;
  billingDayText: string;
  dueAfterText: string;
  absenceAlerts: boolean;
  messageLanguage: 'en' | 'hi';
  reminderOffsets: number[];
  upiId: string;
  showUpiInReminders: boolean;
}

export type SettingsError =
  | 'institute.nameInvalid'
  | 'institute.cityInvalid'
  | 'instituteSettings.billingDayInvalid'
  | 'instituteSettings.dueAfterInvalid'
  | 'instituteSettings.upiInvalid';

type SettingsField = 'name' | 'city' | 'billingDay' | 'dueAfter' | 'upiId';

/** Same rule as the API: "handle@bank", stored lowercase. */
const UPI_ID = /^[a-z0-9][a-z0-9._-]{1,99}@[a-z][a-z0-9]{1,49}$/;

/** The UPI ID as it will be saved: trimmed, lowercase; null when the box is empty. */
export function cleanUpiId(text: string): string | null {
  const upiId = text.trim().toLowerCase();
  return upiId === '' ? null : upiId;
}

/** The reminder line can only be on with a UPI ID to show (the API refuses it otherwise). */
export function canShowUpi(values: SettingsValues): boolean {
  const upiId = cleanUpiId(values.upiId);
  return upiId !== null && UPI_ID.test(upiId);
}

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');
const wholeNumber = (text: string): number | null =>
  /^\d{1,2}$/.test(text.trim()) ? Number(text.trim()) : null;

export function valuesFromInstitute(institute: InstituteDetail): SettingsValues {
  return {
    name: institute.name,
    city: institute.city ?? '',
    billingDayText: String(institute.billingDay),
    dueAfterText: String(institute.dueAfterDays),
    absenceAlerts: institute.settings.absenceAlerts,
    messageLanguage: institute.settings.messageLanguage,
    reminderOffsets: [...institute.settings.reminderOffsets],
    upiId: institute.upiId ?? '',
    showUpiInReminders: institute.settings.showUpiInReminders ?? false,
  };
}

export function validateSettings(
  values: SettingsValues,
): Partial<Record<SettingsField, SettingsError>> {
  const errors: Partial<Record<SettingsField, SettingsError>> = {};
  const name = tidy(values.name);
  if (name.length < 2 || name.length > 80) {
    errors.name = 'institute.nameInvalid';
  }
  if (tidy(values.city).length > 60) {
    errors.city = 'institute.cityInvalid';
  }
  const billingDay = wholeNumber(values.billingDayText);
  if (billingDay === null || billingDay < 1 || billingDay > 28) {
    errors.billingDay = 'instituteSettings.billingDayInvalid';
  }
  const dueAfter = wholeNumber(values.dueAfterText);
  if (dueAfter === null || dueAfter > 27) {
    errors.dueAfter = 'instituteSettings.dueAfterInvalid';
  }
  const upiId = cleanUpiId(values.upiId);
  if (upiId !== null && !UPI_ID.test(upiId)) {
    errors.upiId = 'instituteSettings.upiInvalid';
  }
  return errors;
}

/** "Billed on day 1, due on day 7" when that day exists every month (else just the gap). */
export function dueDayOfMonth(billingDay: number, dueAfterDays: number): number | null {
  const day = billingDay + dueAfterDays;
  return day <= 28 ? day : null;
}

export interface InstituteUpdate {
  name?: string;
  city?: string | null;
  billingDay?: number;
  dueAfterDays?: number;
  upiId?: string | null;
  settings?: Partial<InstituteSettings>;
}

/** PATCH body with only what changed; null when nothing did. Call after validateSettings. */
export function toInstituteUpdate(
  original: InstituteDetail,
  values: SettingsValues,
): InstituteUpdate | null {
  const body: InstituteUpdate = {};
  const name = tidy(values.name);
  const city = tidy(values.city) === '' ? null : tidy(values.city);
  if (name !== original.name) {
    body.name = name;
  }
  if (city !== original.city) {
    body.city = city;
  }
  const billingDay = Number(values.billingDayText.trim());
  if (billingDay !== original.billingDay) {
    body.billingDay = billingDay;
  }
  const dueAfterDays = Number(values.dueAfterText.trim());
  if (dueAfterDays !== original.dueAfterDays) {
    body.dueAfterDays = dueAfterDays;
  }
  const upiId = cleanUpiId(values.upiId);
  if (upiId !== (original.upiId ?? null)) {
    body.upiId = upiId;
  }
  const settings: Partial<InstituteSettings> = {};
  if (values.absenceAlerts !== original.settings.absenceAlerts) {
    settings.absenceAlerts = values.absenceAlerts;
  }
  if (values.messageLanguage !== original.settings.messageLanguage) {
    settings.messageLanguage = values.messageLanguage;
  }
  const sameOffsets =
    values.reminderOffsets.length === original.settings.reminderOffsets.length &&
    values.reminderOffsets.every((o) => original.settings.reminderOffsets.includes(o));
  if (!sameOffsets) {
    settings.reminderOffsets = values.reminderOffsets;
  }
  // Without a UPI ID the line is off (the API turns it off when the ID is removed).
  const showUpi = upiId !== null && values.showUpiInReminders;
  if (showUpi !== (original.settings.showUpiInReminders ?? false) && upiId !== null) {
    settings.showUpiInReminders = showUpi;
  }
  if (Object.keys(settings).length > 0) {
    body.settings = settings;
  }
  return Object.keys(body).length === 0 ? null : body;
}
