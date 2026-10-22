import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import { Institute, type InstituteType, parseSettings } from '../institute';

const create = (input: { name?: string; type?: InstituteType; city?: string | null } = {}) =>
  Institute.create(
    'inst-1',
    { name: input.name ?? 'Sharma Classes', type: input.type ?? 'tuition', city: input.city },
    'owner-1',
  );

const fieldError = (field: string) =>
  expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field } });

describe('Institute.create', () => {
  it('applies the documented defaults', () => {
    expect(create().toPublicJSON()).toEqual({
      id: 'inst-1',
      name: 'Sharma Classes',
      type: 'tuition',
      city: null,
      timezone: 'Asia/Kolkata',
      billingDay: 1,
      dueAfterDays: 6,
      settings: {
        absenceAlerts: true,
        messageLanguage: 'en',
        reminderOffsets: [3, 0, -3, -7],
        showUpiInReminders: false,
      },
      upiId: null,
      deletion: null,
    });
    expect(create().createdBy).toBe('owner-1');
  });

  it('tidies the name and city; an empty city means "not given"', () => {
    const institute = create({ name: '  Sharma   Classes ', city: '  Pune ' });
    expect(institute.name).toBe('Sharma Classes');
    expect(institute.city).toBe('Pune');
    expect(create({ city: '   ' }).city).toBeNull();
  });

  it.each(['', 'A', 'x'.repeat(81)])('rejects the name %j', (name) => {
    expect(() => create({ name })).toThrow(fieldError('name'));
  });

  it('rejects an unknown type (e.g. a hand-crafted API request)', () => {
    expect(() => create({ type: 'school' as InstituteType })).toThrow(fieldError('type'));
  });

  it('accepts every documented type', () => {
    for (const type of ['tuition', 'academy', 'home_tutor'] as const) {
      expect(create({ type }).type).toBe(type);
    }
  });
});

describe('Institute.withBillingSettings', () => {
  it('returns a NEW institute with the change', () => {
    const original = create();
    const changed = original.withBillingSettings({ billingDay: 5 });
    expect(changed.billingDay).toBe(5);
    expect(changed.dueAfterDays).toBe(6);
    expect(original.billingDay).toBe(1);
  });

  it.each([0, 29, 31, 1.5])('rejects billing day %s', (billingDay) => {
    expect(() => create().withBillingSettings({ billingDay })).toThrow(fieldError('billingDay'));
  });

  it.each([-1, 28])('rejects due-after-days %s', (dueAfterDays) => {
    expect(() => create().withBillingSettings({ dueAfterDays })).toThrow(
      fieldError('dueAfterDays'),
    );
  });
});

describe('billing periods', () => {
  const billingOn5th = create().withBillingSettings({ billingDay: 5 });
  const period = (date: string) => billingOn5th.periodStartOn(LocalDate.parse(date)).toString();

  it.each([
    ['2026-10-04', '2026-09-05'], // the day before: still September's period
    ['2026-10-05', '2026-10-05'], // billing day itself starts the new period
    ['2026-10-31', '2026-10-05'],
    ['2027-01-03', '2026-12-05'], // across the year boundary
  ])('%s falls in the period starting %s', (date, expected) => {
    expect(period(date)).toBe(expected);
  });

  it('due date = period start + dueAfterDays (default: the 7th)', () => {
    const due = create().dueDateFor(LocalDate.parse('2026-10-01'));
    expect(due.toString()).toBe('2026-10-07');
  });
});

describe('Institute.restore', () => {
  it('rebuilds a stored institute as-is', () => {
    const props = { ...create().toProps(), billingDay: 10, archivedAt: null };
    expect(Institute.restore(props).toProps()).toEqual(props);
  });

  it('refuses corrupted data the business logic depends on', () => {
    expect(() => Institute.restore({ ...create().toProps(), timezone: 'Mars/Olympus' })).toThrow(
      fieldError('timezone'),
    );
  });
});

describe('Institute.withDetails', () => {
  it('changes name and city with the same rules as create', () => {
    const changed = create({ city: 'Pune' }).withDetails({ name: ' New  Name ', city: null });
    expect(changed.name).toBe('New Name');
    expect(changed.city).toBeNull();
  });

  it('keeps fields that were not sent', () => {
    const changed = create({ city: 'Pune' }).withDetails({ name: 'New Name' });
    expect(changed.city).toBe('Pune');
  });

  it('rejects a bad name', () => {
    expect(() => create().withDetails({ name: 'A' })).toThrow(fieldError('name'));
  });
});

