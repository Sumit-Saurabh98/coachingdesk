import { describe, expect, it } from 'vitest';
import {
  type Enrollment,
  isOpenOn,
  joinableBatches,
  telLink,
  whatsAppLink,
} from '../profile-rules';

const enrollment = (batchId: string, endDate: string | null = null): Enrollment => ({
  id: `e-${batchId}`,
  studentId: 's1',
  batchId,
  startDate: '2026-09-01',
  endDate,
});
const batch = (id: string, archivedAt: string | null = null) => ({ id, archivedAt });
const today = '2026-10-21';

describe('isOpenOn', () => {
  it.each([
    [null, true],
    ['2026-10-21', true], // ends today: still attending today
    ['2026-10-20', false],
    ['2026-12-31', true],
  ])('endDate %j -> %s', (endDate, open) => {
    expect(isOpenOn(enrollment('b1', endDate), today)).toBe(open);
  });
});

describe('joinableBatches', () => {
  it('active batches the student is not staying in', () => {
    const batches = [
      batch('maths'),
      batch('science'),
      batch('english'),
      batch('hindi'),
      batch('old', '2026-01-01'),
    ];
    const enrollments = [
      enrollment('maths'), // staying: no end date
      enrollment('science', '2026-10-01'), // left earlier
      enrollment('hindi', today), // removed today: can be added back the same day
    ];
    expect(joinableBatches(batches, enrollments).map((b) => b.id)).toEqual([
      'science',
      'english',
      'hindi',
    ]);
  });
});

describe('contact links', () => {
  it('tel: keeps the +; wa.me drops it', () => {
    expect(telLink('+919876543210')).toBe('tel:+919876543210');
    expect(whatsAppLink('+919876543210')).toBe('https://wa.me/919876543210');
  });
});
