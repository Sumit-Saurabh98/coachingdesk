import { describe, expect, it } from 'vitest';
import { InMemoryFileStore } from '@coachingdesk/providers';
import { FixedClock } from '@coachingdesk/shared';
import { InMemoryDataExportRepository } from '../data-export.repository';
import { ExportProcessor } from '../export-processor';
import type { ExportTable, TenantDataSource } from '../tenant-data';
import { unzipNames } from './zip-reader';

const INSTITUTE = 'inst-1';

function setup(source?: TenantDataSource) {
  const clock = new FixedClock(new Date('2026-10-20T10:00:00Z'));
  const exports = new InMemoryDataExportRepository();
  const files = new InMemoryFileStore();
  let calls = 0;
  const tables: ExportTable[] = [
    {
      file: 'students.csv',
      header: ['id', 'name'],
      rows: [
        ['s1', 'Aarav'],
        ['s2', '=cmd'],
      ],
    },
    { file: 'batches.csv', header: ['id'], rows: [] },
  ];
  const processor = new ExportProcessor(
    {
      exports,
      files,
      clock,
      source: source ?? {
        exportTables: async (instituteId) => {
          calls += 1;
          expect(instituteId).toBe(INSTITUTE);
          return tables;
        },
      },
    },
    { maxAttempts: 2 },
  );
  const queue = (id = 'e1') =>
    exports.createQueued({ id, instituteId: INSTITUTE, requestedBy: 'u1', createdAt: clock.now() });
  return { clock, exports, files, processor, queue, calls: () => calls };
}

describe('ExportProcessor', () => {
  it('builds the ZIP (README + one CSV per table), stores it, marks it ready for 7 days', async () => {
    const { processor, queue, exports, files } = setup();
    await queue();

    expect(await processor.runOnce()).toEqual({ built: 1, retried: 0, failed: 0, expired: 0 });

    const ready = await exports.findById(INSTITUTE, 'e1');
    expect(ready).toMatchObject({
      status: 'ready',
      fileKey: 'exports/inst-1/e1.zip',
      expiresAt: new Date('2026-10-27T10:00:00Z'),
    });
    const zip = await files.get('exports/inst-1/e1.zip');
    expect(zip?.length).toBe(ready?.byteSize);
    const content = unzipNames(zip ?? new Uint8Array());
    expect([...content.keys()]).toEqual(['README.txt', 'students.csv', 'batches.csv']);
    expect(content.get('students.csv')).toBe("﻿id,name\r\ns1,Aarav\r\ns2,'=cmd\r\n");
    expect(content.get('README.txt')).toContain('- students.csv: 2 rows');
  });

  it('nothing queued: nothing built', async () => {
    const { processor, calls } = setup();
    expect(await processor.runOnce()).toEqual({ built: 0, retried: 0, failed: 0, expired: 0 });
    expect(calls()).toBe(0);
  });

  it('an error is retried, then fails after maxAttempts; the error text is a code only', async () => {
    const { processor, queue, exports } = setup({
      exportTables: async () => {
        throw new Error('row value: +919876543210');
      },
    });
    await queue();

    expect((await processor.runOnce()).retried).toBe(1);
    expect(await exports.findById(INSTITUTE, 'e1')).toMatchObject({
      status: 'queued',
      error: 'build_failed',
    });
    expect((await processor.runOnce()).failed).toBe(1);
    expect((await exports.findById(INSTITUTE, 'e1'))?.status).toBe('failed');
  });

  it('after 7 days the file is deleted and the export is expired', async () => {
    const { processor, queue, exports, files, clock } = setup();
    await queue();
    await processor.runOnce();

    clock.set(new Date('2026-10-27T10:00:00Z'));
    expect((await processor.runOnce()).expired).toBe(1);

    expect(await files.get('exports/inst-1/e1.zip')).toBeNull();
    expect(await exports.findById(INSTITUTE, 'e1')).toMatchObject({
      status: 'expired',
      fileKey: null,
    });
  });
});
