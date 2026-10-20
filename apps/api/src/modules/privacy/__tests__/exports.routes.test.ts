import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OTHER_PHONE, tenantHttp } from '../../../test/tenant-http';
import { buildTestApp, TEST_OTP } from '../../../test/test-app';
import { ExportProcessor } from '../export-processor';
import { unzipNames } from './zip-reader';

let app: FastifyInstance;
let http: ReturnType<typeof tenantHttp>;

afterEach(async () => {
  await app.close();
});

async function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  http = tenantHttp(testApp);
  const owner = await http.ownerWithInstitute();
  const teacher = await http.memberWithRole(owner.instituteId, 'teacher');
  // What the worker does, with a stand-in for the Postgres data source.
  const worker = new ExportProcessor({
    exports: testApp.dataExportRepository,
    files: testApp.fileStore,
    clock: testApp.clock,
    source: {
      exportTables: async () => [{ file: 'students.csv', header: ['name'], rows: [['Aarav']] }],
    },
  });
  return { ...owner, testApp, teacher, worker, exports: `${owner.url}/exports` };
}

describe('data export', () => {
  it('request (202) -> worker builds it -> owner downloads the ZIP', async () => {
    const { token, exports, worker } = await setup();

    const requested = await http.call(token, 'POST', exports);
    expect(requested.statusCode).toBe(202);
    const created = requested.json().export;
    expect(created).toMatchObject({ status: 'queued', downloadPath: null });

    const early = await http.call(token, 'GET', `${exports}/${created.id}/download`);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.details).toEqual({ status: 'queued' });

    await worker.runOnce();
    const ready = (await http.call(token, 'GET', `${exports}/${created.id}`)).json().export;
    expect(ready).toMatchObject({
      status: 'ready',
      expiresAt: '2026-10-26T10:00:00.000Z',
      downloadPath: `${exports}/${created.id}/download`,
    });

    const download = await http.call(token, 'GET', ready.downloadPath);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    expect(download.headers['content-disposition']).toBe(
      'attachment; filename="coachingdesk-export-2026-10-19.zip"',
    );
    expect(download.headers['cache-control']).toBe('no-store');
    expect(unzipNames(download.rawPayload).get('students.csv')).toBe('﻿name\r\nAarav\r\n');
  });

  it('a second tap returns the export in progress (200, same id); list shows it', async () => {
    const { token, exports } = await setup();
    const first = (await http.call(token, 'POST', exports)).json().export;
    const second = await http.call(token, 'POST', exports);
    expect(second.statusCode).toBe(200);
    expect(second.json().export.id).toBe(first.id);
    expect(
      (await http.call(token, 'GET', exports)).json().exports.map((e: { id: string }) => e.id),
    ).toEqual([first.id]);
  });

  it('at most 5 a day (429)', async () => {
    const { token, exports, worker } = await setup();
    for (let i = 0; i < 5; i++) {
      expect((await http.call(token, 'POST', exports)).statusCode).toBe(202);
      await worker.runOnce();
    }
    const sixth = await http.call(token, 'POST', exports);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
      details: { limit: 5 },
    });
  });

  it('owner only (teacher 403); another institute 404; unknown export 404', async () => {
    const { teacher, token, exports, url } = await setup();
    expect((await http.call(teacher, 'POST', exports)).statusCode).toBe(403);
    expect((await http.call(teacher, 'GET', exports)).statusCode).toBe(403);
    const created = (await http.call(token, 'POST', exports)).json().export;

    const other = await http.ownerWithInstitute(OTHER_PHONE);
    expect((await http.call(other.token, 'GET', `${url}/exports/${created.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (await http.call(other.token, 'GET', `${other.url}/exports/${created.id}`)).statusCode,
    ).toBe(404);
    expect(
      (await http.call(token, 'GET', `${exports}/00000000-0000-7000-8000-00000000ffff`)).statusCode,
    ).toBe(404);
  });

  it('pending deletion: the owner can still export and download (take the data first)', async () => {
    const { token, url, exports, worker } = await setup();
    await http.call(token, 'POST', `${url}/delete/otp`);
    await http.call(token, 'POST', `${url}/delete`, { otp: TEST_OTP });

    const requested = await http.call(token, 'POST', exports);
    expect(requested.statusCode).toBe(202);
    await worker.runOnce();
    const download = await http.call(
      token,
      'GET',
      `${exports}/${requested.json().export.id}/download`,
    );
    expect(download.statusCode).toBe(200);
  });
});
