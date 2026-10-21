import { describe, expect, it } from 'vitest';
import {
  allPresent,
  countMarks,
  initialMarks,
  marksToSend,
  type RegisterRow,
  tapped,
} from '../register-rules';

const row = (
  studentId: string,
  status: RegisterRow['status'] = 'present',
  marked = false,
): RegisterRow => ({ studentId, name: studentId, status, marked });

describe('initialMarks', () => {
  it('starts from what the server has (unmarked = present)', () => {
    expect(initialMarks([row('a'), row('b', 'absent', true)])).toEqual({
      a: 'present',
      b: 'absent',
    });
  });
});

describe('tapped', () => {
  it.each([
    ['present', 'absent'],
    ['absent', 'present'],
    ['late', 'absent'],
    ['leave', 'absent'],
  ] as const)('%s -> %s', (from, to) => {
    expect(tapped(from)).toBe(to);
  });
});

describe('countMarks', () => {
  it('counts each status', () => {
    expect(countMarks({ a: 'present', b: 'absent', c: 'present', d: 'late' })).toEqual({
      present: 2,
      absent: 1,
      late: 1,
      leave: 0,
    });
  });
});

describe('marksToSend', () => {
  it('first time: everyone (all unmarked)', () => {
    const rows = [row('a'), row('b')];
    expect(marksToSend(rows, { a: 'present', b: 'absent' })).toEqual([
      { studentId: 'a', status: 'present' },
      { studentId: 'b', status: 'absent' },
    ]);
  });

  it('editing: only the changed marks and anyone still unmarked', () => {
    const rows = [
      row('a', 'present', true), // untouched: another phone's mark stays theirs
      row('b', 'absent', true), // changed here
      row('c'), // joined later, never marked
    ];
    expect(marksToSend(rows, { a: 'present', b: 'present', c: 'present' })).toEqual([
      { studentId: 'b', status: 'present' },
      { studentId: 'c', status: 'present' },
    ]);
  });

  it('nothing changed on a taken register: nothing to send', () => {
    const rows = [row('a', 'present', true), row('b', 'late', true)];
    expect(marksToSend(rows, initialMarks(rows))).toEqual([]);
  });
});

describe('allPresent', () => {
  it('marks everyone present', () => {
    expect(allPresent([row('a', 'absent', true), row('b', 'late')])).toEqual({
      a: 'present',
      b: 'present',
    });
  });
});
