import { describe, expect, it } from 'vitest';
import { extraAsCredit, paidAtFor, paiseToInput, parseRupees } from '../payment-rules';

describe('parseRupees', () => {
  it.each([
    ['1500', 150000],
    ['1,500', 150000],
    ['₹ 1,500.5', 150050],
    ['1500.05', 150005],
    ['0.50', 50],
    [' 12 ', 1200],
  ])('%j -> %i paise', (text, paise) => {
    expect(parseRupees(text)).toBe(paise);
  });

  it.each(['', '0', '0.00', '-100', '12.345', 'abc', '1.2.3', '1e5'])('%j -> null', (text) => {
    expect(parseRupees(text)).toBeNull();
  });
});

describe('paiseToInput', () => {
  it.each([
    [150000, '1500'],
    [150050, '1500.50'],
    [150005, '1500.05'],
    [50, '0.50'],
  ])('%i -> %s', (paise, text) => {
    expect(paiseToInput(paise)).toBe(text);
    expect(parseRupees(text)).toBe(paise); // and back
  });
});

describe('extraAsCredit', () => {
  it('only what is above the remaining due', () => {
    expect(extraAsCredit(200000, 150000)).toBe(50000);
    expect(extraAsCredit(100000, 150000)).toBe(0);
  });
});

describe('paidAtFor', () => {
  const now = new Date(2026, 9, 21, 17, 30);
  it('today: now', () => {
    expect(paidAtFor('2026-10-21', '2026-10-21', now)).toBe(now.toISOString());
  });
  it('an earlier day: noon on that day (on this phone)', () => {
    expect(new Date(paidAtFor('2026-10-18', '2026-10-21', now))).toEqual(
      new Date(2026, 9, 18, 12, 0, 0),
    );
  });
});
