import { describe, expect, it } from 'vitest';
import {
  canShowUpi,
  dueDayOfMonth,
  type InstituteDetail,
  offsetLabel,
  toggleOffset,
  toInstituteUpdate,
  validateSettings,
  valuesFromInstitute,
} from '../settings-rules';

const institute: InstituteDetail = {
  id: 'i1',
  name: 'Sharma Classes',
  city: 'Pune',
  billingDay: 1,
  dueAfterDays: 6,
  settings: { absenceAlerts: true, messageLanguage: 'en', reminderOffsets: [3, 0, -3, -7] },
};

describe('reminder days', () => {
  it('toggle on/off, calendar order, at most 6', () => {
    expect(toggleOffset([3, -3], 0)).toEqual([3, 0, -3]);
    expect(toggleOffset([3, 0, -3], 0)).toEqual([3, -3]);
    expect(toggleOffset([7, 3, 1, 0, -1, -3], -7)).toEqual([7, 3, 1, 0, -1, -3]);
  });

  it.each([
    [3, 'instituteSettings.daysBefore', 3],
    [0, 'instituteSettings.onDueDate', 0],
    [-7, 'instituteSettings.daysAfter', 7],
  ] as const)('%i -> %s (%i)', (offset, key, count) => {
    expect(offsetLabel(offset)).toEqual({ key, count });
  });
});

describe('validateSettings', () => {
  const values = valuesFromInstitute(institute);
  it('the stored institute is valid', () => {
    expect(validateSettings(values)).toEqual({});
  });
  it('billing day 1-28, due after 0-27, a name', () => {
    expect(
      validateSettings({
        ...values,
        name: 'X',
        billingDayText: '29',
        dueAfterText: '28',
      }),
    ).toEqual({
      name: 'institute.nameInvalid',
      billingDay: 'instituteSettings.billingDayInvalid',
      dueAfter: 'instituteSettings.dueAfterInvalid',
    });
    expect(validateSettings({ ...values, billingDayText: 'abc', dueAfterText: '0' })).toEqual({
      billingDay: 'instituteSettings.billingDayInvalid',
    });
  });
});

describe('dueDayOfMonth', () => {
  it('a day every month has, or null', () => {
    expect(dueDayOfMonth(1, 6)).toBe(7);
    expect(dueDayOfMonth(20, 8)).toBe(28);
    expect(dueDayOfMonth(25, 10)).toBeNull();
  });
});

describe('toInstituteUpdate', () => {
  it('nothing changed -> null', () => {
    expect(toInstituteUpdate(institute, valuesFromInstitute(institute))).toBeNull();
  });

  it('only what changed; settings partial; same days in another order is no change', () => {
    const values = {
      ...valuesFromInstitute(institute),
      city: ' ',
      dueAfterText: '9',
      messageLanguage: 'hi' as const,
      reminderOffsets: [-7, -3, 0, 3],
    };
    expect(toInstituteUpdate(institute, values)).toEqual({
      city: null,
      dueAfterDays: 9,
      settings: { messageLanguage: 'hi' },
    });
    expect(
      toInstituteUpdate(institute, { ...valuesFromInstitute(institute), reminderOffsets: [] }),
    ).toEqual({ settings: { reminderOffsets: [] } });
  });
});

describe('UPI ID (FR-7.5)', () => {
  const withUpi: InstituteDetail = {
    ...institute,
    upiId: 'sharma@okaxis',
    settings: { ...institute.settings, showUpiInReminders: true },
  };

  it('a cached institute from before the UPI setting reads as: no UPI ID, line off', () => {
    const values = valuesFromInstitute(institute);
    expect(values.upiId).toBe('');
    expect(values.showUpiInReminders).toBe(false);
    expect(canShowUpi(values)).toBe(false);
  });

  it('checks the format the API checks; empty is fine (no UPI ID)', () => {
    const values = valuesFromInstitute(institute);
    for (const ok of ['', '  ', 'Sharma@OkAxis', '9876543210@ybl']) {
      expect(validateSettings({ ...values, upiId: ok }).upiId).toBeUndefined();
    }
    for (const bad of ['sharma', 'sharma@', 'sharma classes@okaxis']) {
      expect(validateSettings({ ...values, upiId: bad }).upiId).toBe(
        'instituteSettings.upiInvalid',
      );
    }
  });

  it('sets the UPI ID (trimmed, lowercase) and turns the line on in one save', () => {
    const values = {
      ...valuesFromInstitute(institute),
      upiId: ' Sharma@OkAxis ',
      showUpiInReminders: true,
    };
    expect(toInstituteUpdate(institute, values)).toEqual({
      upiId: 'sharma@okaxis',
      settings: { showUpiInReminders: true },
    });
  });

  it('clearing the UPI ID sends null only (the API turns the line off itself)', () => {
    const values = { ...valuesFromInstitute(withUpi), upiId: '' };
    expect(toInstituteUpdate(withUpi, values)).toEqual({ upiId: null });
  });

  it('turning the line off keeps the UPI ID', () => {
    const values = { ...valuesFromInstitute(withUpi), showUpiInReminders: false };
    expect(toInstituteUpdate(withUpi, values)).toEqual({
      settings: { showUpiInReminders: false },
    });
    expect(toInstituteUpdate(withUpi, valuesFromInstitute(withUpi))).toBeNull();
  });
});
