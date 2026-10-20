import { describe, expect, it } from 'vitest';
import { formatIndianPhone } from '../phone-format';

describe('formatIndianPhone', () => {
  it.each([
    ['+919876543210', '+91 98765 43210'],
    [null, ''],
    ['', ''],
    ['+14155550100', '+14155550100'], // not Indian: shown as it came
  ])('%j -> %j', (input, expected) => {
    expect(formatIndianPhone(input)).toBe(expected);
  });
});
