import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

/** Two absent students -> two absence alerts in the outbox. */
async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const post = async (path: string, payload: unknown) =>
    (await http.call(owner.token, 'POST', `${owner.url}${path}`, payload)).json();
  const { batch } = await post('/batches', {
    name: 'Maths',
    schedule: { days: [1], start: '17:00', end: '18:00' },
  });
  const add = async (name: string, phone: string) =>
    (
      await post('/students', {
        name,
        guardianPhone: phone,
        joinedOn: '2026-10-01',
        batchIds: [batch.id],
      })
    ).student;
  const aarav = await add('Aarav', '9812345678');
  const bhavya = await add('Bhavya', '9123456789');
  await http.call(
    owner.token,
    'PUT',
    `${owner.url}/attendance-sessions/00000000-0000-7000-8000-00000000c001`,
    {
      batchId: batch.id,
      date: '2026-10-19',
      records: [
        { studentId: aarav.id, status: 'absent' },
        { studentId: bhavya.id, status: 'absent' },
      ],
    },
  );
  return owner;
}

describe('GET /v1/institutes/:instituteId/messages', () => {
  it('lists the outbox newest first, phones masked, paged with a cursor', async () => {
    const { token, url } = await setup();

    const first = (await http.call(token, 'GET', `${url}/messages?limit=1`)).json();
    const second = (
      await http.call(token, 'GET', `${url}/messages?limit=1&cursor=${first.nextCursor}`)
    ).json();

    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({
      category: 'absence',
      template: 'absence_alert',
      status: 'queued',
    });
    expect(first.messages[0].to).toMatch(/^\+91\d{2}X{5}\d{3}$/);
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].id).not.toBe(first.messages[0].id);
    expect(second.nextCursor).toBeNull();
  });

  it('filters by category / status; 422 for a bad cursor; a teacher gets 403', async () => {
    const { token, url, instituteId } = await setup();
    const teacher = await http.memberWithRole(instituteId, 'teacher');

    expect(
      (await http.call(token, 'GET', `${url}/messages?category=fee_reminder`)).json().messages,
    ).toEqual([]);
    expect(
      (await http.call(token, 'GET', `${url}/messages?status=queued`)).json().messages,
    ).toHaveLength(2);
    expect((await http.call(token, 'GET', `${url}/messages?cursor=junk`)).statusCode).toBe(422);
    expect((await http.call(teacher, 'GET', `${url}/messages`)).statusCode).toBe(403);
  });
});
