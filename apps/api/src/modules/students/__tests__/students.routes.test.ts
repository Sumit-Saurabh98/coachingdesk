import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PhoneNumber } from '@coachingdesk/shared';
import { OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp, loginOverHttp } from '../../../test/test-app';

let app: FastifyInstance;
let testApp: ReturnType<typeof buildTestApp>;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

const validStudent = {
  name: 'Aarav Sharma',
  guardianName: 'Neha Sharma',
  guardianPhone: '98765 43210',
  joinedOn: '2026-10-18',
};

async function setup() {
  testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const studentsUrl = `${owner.url}/students`;
  const createStudent = async (payload: unknown = validStudent) =>
    (await http.call(owner.token, 'POST', studentsUrl, payload)).json().student;
  return { ...owner, studentsUrl, createStudent };
}

/** The trial has ended and no one paid: the institute is on Free (25 active students). */
function moveToFreePlan(instituteId: string) {
  testApp.subscriptionRepository.put({
    instituteId,
    plan: 'free',
    status: 'free',
    currentPeriodEnd: null,
    graceUntil: null,
  });
}

describe('POST /v1/institutes/:instituteId/students', () => {
  it('201: phone normalised to E.164, status active', async () => {
    const { token, studentsUrl } = await setup();

    const response = await http.call(token, 'POST', studentsUrl, validStudent);

    expect(response.statusCode).toBe(201);
    expect(response.json().student).toEqual({
      id: expect.any(String),
      name: 'Aarav Sharma',
      guardianName: 'Neha Sharma',
      guardianPhone: '+919876543210',
      status: 'active',
      joinedOn: '2026-10-18',
      leftOn: null,
      studentPhone: null,
      notes: null,
      rollNumber: null,
    });
  });

  it("joinedOn defaults to today at the institute (the test clock's date)", async () => {
    const { token, studentsUrl } = await setup();
    const { joinedOn: _omit, ...withoutDate } = validStudent;
    const response = await http.call(token, 'POST', studentsUrl, withoutDate);
    expect(response.json().student.joinedOn).toBe('2026-10-19');
  });

  it('401 without a token; 403 for a teacher; 201 for staff', async () => {
    const { instituteId, studentsUrl } = await setup();
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');

    expect((await http.call(undefined, 'POST', studentsUrl, validStudent)).statusCode).toBe(401);
    expect((await http.call(teacher, 'POST', studentsUrl, validStudent)).statusCode).toBe(403);
    expect((await http.call(staff, 'POST', studentsUrl, validStudent)).statusCode).toBe(201);
  });

  it("404 in someone else's institute", async () => {
    const { studentsUrl } = await setup();
    const stranger = await loginOverHttp(app, OTHER_PHONE);
    const response = await http.call(stranger.accessToken, 'POST', studentsUrl, validStudent);
    expect(response.statusCode).toBe(404);
  });

  it.each([
    ['an invalid phone', { ...validStudent, guardianPhone: '98765' }],
    ['a missing phone', { name: 'Aarav' }],
    ['an impossible date', { ...validStudent, joinedOn: '2026-02-30' }],
    ['status in the body (only /leave changes it)', { ...validStudent, status: 'left' }],
    ['a one-letter name (entity rule)', { ...validStudent, name: 'A' }],
  ])('422 for %s', async (_label, payload) => {
    const { token, studentsUrl } = await setup();
    expect((await http.call(token, 'POST', studentsUrl, payload)).statusCode).toBe(422);
  });

  it('402 PLAN_LIMIT_REACHED for the 26th active student on Free', async () => {
    const { token, instituteId, studentsUrl, createStudent } = await setup();
    moveToFreePlan(instituteId);
    for (let i = 0; i < 25; i++) {
      await createStudent({ ...validStudent, name: `Student ${i}` });
    }

    const response = await http.call(token, 'POST', studentsUrl, validStudent);

    expect(response.statusCode).toBe(402);
    expect(response.json().error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 25 },
    });
  });

  it('during the Pro trial the same 26th student is fine', async () => {
    const { token, studentsUrl, createStudent } = await setup();
    for (let i = 0; i < 25; i++) {
      await createStudent({ ...validStudent, name: `Student ${i}` });
    }
    expect((await http.call(token, 'POST', studentsUrl, validStudent)).statusCode).toBe(201);
  });
});

