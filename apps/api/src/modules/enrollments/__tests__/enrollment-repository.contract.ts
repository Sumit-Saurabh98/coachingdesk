import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import { Enrollment } from '../enrollment';
import type { EnrollmentRepository } from '../enrollment.repository';

/**
 * Rows that must exist before the contract runs (Postgres: composite foreign keys).
 * Institute A has students S1, S2 and batches B1, B2. Institute B has student S3 and batch B3.
 */
export const CONTRACT = {
  instituteA: '00000000-0000-7000-8000-0000000014a1',
  instituteB: '00000000-0000-7000-8000-0000000014b1',
  s1: '00000000-0000-7000-8000-0000000015a1',
  s2: '00000000-0000-7000-8000-0000000015a2',
  s3: '00000000-0000-7000-8000-0000000015b3',
  b1: '00000000-0000-7000-8000-0000000016a1',
  b2: '00000000-0000-7000-8000-0000000016a2',
  b3: '00000000-0000-7000-8000-0000000016b3',
} as const;

const { instituteA, instituteB, s1, s2, s3, b1, b2, b3 } = CONTRACT;
const day = (text: string) => LocalDate.parse(text);
const enrollmentId = (n: number) =>
  `00000000-0000-7000-8000-0000000017${String(n).padStart(2, '0')}`;

const enroll = (
  n: number,
  studentId: string = s1,
  batchId: string = b1,
  options: { start?: string; end?: string; instituteId?: string } = {},
) => {
  const enrollment = Enrollment.create(enrollmentId(n), options.instituteId ?? instituteA, {
    studentId,
    batchId,
    feePaise: 150000,
    discountPaise: 0,
    feeCycle: 'monthly',
    startDate: day(options.start ?? '2026-10-01'),
  });
  return options.end ? enrollment.endOn(day(options.end)) : enrollment;
};

export function describeEnrollmentRepositoryContract(
  name: string,
  create: () => EnrollmentRepository,
): void {
  describe(`EnrollmentRepository contract: ${name}`, () => {
    const seed = async (repo: EnrollmentRepository, ...enrollments: Enrollment[]) => {
      for (const e of enrollments) {
        expect(await repo.createAll(e.instituteId, [e])).toBe('created');
      }
    };

    it('creates an enrollment that can be found again, unchanged', async () => {
      const repo = create();
      const enrollment = enroll(1);
      await seed(repo, enrollment);
      expect((await repo.findById(instituteA, enrollment.id))?.toProps()).toEqual(
        enrollment.toProps(),
      );
    });

    it("TENANCY: another institute's enrollment is invisible", async () => {
      const repo = create();
      await seed(repo, enroll(1));
      expect(await repo.findById(instituteB, enrollmentId(1))).toBeNull();
      expect(await repo.listForStudent(instituteB, s1)).toEqual([]);
    });

    it('refuses a second OPEN enrollment of the same student in the same batch', async () => {
      const repo = create();
      await seed(repo, enroll(1));
      expect(await repo.createAll(instituteA, [enroll(2, s1, b1, { start: '2026-11-01' })])).toBe(
        'already_enrolled',
      );
    });

    it('allows rejoining after the previous enrollment ended', async () => {
      const repo = create();
      await seed(repo, enroll(1, s1, b1, { end: '2026-10-31' }));
      expect(await repo.createAll(instituteA, [enroll(2, s1, b1, { start: '2026-12-01' })])).toBe(
        'created',
      );
    });

    it('createAll is all-or-nothing', async () => {
      const repo = create();
      await seed(repo, enroll(1, s1, b2));

      const result = await repo.createAll(instituteA, [enroll(2, s1, b1), enroll(3, s1, b2)]);

      expect(result).toBe('already_enrolled');
      expect(await repo.findById(instituteA, enrollmentId(2))).toBeNull();
    });

    it("lists a student's enrollments by start date, only in this institute", async () => {
      const repo = create();
      await seed(
        repo,
        enroll(1, s1, b2, { start: '2026-11-01' }),
        enroll(2, s1, b1, { start: '2026-10-01' }),
        enroll(3, s2, b1),
        enroll(4, s3, b3, { instituteId: instituteB }),
      );

      const listed = await repo.listForStudent(instituteA, s1);

      expect(listed.map((e) => e.id)).toEqual([enrollmentId(2), enrollmentId(1)]);
      expect((await repo.listForStudentInBatch(instituteA, s1, b2)).map((e) => e.id)).toEqual([
        enrollmentId(1),
      ]);
    });

    it('counts and lists who is enrolled in a batch ON a date', async () => {
      const repo = create();
      await seed(
        repo,
        enroll(1, s1, b1, { start: '2026-10-01' }), // open: counted
        enroll(2, s2, b1, { start: '2026-09-01', end: '2026-10-19' }), // ends today: counted
        enroll(3, s2, b2, { start: '2026-11-01' }), // other batch
      );
      const today = day('2026-10-19');

      expect(await repo.countActiveInBatch(instituteA, b1, today)).toBe(2);
      expect((await repo.studentIdsActiveInBatch(instituteA, b1, today)).sort()).toEqual(
        [s1, s2].sort(),
      );
      expect(await repo.countActiveInBatch(instituteA, b1, day('2026-10-20'))).toBe(1);
      expect(await repo.countActiveInBatch(instituteA, b2, today)).toBe(0); // starts later
      expect(await repo.countActiveInBatch(instituteB, b1, today)).toBe(0); // tenancy
    });

    it('saves new terms and the end date', async () => {
      const repo = create();
      const enrollment = enroll(1);
      await seed(repo, enrollment);

      await repo.update(
        enrollment
          .withTerms({ feePaise: 200000, discountPaise: 25000, feeCycle: 'half_yearly' })
          .endOn(day('2026-12-31')),
      );

      expect((await repo.findById(instituteA, enrollment.id))?.toPublicJSON()).toMatchObject({
        feePaise: 200000,
        discountPaise: 25000,
        netFeePaise: 175000,
        feeCycle: 'half_yearly',
        endDate: '2026-12-31',
      });
    });

    it("TENANCY: refuses to update another institute's enrollment", async () => {
      const repo = create();
      const mine = enroll(1);
      await seed(repo, mine);
      const hijacked = Enrollment.restore({ ...mine.toProps(), instituteId: instituteB });

      await expect(repo.update(hijacked)).rejects.toThrow();
    });
  });
}
