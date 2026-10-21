import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PhoneNumber } from '@coachingdesk/shared';
import { tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

const NEHA = '9812345678';

async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const call = (method: 'POST' | 'GET', path: string, payload?: unknown) =>
    http.call(owner.token, method, `${owner.url}${path}`, payload);
  const addStudent = async (name: string) =>
    (await call('POST', '/students', { name, guardianPhone: NEHA, guardianConsent: true })).json()
      .student;
  const payFor = async (studentId: string) => {
    const { invoice } = (
      await call('POST', '/invoices', {
        studentId,
        amountPaise: 50000,
        dueDate: '2026-10-25',
        description: 'Fee',
      })
    ).json();
    const { payment } = (
      await call('POST', `/invoices/${invoice.id}/payments`, { amountPaise: 20000, method: 'cash' })
    ).json();
    return { invoice, payment };
  };
  const erase = (studentId: string, payload: unknown = { confirm: true }, token = owner.token) =>
    http.call(token, 'POST', `${owner.url}/students/${studentId}/erase`, payload);
  return { ...owner, testApp, call, addStudent, payFor, erase };
}

describe('POST /students/:studentId/erase', () => {
  it("only child: the student's and guardian's personal data are gone; amounts stay", async () => {
    const { testApp, instituteId, call, addStudent, payFor, erase } = await setup();
    const aarav = await addStudent('Aarav');
    const { invoice, payment } = await payFor(aarav.id);

    const response = await erase(aarav.id);

    expect(response.statusCode).toBe(200);
    expect(response.json().student).toMatchObject({
      name: 'Erased student',
      guardianName: null,
      guardianPhone: null,
      status: 'left',
    });
    const paid = (await call('GET', `/payments/${payment.id}`)).json();
    expect(paid.payment).toMatchObject({ guardianPhone: null, amountPaise: 20000 });
    const bill = (await call('GET', `/invoices/${invoice.id}`)).json().invoice;
    expect(bill).toMatchObject({ paidPaise: 20000, remainingPaise: 30000 });
    expect(await testApp.consentRepository.consentOf(instituteId, PhoneNumber.parse(NEHA))).toBe(
      'unknown',
    );
    const log = (await call('GET', '/audit-log')).json().entries;
    expect(log[0]).toMatchObject({
      action: 'student.erase',
      after: { erased: true, guardianForgotten: true },
    });
  });

  it("a sibling still has the guardian: the guardian's phone and consent stay", async () => {
    const { testApp, instituteId, call, addStudent, payFor, erase } = await setup();
    const aarav = await addStudent('Aarav');
    const bhavya = await addStudent('Bhavya');
    const { payment } = await payFor(aarav.id);

    await erase(aarav.id);

    expect((await call('GET', `/students/${bhavya.id}`)).json().student.guardianPhone).toBe(
      '+919812345678',
    );
    expect((await call('GET', `/payments/${payment.id}`)).json().payment.guardianPhone).toBe(
      '+919812345678',
    );
    expect(await testApp.consentRepository.consentOf(instituteId, PhoneNumber.parse(NEHA))).toBe(
      'opted_in',
    );
  });

  it("the student's own number: cleared, and its consent forgotten", async () => {
    const { call, erase, testApp, instituteId } = await setup();
    const { student } = (
      await call('POST', '/students', {
        name: 'Aarav',
        guardianPhone: NEHA,
        studentPhone: '9123456789',
        studentConsent: true,
      })
    ).json();
    const own = PhoneNumber.parse('9123456789');
    expect(await testApp.consentRepository.consentOf(instituteId, own)).toBe('opted_in');

    const erased = await erase(student.id);
    expect(erased.json().student.studentPhone).toBeNull();
    expect(await testApp.consentRepository.consentOf(instituteId, own)).toBe('unknown');
  });

  it('needs { confirm: true }; owner only; repeating it is harmless', async () => {
    const { instituteId, addStudent, erase } = await setup();
    const aarav = await addStudent('Aarav');
    const staff = await http.memberWithRole(instituteId, 'staff');

    expect((await erase(aarav.id, {})).statusCode).toBe(422);
    expect((await erase(aarav.id, { confirm: true }, staff)).statusCode).toBe(403);
    expect((await erase(aarav.id)).statusCode).toBe(200);
    expect((await erase(aarav.id)).statusCode).toBe(200);
  });

  it('an erased student can no longer be edited (409)', async () => {
    const { token, url, addStudent, erase } = await setup();
    const aarav = await addStudent('Aarav');
    await erase(aarav.id);
    const edit = await http.call(token, 'PATCH', `${url}/students/${aarav.id}`, {
      name: 'Back again',
    });
    expect(edit.statusCode).toBe(409);
  });
});
