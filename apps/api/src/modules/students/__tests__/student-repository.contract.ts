import { describe, expect, it } from 'vitest';
import { LocalDate, PhoneNumber } from '@coachingdesk/shared';
import { Student } from '../student';
import type { StudentListQuery, StudentRepository } from '../student.repository';

/** Institutes that must exist before the contract runs (Postgres foreign key). */
export const CONTRACT_INSTITUTE_A = '00000000-0000-7000-8000-0000000007a1';
export const CONTRACT_INSTITUTE_B = '00000000-0000-7000-8000-0000000007b1';

const studentId = (n: number) => `00000000-0000-7000-8000-0000000008${String(n).padStart(2, '0')}`;

const newStudent = (
  n: number,
  name = `Student ${n}`,
  extra: { instituteId?: string; guardianName?: string; phone?: string } = {},
) =>
  Student.create(studentId(n), extra.instituteId ?? CONTRACT_INSTITUTE_A, {
    name,
    guardianName: extra.guardianName ?? null,
    guardianPhone: PhoneNumber.parse(extra.phone ?? '9876543210'),
    joinedOn: LocalDate.parse('2026-10-01'),
  });

const leftOn = LocalDate.parse('2026-12-31');
const names = (students: Student[]) => students.map((s) => s.name);
const query = (overrides: Partial<StudentListQuery> = {}): StudentListQuery => ({
  status: 'active',
  limit: 50,
  ...overrides,
});

