import { describe, expect, it } from 'vitest';
import {
  formatMarks,
  parseMarks,
  toTestRequest,
  toTestUpdate,
  validateTestForm,
  valuesFromTest,
} from '../test-rules';

describe('parseMarks', () => {
  it.each([
    ['17', 17],
    ['17.5', 17.5],
    [' 17.25 ', 17.25],
    ['17,5', 17.5], // a comma is a decimal point for many phones' keypads
    ['0', 0],
  ])('%j -> %s', (text, marks) => {
    expect(parseMarks(text)).toBe(marks);
  });

  it.each(['', 'abc', '-1', '17.555', '1e2', '17.'])('%j -> null', (text) => {
    expect(parseMarks(text)).toBeNull();
  });
});

describe('formatMarks', () => {
  it('no needless decimals', () => {
    expect(formatMarks(20)).toBe('20');
    expect(formatMarks(17.5)).toBe('17.5');
    expect(formatMarks(17.25)).toBe('17.25');
  });
});

describe('validateTestForm', () => {
  const values = { name: 'Unit test 1', date: '2026-10-22', maxMarksText: '25' };

  it('valid; tidied when sent', () => {
    expect(validateTestForm(values)).toEqual({});
    expect(toTestRequest({ ...values, name: '  Unit   test 1 ' })).toEqual({
      name: 'Unit test 1',
      date: '2026-10-22',
      maxMarks: 25,
    });
  });

  it('a name (1-80) and a maximum above 0, at most 1000', () => {
    expect(validateTestForm({ ...values, name: ' ', maxMarksText: '0' })).toEqual({
      name: 'testForm.nameInvalid',
      maxMarks: 'testForm.maxInvalid',
    });
    expect(validateTestForm({ ...values, maxMarksText: '1001' }).maxMarks).toBe(
      'testForm.maxInvalid',
    );
    expect(validateTestForm({ ...values, maxMarksText: '12.5' })).toEqual({});
  });
});

describe('editing a test', () => {
  const test = { name: 'Unit 3', date: '2026-10-19', maxMarks: 12.5 };

  it('starts from the test; nothing changed -> null', () => {
    expect(valuesFromTest(test)).toEqual({
      name: 'Unit 3',
      date: '2026-10-19',
      maxMarksText: '12.5',
    });
    expect(toTestUpdate(test, valuesFromTest(test))).toBeNull();
  });

  it('only what changed', () => {
    expect(toTestUpdate(test, { ...valuesFromTest(test), maxMarksText: '25' })).toEqual({
      maxMarks: 25,
    });
  });
});
