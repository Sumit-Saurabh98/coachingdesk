import { describe, expect, it } from 'vitest';
import { compareByRollThenName, compareRollNumbers } from '../roll-number';

describe('compareRollNumbers', () => {
  it('numbers as numbers, letters after, no roll number last', () => {
    const rolls = ['10', null, '2', '12A', '12', 'B-07', 'b-10', '1', null];
    expect([...rolls].sort(compareRollNumbers)).toEqual([
      '1',
      '2',
      '10',
      '12',
      '12A',
      'B-07',
      'b-10',
      null,
      null,
    ]);
  });

  it('equal values are equal; case does not matter', () => {
    expect(compareRollNumbers('12a', '12A')).toBe(0);
    expect(compareRollNumbers(null, null)).toBe(0);
  });
});

describe('compareByRollThenName', () => {
  it('roll first, then name for the ones without', () => {
    const people = [
      { rollNumber: null, name: 'Zoya' },
      { rollNumber: '3', name: 'Ravi' },
      { rollNumber: null, name: 'aarav' },
      { rollNumber: '1', name: 'Mehul' },
    ];
    expect([...people].sort(compareByRollThenName).map((p) => p.name)).toEqual([
      'Mehul',
      'Ravi',
      'aarav',
      'Zoya',
    ]);
  });
});