export function describeStudentRepositoryContract(
  name: string,
  create: () => StudentRepository,
): void {
  describe(`StudentRepository contract: ${name}`, () => {
    const seed = async (repo: StudentRepository, ...students: Student[]) => {
      for (const student of students) {
        expect(await repo.createWithinLimit(student.instituteId, [student], null)).toBe('created');
      }
    };

    it('creates a student that can be found again, unchanged', async () => {
      const repo = create();
      const student = newStudent(1, 'Aarav', { guardianName: 'Neha' });
      await seed(repo, student);

      expect((await repo.findById(CONTRACT_INSTITUTE_A, student.id))?.toProps()).toEqual(
        student.toProps(),
      );
    });

    it("TENANCY: another institute's student is invisible", async () => {
      const repo = create();
      await seed(repo, newStudent(1));
      expect(await repo.findById(CONTRACT_INSTITUTE_B, studentId(1))).toBeNull();
    });

    describe('plan limit', () => {
      it('creates up to the limit, exactly', async () => {
        const repo = create();
        const result = await repo.createWithinLimit(
          CONTRACT_INSTITUTE_A,
          [newStudent(1), newStudent(2)],
          2,
        );
        expect(result).toBe('created');
      });

      it('over the limit: refuses ALL of them (none stored)', async () => {
        const repo = create();
        await seed(repo, newStudent(1));

        const result = await repo.createWithinLimit(
          CONTRACT_INSTITUTE_A,
          [newStudent(2), newStudent(3)],
          2,
        );

        expect(result).toBe('limit_reached');
        expect(await repo.findById(CONTRACT_INSTITUTE_A, studentId(2))).toBeNull();
        expect(await repo.findById(CONTRACT_INSTITUTE_A, studentId(3))).toBeNull();
      });

      it('students who left do not count', async () => {
        const repo = create();
        const leaver = newStudent(1);
        await seed(repo, leaver);
        await repo.update(leaver.leave(leftOn));

        expect(await repo.createWithinLimit(CONTRACT_INSTITUTE_A, [newStudent(2)], 1)).toBe(
          'created',
        );
      });

      it('countActive: active students of this institute only', async () => {
        const repo = create();
        const leaver = newStudent(1);
        await seed(
          repo,
          leaver,
          newStudent(2),
          newStudent(3, 'Other', { instituteId: CONTRACT_INSTITUTE_B }),
        );
        await repo.update(leaver.leave(leftOn));
        expect(await repo.countActive(CONTRACT_INSTITUTE_A)).toBe(1);
      });

      it("another institute's students do not count", async () => {
        const repo = create();
        await seed(repo, newStudent(1, 'Theirs', { instituteId: CONTRACT_INSTITUTE_B }));
        expect(await repo.createWithinLimit(CONTRACT_INSTITUTE_A, [newStudent(2)], 1)).toBe(
          'created',
        );
      });
    });

    describe('list', () => {
      it('sorts by name ignoring case, and shows only this institute', async () => {
        const repo = create();
        await seed(
          repo,
          newStudent(1, 'chirag'),
          newStudent(2, 'Aarav'),
          newStudent(3, 'bhavya'),
          newStudent(4, 'Other', { instituteId: CONTRACT_INSTITUTE_B }),
        );

        const page = await repo.list(CONTRACT_INSTITUTE_A, query());

        expect(names(page.students)).toEqual(['Aarav', 'bhavya', 'chirag']);
        expect(page.next).toBeNull();
      });

      it('filters by status: active (default), left, all', async () => {
        const repo = create();
        const leaver = newStudent(1, 'Leaver');
        await seed(repo, leaver, newStudent(2, 'Stayer'));
        await repo.update(leaver.leave(leftOn));

        expect(names((await repo.list(CONTRACT_INSTITUTE_A, query())).students)).toEqual([
          'Stayer',
        ]);
        expect(
          names((await repo.list(CONTRACT_INSTITUTE_A, query({ status: 'left' }))).students),
        ).toEqual(['Leaver']);
        expect(
          names((await repo.list(CONTRACT_INSTITUTE_A, query({ status: 'all' }))).students),
        ).toEqual(['Leaver', 'Stayer']);
      });

      it.each([
        ['part of the name, any case', 'ARAV', ['Aarav Sharma']],
        ['the guardian name', 'neha', ['Aarav Sharma']],
        ['phone digits', '43210', ['Aarav Sharma']],
        ['phone digits with spaces', '987 65', ['Aarav Sharma', 'Bhavya Rao']],
        ['a % sign literally, not as a wildcard', '%', []],
        ['an underscore literally', '_', []],
      ])('searches %s (q=%j)', async (_label, q, expected) => {
        const repo = create();
        await seed(
          repo,
          newStudent(1, 'Aarav Sharma', { guardianName: 'Neha', phone: '9876543210' }),
          newStudent(2, 'Bhavya Rao', { phone: '9876512345' }),
          newStudent(3, 'Chirag', { phone: '9123456789' }),
        );

        const page = await repo.list(CONTRACT_INSTITUTE_A, query({ q }));

        expect(names(page.students)).toEqual(expected);
      });

      it('restricts to the given ids (e.g. the students of one batch); [] = nobody', async () => {
        const repo = create();
        await seed(repo, newStudent(1, 'Aarav'), newStudent(2, 'Bhavya'), newStudent(3, 'Chirag'));

        const some = await repo.list(
          CONTRACT_INSTITUTE_A,
          query({ ids: [studentId(3), studentId(1)] }),
        );
        const none = await repo.list(CONTRACT_INSTITUTE_A, query({ ids: [] }));

        expect(names(some.students)).toEqual(['Aarav', 'Chirag']);
        expect(none.students).toEqual([]);
      });

      it('pages through the list with the cursor, without gaps or repeats', async () => {
        const repo = create();
        // Two students with the SAME name: the id breaks the tie, so paging stays exact.
        await seed(
          repo,
          newStudent(1, 'Aarav'),
          newStudent(2, 'Bhavya'),
          newStudent(3, 'Bhavya'),
          newStudent(4, 'Chirag'),
          newStudent(5, 'Dev'),
        );

        const seen: string[] = [];
        let after = undefined as StudentListQuery['after'];
        let pages = 0;
        do {
          const page = await repo.list(CONTRACT_INSTITUTE_A, query({ limit: 2, after }));
          seen.push(...page.students.map((s) => s.id));
          after = page.next ?? undefined;
          pages++;
        } while (after);

        expect(pages).toBe(3);
        expect(seen).toEqual([1, 2, 3, 4, 5].map(studentId));
      });

      it('a full last page has next = null when nothing follows', async () => {
        const repo = create();
        await seed(repo, newStudent(1, 'Aarav'), newStudent(2, 'Bhavya'));
        expect((await repo.list(CONTRACT_INSTITUTE_A, query({ limit: 2 }))).next).toBeNull();
      });
    });

    it("lists a guardian's students (siblings), only in this institute", async () => {
      const repo = create();
      await seed(
        repo,
        newStudent(1, 'Bhavya', { phone: '9812345678' }),
        newStudent(2, 'Aarav', { phone: '9812345678' }),
        newStudent(3, 'Chirag', { phone: '9123456789' }),
        newStudent(4, 'Other', { phone: '9812345678', instituteId: CONTRACT_INSTITUTE_B }),
      );

      const siblings = await repo.listByGuardianPhone(
        CONTRACT_INSTITUTE_A,
        PhoneNumber.parse('9812345678'),
      );

      expect(names(siblings)).toEqual(['Aarav', 'Bhavya']);
    });

    it('saves edits and leaving', async () => {
      const repo = create();
      const student = newStudent(1, 'Aarav');
      await seed(repo, student);

      await repo.update(
        student
          .withChanges({ guardianPhone: PhoneNumber.parse('9123456789'), notes: 'Note' })
          .leave(leftOn),
      );

      expect((await repo.findById(CONTRACT_INSTITUTE_A, student.id))?.toPublicJSON()).toEqual({
        id: student.id,
        name: 'Aarav',
        guardianName: null,
        guardianPhone: '+919123456789',
        status: 'left',
        joinedOn: '2026-10-01',
        leftOn: '2026-12-31',
        notes: 'Note',
      });
    });

    it("TENANCY: refuses to update another institute's student, and leaves it untouched", async () => {
      const repo = create();
      const mine = newStudent(1, 'Mine');
      await seed(repo, mine);
      const hijacked = Student.restore({
        ...mine.toProps(),
        instituteId: CONTRACT_INSTITUTE_B,
        name: 'Hijacked',
      });

      await expect(repo.update(hijacked)).rejects.toThrow();
      expect((await repo.findById(CONTRACT_INSTITUTE_A, mine.id))?.name).toBe('Mine');
    });

    it('refuses to update a student that does not exist', async () => {
      await expect(create().update(newStudent(99))).rejects.toThrow();
    });
  });
}
