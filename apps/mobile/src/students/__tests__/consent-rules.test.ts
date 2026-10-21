import { describe, expect, it } from 'vitest';
import { consentView } from '../consent-rules';

describe('consentView', () => {
  it.each([
    ['opted_in', false, true, 'consent.on'],
    ['opted_out', false, false, 'consent.off'],
    ['unknown', false, false, 'consent.unknown'], // never assumed
    ['opted_in', true, true, 'consent.stoppedEverywhere'], // STOP wins
  ] as const)('%s, STOP %s -> on %s, %s', (status, stop, on, note) => {
    expect(consentView(status, stop)).toEqual({ on, note });
  });
});
