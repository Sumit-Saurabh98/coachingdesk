import { describe, expect, it } from 'vitest';
import { methodParts } from '../dashboard-rules';

describe('methodParts', () => {
  it('only the methods used, UPI first', () => {
    expect(methodParts({ cash: 115000, upi_link: 310000, bank: 0 })).toEqual([
      { method: 'upi_link', paise: 310000 },
      { method: 'cash', paise: 115000 },
    ]);
  });

  it('nothing collected: nothing to list', () => {
    expect(methodParts({})).toEqual([]);
  });
});
