import { describe, expect, it } from 'vitest';
import { maskPhones } from '../http/log-redaction';

describe('maskPhones', () => {
  it.each([
    [
      '/v1/institutes/x/guardians/9812345678/opt-in',
      '/v1/institutes/x/guardians/98XXXXX678/opt-in',
    ],
    ['/guardians/%2B919812345678/opt-in', '/guardians/%2B9198XXXXX678/opt-in'],
    ['/guardians/+919812345678', '/guardians/+9198XXXXX678'],
    ['/students?q=9812345678', '/students?q=98XXXXX678'],
  ])('%s -> %s', (input, expected) => {
    expect(maskPhones(input)).toBe(expected);
  });

  it('leaves ids, UUIDs, amounts and short numbers alone', () => {
    const url =
      '/v1/institutes/01a151a0-c840-7332-8052-c09c6d7d7348/students?limit=50&fee=150000&x=123456789012';
    expect(maskPhones(url)).toBe(url);
  });
});
