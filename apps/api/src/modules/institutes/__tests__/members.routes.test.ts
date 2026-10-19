import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MEMBER_PHONE, OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp, loginOverHttp } from '../../../test/test-app';

let app: FastifyInstance;
let testApp: ReturnType<typeof buildTestApp>;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

async function setup() {
  testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const membersUrl = `${owner.url}/members`;
  const add = (payload: unknown, token: string | undefined = owner.token) =>
    http.call(token, 'POST', membersUrl, payload);
  return { ...owner, membersUrl, add };
}

const teacher = { phone: '99887 76655', name: 'Sunita Verma', role: 'teacher' };

describe('POST /v1/institutes/:instituteId/members', () => {
  it('201: adds by phone; the new member gets access on their first login', async () => {
    const { add, url } = await setup();

    const response = await add(teacher);

    expect(response.statusCode).toBe(201);
    expect(response.json().member).toEqual({
      userId: expect.any(String),
      name: 'Sunita Verma',
      phone: '+919988776655',
      role: 'teacher',
    });
    const sunita = await loginOverHttp(app, MEMBER_PHONE);
    const view = await http.call(sunita.accessToken, 'GET', url);
    expect(view.statusCode).toBe(200);
    expect(view.json().role).toBe('teacher');
  });

  it("keeps a person's own name if they already set one", async () => {
    const { add } = await setup();
    const existing = await loginOverHttp(app, MEMBER_PHONE);
    await http.call(existing.accessToken, 'PATCH', '/v1/me', { name: 'Sunita V.' });

    const response = await add(teacher);

    expect(response.json().member.name).toBe('Sunita V.');
  });

  it('409 for someone who is already a member (including the owner)', async () => {
    const { add } = await setup();
    await add(teacher);
    expect((await add({ ...teacher, role: 'staff' })).statusCode).toBe(409);
    expect((await add({ ...teacher, phone: '9876543210' })).statusCode).toBe(409);
  });

  it('402 on Free (no members besides the owner); fine during the Pro trial', async () => {
    const { add, instituteId } = await setup();
    expect((await add(teacher)).statusCode).toBe(201);

    testApp.subscriptionRepository.put({
      instituteId,
      plan: 'free',
      status: 'free',
      currentPeriodEnd: null,
      graceUntil: null,
    });
    const response = await add({ ...teacher, phone: '9000000099' });

    expect(response.statusCode).toBe(402);
    expect(response.json().error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      message: 'Member limit reached for your plan',
      details: { limit: 0 },
    });
  });

  it.each([
    ['role owner (there is exactly one)', { ...teacher, role: 'owner' }],
    ['an invalid phone', { ...teacher, phone: '12345' }],
    ['an empty name (entity rule)', { ...teacher, name: '   ' }],
  ])('422 for %s', async (_label, payload) => {
    const { add } = await setup();
    expect((await add(payload)).statusCode).toBe(422);
  });

  it('owner only: 403 for a teacher or staff, 404 for a non-member, 401 without a token', async () => {
    const { add, instituteId, membersUrl } = await setup();
    const staff = await http.memberWithRole(instituteId, 'staff', '9000000099');
    const stranger = await loginOverHttp(app, OTHER_PHONE);

    expect((await add(teacher, staff)).statusCode).toBe(403);
    expect((await add(teacher, stranger.accessToken)).statusCode).toBe(404);
    expect((await http.call(undefined, 'POST', membersUrl, teacher)).statusCode).toBe(401);
  });
});

describe('GET /v1/institutes/:instituteId/members', () => {
  it('lists the team, owner first', async () => {
    const { token, membersUrl, add } = await setup();
    await add(teacher);

    const response = await http.call(token, 'GET', membersUrl);

    expect(
      response.json().members.map((m: { role: string; phone: string }) => [m.role, m.phone]),
    ).toEqual([
      ['owner', '+919876543210'],
      ['teacher', '+919988776655'],
    ]);
  });

  it('403 for a teacher', async () => {
    const { membersUrl, instituteId } = await setup();
    const teacherToken = await http.memberWithRole(instituteId, 'teacher');
    expect((await http.call(teacherToken, 'GET', membersUrl)).statusCode).toBe(403);
  });
});

describe('DELETE /v1/institutes/:instituteId/members/:userId', () => {
  it('204, and the removed member loses access (404)', async () => {
    const { token, url, membersUrl, add } = await setup();
    const { member } = (await add(teacher)).json();
    const sunita = await loginOverHttp(app, MEMBER_PHONE);

    const response = await http.call(token, 'DELETE', `${membersUrl}/${member.userId}`);

    expect(response.statusCode).toBe(204);
    expect((await http.call(sunita.accessToken, 'GET', url)).statusCode).toBe(404);
  });

  it('409 for the owner; 404 for someone who is not a member or a bad id', async () => {
    const { token, membersUrl } = await setup();
    const owner = (await http.call(token, 'GET', membersUrl)).json().members[0];
    const stranger = await loginOverHttp(app, OTHER_PHONE);

    expect((await http.call(token, 'DELETE', `${membersUrl}/${owner.userId}`)).statusCode).toBe(
      409,
    );
    expect((await http.call(token, 'DELETE', `${membersUrl}/${stranger.user.id}`)).statusCode).toBe(
      404,
    );
    expect((await http.call(token, 'DELETE', `${membersUrl}/abc`)).statusCode).toBe(404);
  });
});
