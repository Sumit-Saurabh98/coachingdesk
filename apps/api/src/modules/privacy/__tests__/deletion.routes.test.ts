import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp, TEST_OTP } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

/** An owner with a batch and a teacher; the clock says 2026-10-19T10:00Z. */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const teacher = await http.memberWithRole(owner.instituteId, 'teacher');
  const deleteWithCode = async (otp = TEST_OTP) => {
    await http.call(owner.token, 'POST', `${owner.url}/delete/otp`);
    return http.call(owner.token, 'POST', `${owner.url}/delete`, { otp });
  };
  return { ...owner, testApp, teacher, deleteWithCode };
}

describe('institute deletion', () => {
  it('a fresh code to the OWNER phone, then delete: purge date 30 days later', async () => {
    const { token, url, testApp, deleteWithCode } = await setup();

    const response = await deleteWithCode();

    expect(response.statusCode).toBe(200);
    expect(response.json().institute.deletion).toEqual({
      requestedAt: '2026-10-19T10:00:00.000Z',
      purgeAfter: '2026-11-18T10:00:00.000Z',
    });
    // The deletion code went to the owner's own phone (the last SMS sent).
    expect(testApp.sms.sent.at(-1)?.to.toE164()).toBe('+919876543210');
    const audit = (await http.call(token, 'GET', `${url}/audit-log`)).json().entries;
    expect(audit[0]).toMatchObject({ action: 'institute.delete_requested' });
  });

  it('a wrong code changes nothing (400); no code requested -> 400 expired', async () => {
    const { token, url, deleteWithCode } = await setup();

    const wrong = await deleteWithCode('000000');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('OTP_INVALID');
    expect((await http.call(token, 'GET', url)).json().institute.deletion).toBeNull();

    // A wrong guess doesn't use up the code: the right one still works. Once used, it's gone.
    await http.call(token, 'POST', `${url}/delete`, { otp: TEST_OTP });
    await http.call(token, 'POST', `${url}/delete/cancel`);
    const noCode = await http.call(token, 'POST', `${url}/delete`, { otp: TEST_OTP });
    expect(noCode.statusCode).toBe(400);
    expect(noCode.json().error.code).toBe('OTP_EXPIRED');
  });

  it('owner only: teacher 403; not logged in 401; malformed code 422', async () => {
    const { teacher, url, token } = await setup();
    expect((await http.call(teacher, 'POST', `${url}/delete/otp`)).statusCode).toBe(403);
    expect((await http.call(teacher, 'POST', `${url}/delete`, { otp: TEST_OTP })).statusCode).toBe(
      403,
    );
    expect(
      (await http.call(undefined, 'POST', `${url}/delete`, { otp: TEST_OTP })).statusCode,
    ).toBe(401);
    expect((await http.call(token, 'POST', `${url}/delete`, { otp: '12ab' })).statusCode).toBe(422);
  });

  it("another institute's owner gets 404", async () => {
    const { url } = await setup();
    const other = await http.ownerWithInstitute(OTHER_PHONE);
    expect((await http.call(other.token, 'POST', `${url}/delete/otp`)).statusCode).toBe(404);
    expect((await http.call(other.token, 'POST', `${url}/delete/cancel`)).statusCode).toBe(404);
  });

  it('while pending: teachers lose access (404); the owner reads but cannot change (409)', async () => {
    const { token, teacher, url, deleteWithCode } = await setup();
    await deleteWithCode();

    expect((await http.call(teacher, 'GET', `${url}/batches`)).statusCode).toBe(404);
    expect((await http.call(teacher, 'GET', '/v1/me')).json().institutes).toEqual([]);

    expect((await http.call(token, 'GET', `${url}/batches`)).statusCode).toBe(200);
    expect((await http.call(token, 'GET', '/v1/me')).json().institutes).toHaveLength(1);
    const write = await http.call(token, 'POST', `${url}/batches`, {
      name: 'Maths',
      schedule: { days: [1], start: '17:00', end: '18:00' },
    });
    expect(write.statusCode).toBe(409);
    expect(write.json().error.code).toBe('INSTITUTE_PENDING_DELETION');
    // Asking again is a write too: 409, the 30 days don't restart.
    expect((await deleteWithCode()).statusCode).toBe(409);
  });

  it('cancel: back to normal (teachers too); cancelling twice is a 409', async () => {
    const { token, teacher, url, deleteWithCode } = await setup();
    await deleteWithCode();

    const cancelled = await http.call(token, 'POST', `${url}/delete/cancel`);

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().institute.deletion).toBeNull();
    expect((await http.call(teacher, 'GET', `${url}/batches`)).statusCode).toBe(200);
    const again = await http.call(token, 'POST', `${url}/delete/cancel`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CONFLICT');
    const actions = (await http.call(token, 'GET', `${url}/audit-log`))
      .json()
      .entries.map((e: { action: string }) => e.action);
    expect(actions.slice(0, 2)).toEqual([
      'institute.delete_cancelled',
      'institute.delete_requested',
    ]);
  });
});
