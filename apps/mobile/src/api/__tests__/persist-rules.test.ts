import { describe, expect, it } from 'vitest';
import { shouldPersistQuery } from '../persist-rules';

describe('shouldPersistQuery', () => {
  it.each([
    [['institutes', 'i1', 'attendance', 'today'], 'success', true],
    [['me'], 'success', true],
    [['institutes', 'i1', 'students', 'list'], 'error', false],
    [['institutes', 'i1', 'batches'], 'pending', false],
    [['attendance-outbox'], 'success', false],
  ])('%j %s -> %s', (key, status, persist) => {
    expect(shouldPersistQuery(key, status)).toBe(persist);
  });
});
