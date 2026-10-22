import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  return testApp;
}

describe('GET /v1/plans (public)', () => {
  it('lists the 4 plans with limits and prices, and the trial', async () => {
    setup();
    const response = await app.inject({ method: 'GET', url: '/v1/plans' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.plans.map((p: { id: string }) => p.id)).toEqual([
      'free',
      'starter',
      'pro',
      'academy',
    ]);
    expect(body.plans[1]).toEqual({
      id: 'starter',
      maxActiveStudents: 100,
      maxMembers: 1,
      monthlyMessages: 500,
      monthlyPricePaise: 19900,
      yearlyPricePaise: 199900,
      features: ['automatic_messages'],
    });
    expect(body.trial).toEqual({ plan: 'pro', days: 30, messageTotal: 200 });
  });
});

describe('GET /v1/institutes/:instituteId/subscription (owner)', () => {
  it('trial: Pro limits, status, end date, and usage', async () => {
    setup();
    const owner = await http.ownerWithInstitute();
    await http.call(owner.token, 'POST', `${owner.url}/students`, {
      name: 'Aarav',
      guardianPhone: '9812345678',
    });
    await http.memberWithRole(owner.instituteId, 'teacher');

    const response = await http.call(owner.token, 'GET', `${owner.url}/subscription`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      plan: 'pro',
      status: 'trialing',
      currentPeriodEnd: '2026-11-18T10:00:00.000Z',
      limits: { maxActiveStudents: 300, maxMembers: 5, monthlyMessages: 1500 },
      usage: { activeStudents: 1, members: 1, messages: { used: 0, todayLimit: 100 } },
    });
  });

  it('staff and teachers get 403', async () => {
    setup();
    const owner = await http.ownerWithInstitute();
    const staff = await http.memberWithRole(owner.instituteId, 'staff');
    expect((await http.call(staff, 'GET', `${owner.url}/subscription`)).statusCode).toBe(403);
  });
});

describe('GET /v1/institutes/:instituteId includes entitlements', () => {
  it('a teacher sees the plan and features (the app hides what the plan lacks)', async () => {
    setup();
    const owner = await http.ownerWithInstitute();
    const teacher = await http.memberWithRole(owner.instituteId, 'teacher');

    const response = await http.call(teacher, 'GET', owner.url);

    expect(response.json()).toMatchObject({
      role: 'teacher',
      entitlements: {
        plan: 'pro',
        maxActiveStudents: 300,
        features: ['automatic_messages', 'result_cards'],
      },
      institute: { settings: { absenceAlerts: true } },
    });
  });
});
