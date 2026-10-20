import { describe, expect, it } from 'vitest';
import { InvalidPhoneNumberError, PhoneNumber } from '../index';

describe('PhoneNumber', () => {
  it.each([
    '9876543210',
    '98765 43210',
    '098765-43210',
    '+91 98765 43210',
    '+91-9876543210',
    '919876543210',
    '  (+91) 98765.43210 ',
  ])('normalises %s', (input) => {
    expect(PhoneNumber.parse(input).toE164()).toBe('+919876543210');
  });

  it.each(['12345', '98765432101', '+1 415 555 0100', '5876543210', '', 'abcdefghij'])(
    'rejects %s',
    (input) => {
      expect(() => PhoneNumber.parse(input)).toThrow(InvalidPhoneNumberError);
    },
  );

  it('formats for display and masks for logs', () => {
    const phone = PhoneNumber.parse('9876543210');
    expect(phone.toNational()).toBe('98765 43210');
    expect(phone.masked()).toBe('+9198XXXXX210');
  });

  it('never leaks the full number through string conversion', () => {
    const phone = PhoneNumber.parse('9876543210');
    // The point of this test IS the template conversion (a phone dropped into a log line).
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    expect(`${phone}`).toBe('+9198XXXXX210');
    expect(String(phone)).not.toContain('76543');
  });

  it('serialises to E.164 in JSON and compares by value', () => {
    expect(JSON.stringify({ guardianPhone: PhoneNumber.parse('98765 43210') })).toBe(
      '{"guardianPhone":"+919876543210"}',
    );
    expect(PhoneNumber.parse('9876543210').equals(PhoneNumber.parse('+919876543210'))).toBe(true);
  });
});
