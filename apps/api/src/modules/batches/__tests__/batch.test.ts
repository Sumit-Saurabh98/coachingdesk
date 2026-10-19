import { describe, expect, it } from 'vitest';
import { type FeeCycle, Money } from '@coachingdesk/shared';
import { Batch, type NewBatchInput } from '../batch';

const input = (overrides: Partial<NewBatchInput> = {}): NewBatchInput => ({
  name: 'Class 10 Maths',
  schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
  defaultFeePaise: 150000,
  defaultFeeCycle: 'monthly',
  ...overrides,
});

const create = (overrides: Partial<NewBatchInput> = {}) =>
  Batch.create('batch-1', 'inst-1', input(overrides));

const fieldError = (field: string) =>
  expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field } });

describe('Batch.create', () => {
  it('builds a batch and shows it in the API shape', () => {
    expect(create({ subject: 'Maths' }).toPublicJSON()).toEqual({
      id: 'batch-1',
      name: 'Class 10 Maths',
      subject: 'Maths',
      schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
      defaultFeePaise: 150000,
      defaultFeeCycle: 'monthly',
      archivedAt: null,
    });
    expect(create().instituteId).toBe('inst-1');
  });

  it('tidies the name and subject; an empty subject means "not given"', () => {
    const batch = create({ name: '  Class 10   Maths ', subject: '   ' });
    expect(batch.name).toBe('Class 10 Maths');
    expect(batch.subject).toBeNull();
  });

  it.each(['', 'A', 'x'.repeat(81)])('rejects the name %j', (name) => {
    expect(() => create({ name })).toThrow(fieldError('name'));
  });

  it('rejects a subject over 60 characters', () => {
    expect(() => create({ subject: 'x'.repeat(61) })).toThrow(fieldError('subject'));
  });

  it.each([-1, 1500.5])(
    'rejects the fee %s with a field error (422, not 500)',
    (defaultFeePaise) => {
      expect(() => create({ defaultFeePaise })).toThrow(fieldError('defaultFeePaise'));
    },
  );

  it('allows a free batch (fee 0)', () => {
    expect(create({ defaultFeePaise: 0, defaultFeeCycle: 'none' }).defaultFee.isZero()).toBe(true);
  });

  it('accepts every fee cycle, rejects an unknown one', () => {
    for (const cycle of [
      'monthly',
      'quarterly',
      'half_yearly',
      'yearly',
      'one_time',
      'none',
    ] as const) {
      expect(create({ defaultFeeCycle: cycle }).defaultFeeCycle).toBe(cycle);
    }
    expect(() => create({ defaultFeeCycle: 'weekly' as FeeCycle })).toThrow(
      fieldError('defaultFeeCycle'),
    );
  });

  it('rejects a bad schedule', () => {
    const schedule = { days: [1], start: '18:00', end: '17:00' };
    expect(() => create({ schedule })).toThrow(fieldError('schedule'));
  });
});

describe('Batch.withChanges', () => {
  it('returns a NEW batch; the original is untouched', () => {
    const original = create();
    const changed = original.withChanges({ defaultFeePaise: 200000, subject: 'Maths' });
    expect(changed.defaultFee.equals(Money.ofPaise(200000))).toBe(true);
    expect(changed.subject).toBe('Maths');
    expect(changed.name).toBe('Class 10 Maths'); // not sent -> kept
    expect(original.defaultFee.toPaise()).toBe(150000);
  });

  it('replaces the schedule as a whole', () => {
    const changed = create().withChanges({ schedule: { days: [6], start: '09:00', end: '11:00' } });
    expect(changed.schedule.toJSON()).toEqual({ days: [6], start: '09:00', end: '11:00' });
  });

  it('clears the subject with null', () => {
    expect(create({ subject: 'Maths' }).withChanges({ subject: null }).subject).toBeNull();
  });

  it('uses the same rules as create', () => {
    expect(() => create().withChanges({ name: 'A' })).toThrow(fieldError('name'));
  });

  it('refuses to change an archived batch (409)', () => {
    const archived = create().archive(new Date('2026-10-19T10:00:00Z'));
    expect(() => archived.withChanges({ name: 'New name' })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });
});

describe('Batch.archive', () => {
  const first = new Date('2026-10-19T10:00:00Z');
  const second = new Date('2026-10-20T10:00:00Z');

  it('sets archivedAt', () => {
    const archived = create().archive(first);
    expect(archived.isArchived).toBe(true);
    expect(archived.toPublicJSON().archivedAt).toBe('2026-10-19T10:00:00.000Z');
  });

  it('is idempotent: archiving again keeps the FIRST time', () => {
    const archived = create().archive(first);
    expect(archived.archive(second)).toBe(archived);
    expect(archived.archive(second).archivedAt).toEqual(first);
  });
});

describe('Batch.restore', () => {
  it('rebuilds a stored batch as-is', () => {
    const props = { ...create().toProps(), archivedAt: new Date('2026-10-19T10:00:00Z') };
    expect(Batch.restore(props).toProps()).toEqual(props);
  });
});
