import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

describe('GET /v1/institutes/:instituteId/audit-log', () => {
  it('records voids, waivers, team and settings changes, with no personal data', async () => {
    const testApp = buildTestApp();
    app = testApp.app;
    http = tenantHttp(testApp);
    const owner = await http.ownerWithInstitute();
    const call = (method: 'POST' | 'PATCH', path: string, payload: unknown) =>
      http.call(owner.token, method, `${owner.url}${path}`, payload);
    const { student } = (
      await call('POST', '/students', { name: 'Aarav', guardianPhone: '9812345678' })
    ).json();
    const bill = async () =>
      (
        await call('POST', '/invoices', {
          studentId: student.id,
          amountPaise: 50000,
          dueDate: '2026-10-25',
          description: 'Exam fee',
        })
      ).json().invoice;
    const first = await bill();
    const second = await bill();
    const { payment } = (
      await call('POST', `/invoices/${first.id}/payments`, { amountPaise: 50000, method: 'cash' })
    ).json();
    await call('POST', `/payments/${payment.id}/void`, { reason: 'Wrong student' });
    await call('POST', `/invoices/${second.id}/waive`, { reason: 'Scholarship' });
    await call('POST', '/members', { phone: '9988776655', name: 'Sunita', role: 'teacher' });
    await call('PATCH', '', { settings: { absenceAlerts: false } });

    const response = await http.call(owner.token, 'GET', `${owner.url}/audit-log`);

    expect(response.statusCode).toBe(200);
    const entries = response.json().entries;
    expect(entries.map((e: { action: string }) => e.action)).toEqual([
      'institute.settings',
      'member.add',
      'invoice.waive',
      'payment.void',
    ]);
    expect(entries[3]).toMatchObject({
      entityId: payment.id,
      before: { status: 'active', amountPaise: 50000 },
      after: { status: 'voided' },
    });
    // No guardian phone, student name or reason text anywhere in the log.
    const text = JSON.stringify(entries);
    expect(text).not.toContain('9812345678');
    expect(text).not.toContain('Aarav');
  });

  it('owner only: staff get 403', async () => {
    const testApp = buildTestApp();
    app = testApp.app;
    http = tenantHttp(testApp);
    const owner = await http.ownerWithInstitute();
    const staff = await http.memberWithRole(owner.instituteId, 'staff');
    expect((await http.call(staff, 'GET', `${owner.url}/audit-log`)).statusCode).toBe(403);
  });
});
