import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PhoneNumber } from '@coachingdesk/shared';
import { tenantHttp } from '../../../test/tenant-http';
import { buildTestApp } from '../../../test/test-app';

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
  return http.ownerWithInstitute();
}

const guardian = PhoneNumber.parse('9812345678');

describe('POST /v1/institutes/:instituteId/guardians/:phone/opt-in | opt-out', () => {
  it('204 and the consent is recorded (the phone may be URL-encoded E.164)', async () => {
    const { token, url, instituteId } = await setup();
    const consentOf = () => testApp.consentRepository.consentOf(instituteId, guardian);

    expect(await consentOf()).toBe('unknown');
    const optIn = await http.call(token, 'POST', `${url}/guardians/%2B919812345678/opt-in`, {
      source: 'verbal',
    });
    expect(optIn.statusCode).toBe(204);
    expect(await consentOf()).toBe('opted_in');

    await http.call(token, 'POST', `${url}/guardians/9812345678/opt-out`, { source: 'verbal' });
    expect(await consentOf()).toBe('opted_out');
  });

  it('422 for a bad phone or source; 403 for a teacher', async () => {
    const { token, url, instituteId } = await setup();
    const teacher = await http.memberWithRole(instituteId, 'teacher');
    expect(
      (await http.call(token, 'POST', `${url}/guardians/12345/opt-in`, { source: 'verbal' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await http.call(token, 'POST', `${url}/guardians/9812345678/opt-in`, { source: 'sms' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await http.call(teacher, 'POST', `${url}/guardians/9812345678/opt-in`, { source: 'verbal' }))
        .statusCode,
    ).toBe(403);
  });
});

describe('guardianConsent when adding students', () => {
  it('create with guardianConsent: true opts the guardian in; without it, nothing changes', async () => {
    const { token, url, instituteId } = await setup();
    await http.call(token, 'POST', `${url}/students`, {
      name: 'Aarav',
      guardianPhone: '9812345678',
      guardianConsent: true,
    });
    await http.call(token, 'POST', `${url}/students`, {
      name: 'Ravi',
      guardianPhone: '9123456789',
    });

    expect(await testApp.consentRepository.consentOf(instituteId, guardian)).toBe('opted_in');
    expect(
      await testApp.consentRepository.consentOf(instituteId, PhoneNumber.parse('9123456789')),
    ).toBe('unknown');
  });

  it('bulk with guardianConsent: true opts in every created row (not the failed ones)', async () => {
    const { token, url, instituteId } = await setup();
    await http.call(token, 'POST', `${url}/students/bulk`, {
      guardianConsent: true,
      rows: [
        { name: 'Aarav', guardianPhone: '9812345678' },
        { name: 'Ravi', guardianPhone: '98765' },
      ],
    });
    expect(await testApp.consentRepository.consentOf(instituteId, guardian)).toBe('opted_in');
  });
});