describe('GET /v1/institutes/:instituteId/students', () => {
  it('200: sorted by name; a teacher can read', async () => {
    const { instituteId, studentsUrl, createStudent } = await setup();
    await createStudent({ ...validStudent, name: 'chirag' });
    await createStudent({ ...validStudent, name: 'Aarav' });
    const teacher = await http.memberWithRole(instituteId, 'teacher');

    const response = await http.call(teacher, 'GET', studentsUrl);

    expect(response.statusCode).toBe(200);
    expect(response.json().students.map((s: { name: string }) => s.name)).toEqual([
      'Aarav',
      'chirag',
    ]);
    expect(response.json().nextCursor).toBeNull();
  });

  it('pages with ?limit and nextCursor', async () => {
    const { token, studentsUrl, createStudent } = await setup();
    for (const name of ['Aarav', 'Bhavya', 'Chirag']) {
      await createStudent({ ...validStudent, name });
    }

    const first = (await http.call(token, 'GET', `${studentsUrl}?limit=2`)).json();
    const second = (
      await http.call(token, 'GET', `${studentsUrl}?limit=2&cursor=${first.nextCursor}`)
    ).json();

    expect(first.students).toHaveLength(2);
    expect(second.students.map((s: { name: string }) => s.name)).toEqual(['Chirag']);
    expect(second.nextCursor).toBeNull();
  });

  it('searches with ?q= (name or phone digits)', async () => {
    const { token, studentsUrl, createStudent } = await setup();
    await createStudent({ ...validStudent, name: 'Aarav', guardianPhone: '9876543210' });
    await createStudent({ ...validStudent, name: 'Bhavya', guardianPhone: '9123456789' });

    const byName = (await http.call(token, 'GET', `${studentsUrl}?q=bhav`)).json();
    const byPhone = (await http.call(token, 'GET', `${studentsUrl}?q=43210`)).json();

    expect(byName.students.map((s: { name: string }) => s.name)).toEqual(['Bhavya']);
    expect(byPhone.students.map((s: { name: string }) => s.name)).toEqual(['Aarav']);
  });

  it.each(['limit=0', 'limit=abc', 'status=deleted', 'cursor=garbage'])(
    '422 for ?%s',
    async (query) => {
      const { token, studentsUrl } = await setup();
      expect((await http.call(token, 'GET', `${studentsUrl}?${query}`)).statusCode).toBe(422);
    },
  );

  it("never shows another institute's students", async () => {
    const { createStudent } = await setup();
    await createStudent();
    const other = await http.ownerWithInstitute(OTHER_PHONE);
    const response = await http.call(other.token, 'GET', `${other.url}/students`);
    expect(response.json().students).toEqual([]);
  });
});

describe('GET / PATCH /v1/institutes/:instituteId/students/:studentId', () => {
  it('200 with the student', async () => {
    const { token, studentsUrl, createStudent } = await setup();
    const student = await createStudent();
    const response = await http.call(token, 'GET', `${studentsUrl}/${student.id}`);
    expect(response.json().student).toEqual({ ...student, readOnly: false });
  });

  it("TENANCY: 404 for another institute's student, even through my OWN institute's URL", async () => {
    const { createStudent } = await setup();
    const nehasStudent = await createStudent();
    const ravi = await http.ownerWithInstitute(OTHER_PHONE);

    const read = await http.call(ravi.token, 'GET', `${ravi.url}/students/${nehasStudent.id}`);
    const write = await http.call(ravi.token, 'PATCH', `${ravi.url}/students/${nehasStudent.id}`, {
      name: 'Hijacked',
    });

    expect(read.statusCode).toBe(404);
    expect(write.statusCode).toBe(404);
  });

  it('404 (not 500) for an id that is not a UUID', async () => {
    const { token, studentsUrl } = await setup();
    expect((await http.call(token, 'GET', `${studentsUrl}/abc`)).statusCode).toBe(404);
  });

  it('PATCH 200 changes only what was sent; 403 teacher; 422 empty body', async () => {
    const { token, instituteId, studentsUrl, createStudent } = await setup();
    const student = await createStudent();
    const url = `${studentsUrl}/${student.id}`;
    const teacher = await http.memberWithRole(instituteId, 'teacher');

    const patched = await http.call(token, 'PATCH', url, { guardianPhone: '9123456789' });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().student).toEqual({ ...student, guardianPhone: '+919123456789' });
    expect((await http.call(teacher, 'PATCH', url, { name: 'New' })).statusCode).toBe(403);
    expect((await http.call(token, 'PATCH', url, {})).statusCode).toBe(422);
  });
});

