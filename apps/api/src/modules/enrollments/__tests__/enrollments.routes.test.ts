import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

/** An institute with one student and one batch (Rs 1,500 monthly), created over HTTP. */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const post = async (path: string, payload: unknown) =>
    (await http.call(owner.token, 'POST', `${owner.url}${path}`, payload)).json();

  const { student } = await post('/students', { name: 'Aarav', guardianPhone: '9876543210' });
  const { batch } = await post('/batches', {
    name: 'Class 10 Maths',
    schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
    defaultFeePaise: 150000,
    defaultFeeCycle: 'monthly',
  });
  const enrollUrl = `${owner.url}/enrollments`;
  const enroll = (payload: Record<string, unknown> = {}, token = owner.token) =>
    http.call(token, 'POST', enrollUrl, { studentId: student.id, batchId: batch.id, ...payload });
  return { ...owner, student, batch, enrollUrl, enroll };
}

describe('POST /v1/institutes/:instituteId/enrollments', () => {
  it("201 with the batch's fee and cycle, starting today at the institute", async () => {
    const { enroll, student, batch } = await setup();

    const response = await enroll();

    expect(response.statusCode).toBe(201);
    expect(response.json().enrollment).toEqual({
      id: expect.any(String),
      studentId: student.id,
      batchId: batch.id,
      feePaise: 150000,
      discountPaise: 0,
      netFeePaise: 150000,
      feeCycle: 'monthly',
      startDate: '2026-10-19',
      endDate: null,
    });
  });

  it('per-student terms override the defaults', async () => {
    const { enroll } = await setup();
    const response = await enroll({ discountPaise: 30000, feeCycle: 'quarterly' });
    expect(response.json().enrollment).toMatchObject({
      netFeePaise: 120000,
      feeCycle: 'quarterly',
    });
  });

  it('409 the second time', async () => {
    const { enroll } = await setup();
    await enroll();
    const again = await enroll();
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CONFLICT');
  });

  it('401 without a token; 403 for a teacher; 201 for staff', async () => {
    const { instituteId, enroll, enrollUrl, student, batch } = await setup();
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');
    const body = { studentId: student.id, batchId: batch.id };

    expect((await http.call(undefined, 'POST', enrollUrl, body)).statusCode).toBe(401);
    expect((await enroll({}, teacher)).statusCode).toBe(403);
    expect((await enroll({}, staff)).statusCode).toBe(201);
  });

  it("TENANCY: 404 for another institute's student or batch", async () => {
    const { student, batch } = await setup();
    const ravi = await http.ownerWithInstitute(OTHER_PHONE);
    const url = `${ravi.url}/enrollments`;
    const raviStudent = (
      await http.call(ravi.token, 'POST', `${ravi.url}/students`, {
        name: 'Ravi Jr',
        guardianPhone: '9123456789',
      })
    ).json().student;

    // Neha's batch with Ravi's student, through Ravi's institute: the batch lookup stops it.
    const crossBatch = await http.call(ravi.token, 'POST', url, {
      studentId: raviStudent.id,
      batchId: batch.id,
    });
    // Neha's student entirely.
    const crossStudent = await http.call(ravi.token, 'POST', url, {
      studentId: student.id,
      batchId: batch.id,
    });

    expect(crossBatch.statusCode).toBe(404);
    expect(crossStudent.statusCode).toBe(404);
  });

  it.each([
    ['billNow (arrives with billing)', { billNow: true }],
    ['a discount above the fee (entity rule)', { discountPaise: 150001 }],
    ['a non-UUID student id', { studentId: 'abc' }],
  ])('422 for %s', async (_label, payload) => {
    const { enroll } = await setup();
    expect((await enroll(payload)).statusCode).toBe(422);
  });
});

describe('PATCH /v1/institutes/:instituteId/enrollments/:enrollmentId', () => {
  it('200: new terms and an end date', async () => {
    const { token, enroll, enrollUrl } = await setup();
    const { enrollment } = (await enroll()).json();

    const response = await http.call(token, 'PATCH', `${enrollUrl}/${enrollment.id}`, {
      discountPaise: 50000,
      endDate: '2027-03-31',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().enrollment).toMatchObject({
      netFeePaise: 100000,
      endDate: '2027-03-31',
    });
  });

  it('422 for an empty body or an end before the start; 404 for a bad id', async () => {
    const { token, enroll, enrollUrl } = await setup();
    const { enrollment } = (await enroll()).json();
    const url = `${enrollUrl}/${enrollment.id}`;

    expect((await http.call(token, 'PATCH', url, {})).statusCode).toBe(422);
    expect((await http.call(token, 'PATCH', url, { endDate: '2026-01-01' })).statusCode).toBe(422);
    expect(
      (await http.call(token, 'PATCH', `${enrollUrl}/abc`, { discountPaise: 0 })).statusCode,
    ).toBe(404);
  });

  it("404 for another institute's enrollment", async () => {
    const { enroll } = await setup();
    const { enrollment } = (await enroll()).json();
    const ravi = await http.ownerWithInstitute(OTHER_PHONE);
    const response = await http.call(
      ravi.token,
      'PATCH',
      `${ravi.url}/enrollments/${enrollment.id}`,
      {
        discountPaise: 150000,
      },
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('enrollments on the student and batch screens', () => {
  it("GET student lists the student's enrollments", async () => {
    const { token, url, student, enroll } = await setup();
    const { enrollment } = (await enroll()).json();

    const response = await http.call(token, 'GET', `${url}/students/${student.id}`);

    expect(response.json().enrollments).toEqual([enrollment]);
  });

  it('GET batch shows how many students are enrolled today', async () => {
    const { token, url, batch, enroll } = await setup();
    expect((await http.call(token, 'GET', `${url}/batches/${batch.id}`)).json().enrolledCount).toBe(
      0,
    );

    await enroll();

    expect((await http.call(token, 'GET', `${url}/batches/${batch.id}`)).json().enrolledCount).toBe(
      1,
    );
  });

  it('FR-1.4: a teacher sees enrollments and batches WITHOUT any fee', async () => {
    const { instituteId, url, student, batch, enroll } = await setup();
    await enroll();
    const teacher = await http.memberWithRole(instituteId, 'teacher');

    const studentView = (await http.call(teacher, 'GET', `${url}/students/${student.id}`)).json();
    const batchView = (await http.call(teacher, 'GET', `${url}/batches/${batch.id}`)).json();
    const batchList = (await http.call(teacher, 'GET', `${url}/batches`)).json();

    expect(studentView.enrollments[0]).toEqual({
      id: expect.any(String),
      studentId: student.id,
      batchId: batch.id,
      startDate: '2026-10-19',
      endDate: null,
    });
    expect(batchView.batch).not.toHaveProperty('defaultFeePaise');
    expect(batchView.enrolledCount).toBe(1);
    expect(batchList.batches[0]).not.toHaveProperty('defaultFeePaise');
  });
});