describe('settings', () => {
  it('a new institute has absence alerts on and English messages', () => {
    expect(create().settings).toEqual({
      absenceAlerts: true,
      messageLanguage: 'en',
      reminderOffsets: [3, 0, -3, -7],
      showUpiInReminders: false,
    });
  });

  const defaults = {
    absenceAlerts: true,
    messageLanguage: 'en',
    reminderOffsets: [3, 0, -3, -7],
    showUpiInReminders: false,
  };

  it.each([
    [{}, defaults],
    [
      { absenceAlerts: false, messageLanguage: 'hi', reminderOffsets: [1, -1] },
      { ...defaults, absenceAlerts: false, messageLanguage: 'hi', reminderOffsets: [1, -1] },
    ],
    [{ showUpiInReminders: true }, { ...defaults, showUpiInReminders: true }],
    [{ showUpiInReminders: 'yes' }, defaults],
    [{ reminderOffsets: [] }, { ...defaults, reminderOffsets: [] }], // reminders off
    [{ absenceAlerts: 'yes', messageLanguage: 'fr', reminderOffsets: [1, 1.5, 99] }, defaults],
    [{ reminderOffsets: [1, 1] }, defaults], // repeats
    [null, defaults],
  ])('parseSettings(%j) -> %j (lenient, with defaults)', (json, expected) => {
    expect(parseSettings(json)).toEqual(expected);
  });
});

describe('Institute.withSettings', () => {
  it('changes only what is sent', () => {
    const changed = create().withSettings({ messageLanguage: 'hi', reminderOffsets: [] });
    expect(changed.settings).toEqual({
      absenceAlerts: true,
      messageLanguage: 'hi',
      reminderOffsets: [],
      showUpiInReminders: false,
    });
  });

  it.each([[[1, 1]], [[99]], [[1.5]], [[1, 2, 3, 4, 5, 6, 7]]])(
    'rejects offsets %j (422)',
    (offsets) => {
      expect(() => create().withSettings({ reminderOffsets: offsets })).toThrow(
        fieldError('settings.reminderOffsets'),
      );
    },
  );
});

describe('UPI ID (FR-7.5)', () => {
  it('a new institute has no UPI ID and the reminder line off', () => {
    expect(create().upiId).toBeNull();
    expect(create().reminderUpiId).toBeNull();
  });

  it('tidies the UPI ID: trimmed and lowercase', () => {
    expect(create().withUpiId('  SharmaClasses@OkAxis ').upiId).toBe('sharmaclasses@okaxis');
  });

  it.each(['sharma', 'sharma@', '@okaxis', 'sharma classes@okaxis', 'sharma@ok axis', 'a@b'])(
    'rejects %j (422)',
    (raw) => {
      expect(() => create().withUpiId(raw)).toThrow(fieldError('upiId'));
    },
  );

  it('accepts real-looking UPI IDs', () => {
    for (const raw of ['9876543210@ybl', 'sharma.classes@okhdfcbank', 'ravi_k-1@paytm']) {
      expect(create().withUpiId(raw).upiId).toBe(raw);
    }
  });

  it('shows the UPI ID in reminders only when the owner turns the line on', () => {
    const withId = create().withUpiId('sharma@okaxis');
    expect(withId.reminderUpiId).toBeNull();
    expect(withId.withSettings({ showUpiInReminders: true }).reminderUpiId).toBe('sharma@okaxis');
  });

  it('refuses to turn the line on without a UPI ID (422)', () => {
    expect(() => create().withSettings({ showUpiInReminders: true })).toThrow(
      fieldError('settings.showUpiInReminders'),
    );
  });

  it('removing the UPI ID (null or "") also turns the line off', () => {
    const on = create().withUpiId('sharma@okaxis').withSettings({ showUpiInReminders: true });
    for (const removed of [on.withUpiId(null), on.withUpiId('  ')]) {
      expect(removed.upiId).toBeNull();
      expect(removed.settings.showUpiInReminders).toBe(false);
      expect(removed.reminderUpiId).toBeNull();
    }
  });
});

describe('deletion state', () => {
  it('a new institute is not pending deletion', () => {
    expect(create().isPendingDeletion).toBe(false);
    expect(create().purgeAfter).toBeNull();
  });

  it('purge may run 30 days after the request', () => {
    const requested = Institute.restore({
      ...create().toProps(),
      deletionRequestedAt: new Date('2026-10-20T10:00:00Z'),
    });
    expect(requested.isPendingDeletion).toBe(true);
    expect(requested.purgeAfter).toEqual(new Date('2026-11-19T10:00:00Z'));
  });
});
