import { describe, expect, it } from 'vitest';
import { FixedClock, LocalDate, PhoneNumber, SequentialIdGenerator } from '@coachingdesk/shared';
import { InMemoryStudentRepository } from '../student.repository';
import { type NewStudentRequest, StudentService } from '../student.service';

const INSTITUTE_A = 'inst-a';
const INSTITUTE_B = 'inst-b';

// 19:00 UTC on 18 Oct = 00:30 IST on 19 Oct: "today" at the institute is the 19th.
const NOW = new Date('2026-10-18T19:00:00Z');

function setup(limit: number | null = 25) {
  const repository = new InMemoryStudentRepository();
  const service = new StudentService({
    students: repository,
    entitlements: { limitFor: async () => limit },
    institutes: { get: async () => ({ timezone: 'Asia/Kolkata' }) },
    ids: new SequentialIdGenerator(),
    clock: new FixedClock(NOW),
  });
  return { service, repository };
}

const request = (overrides: Partial<NewStudentRequest> = {}): NewStudentRequest => ({
  name: 'Aarav Sharma',
  guardianPhone: PhoneNumber.parse('9876543210'),
  ...overrides,
});

describe('StudentService.create', () => {
  it("joins TODAY in the institute's time zone when no date is given", async () => {
    const { service } = setup();
    const student = await service.create(INSTITUTE_A, request());
    expect(student.joinedOn.toString()).toBe('2026-10-19'); // not the 18th (UTC)
  });

  it('uses the given join date', async () => {
    const { service } = setup();
    const student = await service.create(
      INSTITUTE_A,
      request({ joinedOn: LocalDate.parse('2026-06-01') }),
    );
    expect(student.joinedOn.toString()).toBe('2026-06-01');
  });

  it('402 PLAN_LIMIT_REACHED at the limit, with the limit in details', async () => {
    const { service } = setup(1);
    await service.create(INSTITUTE_A, request());

    await expect(service.create(INSTITUTE_A, request({ name: 'Second' }))).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 1 },
    });
  });

  it('a student who left frees a slot', async () => {
    const { service } = setup(1);
    const first = await service.create(INSTITUTE_A, request());
    await service.leave(INSTITUTE_A, first.id);

    await expect(service.create(INSTITUTE_A, request({ name: 'Second' }))).resolves.toBeDefined();
  });

  it('unlimited plan (null): no limit', async () => {
    const { service } = setup(null);
    for (let i = 0; i < 30; i++) {
      await service.create(INSTITUTE_A, request({ name: `Student ${i}` }));
    }
    expect(
      (await service.list(INSTITUTE_A, { status: 'active', limit: 100 })).students,
    ).toHaveLength(30);
  });
});

describe('StudentService.bulkCreate', () => {
  it('creates the good rows and reports the bad ones (1-based row numbers)', async () => {
    const { service } = setup();

    const result = await service.bulkCreate(INSTITUTE_A, [
      { name: 'Aarav', guardianPhone: '9876543210' },
      { name: 'Ravi', guardianPhone: '98765' },
      { name: 'B', guardianPhone: '9123456789' },
      { name: 'Chirag', guardianPhone: '+91 91234 56789', guardianName: 'Sunita' },
    ]);

    expect(result.created.map((s) => s.name)).toEqual(['Aarav', 'Chirag']);
    expect(result.failed).toEqual([
      {
        row: 2,
        field: 'guardianPhone',
        message: expect.any(String),
        input: { name: 'Ravi', guardianPhone: '98765' },
      },
      { row: 3, field: 'name', message: expect.any(String), input: expect.any(Object) },
    ]);
  });

  it('all rows join on the given date, or today at the institute', async () => {
    const { service } = setup();
    const today = await service.bulkCreate(INSTITUTE_A, [
      { name: 'Aarav', guardianPhone: '9876543210' },
    ]);
    const dated = await service.bulkCreate(
      INSTITUTE_A,
      [{ name: 'Bhavya', guardianPhone: '9876543210' }],
      LocalDate.parse('2026-07-01'),
    );
    expect(today.created[0]?.joinedOn.toString()).toBe('2026-10-19');
    expect(dated.created[0]?.joinedOn.toString()).toBe('2026-07-01');
  });

  it('over the limit: the whole request is refused and nothing is stored', async () => {
    const { service } = setup(2);
    const rows = ['Aarav', 'Bhavya', 'Chirag'].map((name) => ({
      name,
      guardianPhone: '9876543210',
    }));

    await expect(service.bulkCreate(INSTITUTE_A, rows)).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
    });
    expect((await service.list(INSTITUTE_A, { status: 'all', limit: 100 })).students).toEqual([]);
  });

  it('bad rows do not count toward the limit', async () => {
    const { service } = setup(1);
    const result = await service.bulkCreate(INSTITUTE_A, [
      { name: 'Aarav', guardianPhone: '9876543210' },
      { name: 'Ravi', guardianPhone: '123' },
    ]);
    expect(result.created).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });

  it('all rows bad: nothing created, no limit check needed', async () => {
    const { service } = setup(0);
    const result = await service.bulkCreate(INSTITUTE_A, [{ name: 'Ravi', guardianPhone: '1' }]);
    expect(result).toMatchObject({ created: [], failed: [{ row: 1 }] });
  });
});

describe('StudentService.list', () => {
  it('pages with an opaque cursor', async () => {
    const { service } = setup();
    for (const name of ['Aarav', 'Bhavya', 'Chirag']) {
      await service.create(INSTITUTE_A, request({ name }));
    }

    const first = await service.list(INSTITUTE_A, { status: 'active', limit: 2 });
    const second = await service.list(INSTITUTE_A, {
      status: 'active',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.students.map((s) => s.name)).toEqual(['Aarav', 'Bhavya']);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.students.map((s) => s.name)).toEqual(['Chirag']);
    expect(second.nextCursor).toBeNull();
  });

  it.each(['not-base64-json', Buffer.from('["x","not-a-uuid"]').toString('base64url')])(
    'a tampered cursor is a 422, not a crash (%s)',
    async (cursor) => {
      const { service } = setup();
      await expect(
        service.list(INSTITUTE_A, { status: 'active', limit: 2, cursor }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'cursor' } });
    },
  );
});

describe('StudentService.get / update / leave', () => {
  it("404 for another institute's student", async () => {
    const { service } = setup();
    const student = await service.create(INSTITUTE_A, request());
    await expect(service.get(INSTITUTE_B, student.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.update(INSTITUTE_B, student.id, { name: 'Hijacked' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.leave(INSTITUTE_B, student.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('update saves the changes', async () => {
    const { service } = setup();
    const student = await service.create(INSTITUTE_A, request());
    await service.update(INSTITUTE_A, student.id, { notes: 'Weak in algebra' });
    expect((await service.get(INSTITUTE_A, student.id)).notes).toBe('Weak in algebra');
  });

  it('leave: defaults to today at the institute, and is idempotent', async () => {
    const { service } = setup();
    const student = await service.create(
      INSTITUTE_A,
      request({ joinedOn: LocalDate.parse('2026-01-01') }),
    );

    const left = await service.leave(INSTITUTE_A, student.id);
    const again = await service.leave(INSTITUTE_A, student.id, LocalDate.parse('2026-12-31'));

    expect(left.leftOn?.toString()).toBe('2026-10-19');
    expect(again.leftOn?.toString()).toBe('2026-10-19');
  });
});