describe("the student's own number", () => {
  it('optional; normalised; its own consent; never the same as the parent', async () => {
    const { token, studentsUrl, instituteId } = await setup();
    const created = await http.call(token, 'POST', studentsUrl, {
      ...validStudent,
      studentPhone: '91234 56789',
      studentConsent: true,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().student.studentPhone).toBe('+919123456789');
    const consentOf = (phone: string) =>
      testApp.consentRepository.consentOf(instituteId, PhoneNumber.parse(phone));
    expect(await consentOf('9123456789')).toBe('opted_in');
    expect(await consentOf('9876543210')).toBe('unknown'); // the parent's: not asked here

    const same = await http.call(token, 'POST', studentsUrl, {
      ...validStudent,
      studentPhone: '9876543210',
    });
    expect(same.statusCode).toBe(422);
    expect(same.json().error.details).toMatchObject({ field: 'studentPhone' });
  });

  it('PATCH sets or removes it; search finds the student by its digits', async () => {
    const { token, studentsUrl, createStudent } = await setup();
    const aarav = await createStudent();
    const set = await http.call(token, 'PATCH', `${studentsUrl}/${aarav.id}`, {
      studentPhone: '9123456789',
    });
    expect(set.json().student.studentPhone).toBe('+919123456789');

    const found = await http.call(token, 'GET', `${studentsUrl}?q=91234`);
    expect(found.json().students.map((s: { id: string }) => s.id)).toEqual([aarav.id]);

    const removed = await http.call(token, 'PATCH', `${studentsUrl}/${aarav.id}`, {
      studentPhone: null,
    });
    expect(removed.json().student.studentPhone).toBeNull();
  });
});

describe('roll numbers', () => {
  it('set when adding, tidied; a duplicate is 409 rollNumber; PATCH changes or removes it', async () => {
    const { token, studentsUrl, createStudent } = await setup();
    const aarav = await createStudent({ ...validStudent, rollNumber: '  12A ' });
    expect(aarav.rollNumber).toBe('12A');

    const clash = await http.call(token, 'POST', studentsUrl, {
      ...validStudent,
      name: 'Bhavya',
      rollNumber: '12a',
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.details).toMatchObject({ field: 'rollNumber' });

    const bhavya = await createStudent({ ...validStudent, name: 'Bhavya', rollNumber: '13' });
    const toTaken = await http.call(token, 'PATCH', `${studentsUrl}/${bhavya.id}`, {
      rollNumber: '12A',
    });
    expect(toTaken.statusCode).toBe(409);
    const removed = await http.call(token, 'PATCH', `${studentsUrl}/${aarav.id}`, {
      rollNumber: '',
    });
    expect(removed.json().student.rollNumber).toBeNull();
  });

  it('422 for more than 20 characters', async () => {
    const { token, studentsUrl } = await setup();
    const response = await http.call(token, 'POST', studentsUrl, {
      ...validStudent,
      rollNumber: 'x'.repeat(21),
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('POST /v1/institutes/:instituteId/students/:studentId/leave', () => {
  it('200 with no body = left today; a retry keeps the first date', async () => {
    const { token, studentsUrl, createStudent } = await setup();
    const student = await createStudent();
    const url = `${studentsUrl}/${student.id}/leave`;

    const first = await http.call(token, 'POST', url);
    const retry = await http.call(token, 'POST', url, { leftOn: '2026-12-31' });

    expect(first.statusCode).toBe(200);
    expect(first.json().student).toMatchObject({ status: 'left', leftOn: '2026-10-19' });
    expect(retry.json().student.leftOn).toBe('2026-10-19');
  });

  it('422 when leaving before joining', async () => {
    const { token, studentsUrl, createStudent } = await setup();
    const student = await createStudent();
    const response = await http.call(token, 'POST', `${studentsUrl}/${student.id}/leave`, {
      leftOn: '2026-01-01',
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.details).toEqual({ field: 'leftOn' });
  });

  it('a left student is hidden from the default list and frees a plan slot', async () => {
    const { token, instituteId, studentsUrl, createStudent } = await setup();
    moveToFreePlan(instituteId);
    const students = [];
    for (let i = 0; i < 25; i++) {
      students.push(await createStudent({ ...validStudent, name: `Student ${i}` }));
    }
    await http.call(token, 'POST', `${studentsUrl}/${students[0].id}/leave`);

    expect(
      (await http.call(token, 'GET', `${studentsUrl}?limit=100`)).json().students,
    ).toHaveLength(24);
    expect((await http.call(token, 'POST', studentsUrl, validStudent)).statusCode).toBe(201);
  });

  it('403 for a teacher', async () => {
    const { instituteId, studentsUrl, createStudent } = await setup();
    const student = await createStudent();
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    expect(
      (await http.call(teacher, 'POST', `${studentsUrl}/${student.id}/leave`)).statusCode,
    ).toBe(403);
  });
});

describe('POST /v1/institutes/:instituteId/students/bulk', () => {
  const rows = [
    { name: 'Aarav', guardianPhone: '9876543210' },
    { name: 'Ravi', guardianPhone: '98765' },
    { name: 'Chirag', guardianPhone: '+91 91234 56789', guardianName: 'Sunita' },
  ];

  it('200: creates the good rows, reports the bad ones by row number', async () => {
    const { token, studentsUrl } = await setup();

    const response = await http.call(token, 'POST', `${studentsUrl}/bulk`, {
      rows,
      joinedOn: '2026-10-01',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.created).toBe(2);
    expect(body.students.map((s: { name: string }) => s.name)).toEqual(['Aarav', 'Chirag']);
    expect(body.students[1]).toMatchObject({
      guardianPhone: '+919123456789',
      joinedOn: '2026-10-01',
    });
    expect(body.failed).toEqual([
      {
        row: 2,
        field: 'guardianPhone',
        message: expect.any(String),
        input: { name: 'Ravi', guardianPhone: '98765' },
      },
    ]);
    // ...and they really are stored.
    expect((await http.call(token, 'GET', studentsUrl)).json().students).toHaveLength(2);
  });

  it('402 when the good rows do not fit the plan; nothing is created', async () => {
    const { token, instituteId, studentsUrl, createStudent } = await setup();
    moveToFreePlan(instituteId);
    for (let i = 0; i < 24; i++) {
      await createStudent({ ...validStudent, name: `Student ${i}` });
    }

    const response = await http.call(token, 'POST', `${studentsUrl}/bulk`, { rows }); // 2 good rows, 1 slot

    expect(response.statusCode).toBe(402);
    expect(
      (await http.call(token, 'GET', `${studentsUrl}?limit=100`)).json().students,
    ).toHaveLength(24);
  });

  it('422 for an empty list or more than 500 rows', async () => {
    const { token, studentsUrl } = await setup();
    const row = { name: 'Aarav', guardianPhone: '9876543210' };
    expect((await http.call(token, 'POST', `${studentsUrl}/bulk`, { rows: [] })).statusCode).toBe(
      422,
    );
    expect(
      (await http.call(token, 'POST', `${studentsUrl}/bulk`, { rows: Array(501).fill(row) }))
        .statusCode,
    ).toBe(422);
  });

  it('500 rows in one request: all created on Academy (unlimited), 402 on the Pro trial (300)', async () => {
    const { token, instituteId, studentsUrl } = await setup();
    const many = Array.from({ length: 500 }, (_, i) => ({
      name: `Student ${i}`,
      guardianPhone: '9876543210',
    }));

    const onTrial = await http.call(token, 'POST', `${studentsUrl}/bulk`, { rows: many });
    testApp.subscriptionRepository.put({
      instituteId,
      plan: 'academy',
      status: 'active',
      currentPeriodEnd: new Date('2027-10-19T00:00:00Z'),
      graceUntil: null,
    });
    const onAcademy = await http.call(token, 'POST', `${studentsUrl}/bulk`, { rows: many });

    expect(onTrial.statusCode).toBe(402);
    expect(onTrial.json().error.details).toEqual({ limit: 300 });
    expect(onAcademy.json().created).toBe(500);
  });

  it('403 for a teacher, 404 for a non-member', async () => {
    const { instituteId, studentsUrl } = await setup();
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    const stranger = await loginOverHttp(app, OTHER_PHONE);
    expect((await http.call(teacher, 'POST', `${studentsUrl}/bulk`, { rows })).statusCode).toBe(
      403,
    );
    expect(
      (await http.call(stranger.accessToken, 'POST', `${studentsUrl}/bulk`, { rows })).statusCode,
    ).toBe(404);
  });
});

describe('students + batches (enrollments)', () => {
  async function withBatches() {
    const ctx = await setup();
    const newBatch = async (name: string) =>
      (
        await http.call(ctx.token, 'POST', `${ctx.url}/batches`, {
          name,
          schedule: { days: [1], start: '17:00', end: '18:00' },
          defaultFeePaise: 100000,
        })
      ).json().batch;
    return { ...ctx, maths: await newBatch('Maths'), science: await newBatch('Science') };
  }

  it('POST with batchIds: 201 with the student AND an enrollment per batch', async () => {
    const { token, studentsUrl, maths, science } = await withBatches();

    const response = await http.call(token, 'POST', studentsUrl, {
      ...validStudent,
      batchIds: [maths.id, science.id],
    });

    expect(response.statusCode).toBe(201);
    const { student, enrollments } = response.json();
    expect(enrollments.map((e: { batchId: string }) => e.batchId)).toEqual([maths.id, science.id]);
    expect(enrollments[0]).toMatchObject({
      studentId: student.id,
      feePaise: 100000,
      startDate: '2026-10-18',
    });
  });

  it('an unknown batch id: 404 and NO student is created', async () => {
    const { token, studentsUrl, maths } = await withBatches();

    const response = await http.call(token, 'POST', studentsUrl, {
      ...validStudent,
      batchIds: [maths.id, '00000000-0000-7000-8000-00000000ffff'],
    });

    expect(response.statusCode).toBe(404);
    expect((await http.call(token, 'GET', studentsUrl)).json().students).toEqual([]);
  });

  it('an archived batch: 409 and NO student is created', async () => {
    const { token, url, studentsUrl, maths } = await withBatches();
    await http.call(token, 'POST', `${url}/batches/${maths.id}/archive`);

    const response = await http.call(token, 'POST', studentsUrl, {
      ...validStudent,
      batchIds: [maths.id],
    });

    expect(response.statusCode).toBe(409);
    expect((await http.call(token, 'GET', studentsUrl)).json().students).toEqual([]);
  });

  it('without batchIds: enrollments is an empty list', async () => {
    const { token, studentsUrl } = await setup();
    expect((await http.call(token, 'POST', studentsUrl, validStudent)).json().enrollments).toEqual(
      [],
    );
  });

  it('?batchId= lists only the students in that batch today', async () => {
    const { token, studentsUrl, maths, science } = await withBatches();
    const add = (name: string, batchIds: string[]) =>
      http.call(token, 'POST', studentsUrl, {
        ...validStudent,
        name,
        joinedOn: '2026-10-01',
        batchIds,
      });
    await add('Aarav', [maths.id]);
    await add('Bhavya', [science.id]);
    await add('Chirag', [maths.id, science.id]);

    const inMaths = (await http.call(token, 'GET', `${studentsUrl}?batchId=${maths.id}`)).json();
    const unknown = (
      await http.call(token, 'GET', `${studentsUrl}?batchId=00000000-0000-7000-8000-00000000ffff`)
    ).json();

    expect(inMaths.students.map((s: { name: string }) => s.name)).toEqual(['Aarav', 'Chirag']);
    expect(unknown.students).toEqual([]);
  });
});
