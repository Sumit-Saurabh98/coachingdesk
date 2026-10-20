import { describe, expect, it } from 'vitest';
import { type MyInstitute, pickCurrentInstitute } from '../current-institute';

const institute = (id: string, role: MyInstitute['role'] = 'owner'): MyInstitute => ({
  id,
  name: `Institute ${id}`,
  type: 'tuition',
  role,
});

describe('pickCurrentInstitute', () => {
  it('no institutes: none (the user creates one)', () => {
    expect(pickCurrentInstitute([], null)).toBeNull();
    expect(pickCurrentInstitute([], 'a')).toBeNull();
  });

  it('exactly one: that one, even with nothing saved (a teacher just added)', () => {
    expect(pickCurrentInstitute([institute('a', 'teacher')], null)?.id).toBe('a');
  });

  it('several: the one saved on this phone', () => {
    expect(pickCurrentInstitute([institute('a'), institute('b')], 'b')?.id).toBe('b');
  });

  it('several and nothing saved: none (the user picks)', () => {
    expect(pickCurrentInstitute([institute('a'), institute('b')], null)).toBeNull();
  });

  it('saved one no longer listed (removed, or another person logged in): ignored', () => {
    expect(pickCurrentInstitute([institute('a'), institute('b')], 'gone')).toBeNull();
    expect(pickCurrentInstitute([institute('a')], 'gone')?.id).toBe('a');
  });
});
