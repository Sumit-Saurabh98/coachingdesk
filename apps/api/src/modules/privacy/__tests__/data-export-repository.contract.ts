import { describe, expect, it } from 'vitest';
import type { DataExportRepository } from '../data-export.repository';

/** Rows that must exist first (Postgres FKs). */
export const CONTRACT = {
  instituteA: '00000000-0000-7000-8000-0000000050a1',
  instituteB: '00000000-0000-7000-8000-0000000050b1',
  u1: '00000000-0000-7000-8000-0000000053a1',
} as const;

const { instituteA, instituteB, u1 } = CONTRACT;
export const exportId = (n: number) => `00000000-0000-7000-8000-00000000550${n}`;
const t = (minute: number) => new Date(Date.UTC(2026, 9, 20, 10, minute));

export const queue = (
  repo: DataExportRepository,
  n: number,
  instituteId: string = instituteA,
  at = t(n),
) => repo.createQueued({ id: exportId(n), instituteId, requestedBy: u1, createdAt: at });

export function describeDataExportRepositoryContract(
  name: string,
  create: () => DataExportRepository,
): void {
  describe(`DataExportRepository contract: ${name}`, () => {
    it('queues one export per institute at a time; a second request gets the same one', async () => {
      const repo = create();
      const first = await queue(repo, 1);
      const second = await queue(repo, 2);
      const otherInstitute = await queue(repo, 3, instituteB);

      expect(first).toMatchObject({
        created: true,
        export: { id: exportId(1), status: 'queued', attempts: 0 },
      });
      expect(second).toMatchObject({ created: false, export: { id: exportId(1) } });
      expect(otherInstitute.created).toBe(true);
      expect(await repo.findById(instituteA, exportId(2))).toBeNull();
      expect(await repo.findById(instituteB, exportId(1))).toBeNull();
    });

    it('claim -> running (attempts + 1); ready; then a new one may be queued', async () => {
      const repo = create();
      await queue(repo, 1);

      const claimed = await repo.claimNext(t(10), t(0));
      expect(claimed).toMatchObject({
        id: exportId(1),
        status: 'running',
        attempts: 1,
        startedAt: t(10),
      });
      expect(await repo.claimNext(t(10), t(0))).toBeNull(); // nothing else to do
      expect((await queue(repo, 2)).created).toBe(false); // running counts as in progress

      await repo.markReady(exportId(1), {
        fileKey: 'exports/a/1.zip',
        byteSize: 123,
        readyAt: t(11),
        expiresAt: t(50),
      });
      expect(await repo.findById(instituteA, exportId(1))).toMatchObject({
        status: 'ready',
        fileKey: 'exports/a/1.zip',
        byteSize: 123,
        readyAt: t(11),
        expiresAt: t(50),
      });
      expect((await queue(repo, 2)).created).toBe(true);
      expect((await repo.listForInstitute(instituteA, 10)).map((e) => e.id)).toEqual([
        exportId(2),
        exportId(1),
      ]);
    });

    it('oldest first; a run stuck since before the cut-off is claimed again', async () => {
      const repo = create();
      await queue(repo, 2, instituteA, t(2));
      await queue(repo, 1, instituteB, t(1));

      expect((await repo.claimNext(t(10), t(0)))?.id).toBe(exportId(1));
      expect((await repo.claimNext(t(10), t(0)))?.id).toBe(exportId(2));
      // Both started at t(10). At t(40) with a 15-minute cut-off (t(25)), both look crashed.
      expect(await repo.claimNext(t(40), t(25))).toMatchObject({ attempts: 2 });
    });

    it('retryLater puts it back in the queue; markFailed ends it', async () => {
      const repo = create();
      await queue(repo, 1);
      await repo.claimNext(t(10), t(0));
      await repo.retryLater(exportId(1), 'build_failed');
      expect(await repo.findById(instituteA, exportId(1))).toMatchObject({
        status: 'queued',
        error: 'build_failed',
      });

      await repo.claimNext(t(11), t(0));
      await repo.markFailed(exportId(1), 'build_failed');
      expect((await repo.findById(instituteA, exportId(1)))?.status).toBe('failed');
      expect((await queue(repo, 2)).created).toBe(true); // failed is not in progress
    });

    it('lists ready exports past their expiry; markExpired forgets the file', async () => {
      const repo = create();
      await queue(repo, 1);
      await repo.claimNext(t(1), t(0));
      await repo.markReady(exportId(1), {
        fileKey: 'k/1.zip',
        byteSize: 1,
        readyAt: t(2),
        expiresAt: t(30),
      });

      expect(await repo.listExpired(t(29), 10)).toEqual([]);
      expect((await repo.listExpired(t(30), 10)).map((e) => e.id)).toEqual([exportId(1)]);
      await repo.markExpired(exportId(1));
      expect(await repo.findById(instituteA, exportId(1))).toMatchObject({
        status: 'expired',
        fileKey: null,
      });
      expect(await repo.listExpired(t(59), 10)).toEqual([]);
    });

    it('countSince counts requests in the window', async () => {
      const repo = create();
      await queue(repo, 1, instituteA, t(1));
      await repo.claimNext(t(2), t(0));
      await repo.markFailed(exportId(1), 'x');
      await queue(repo, 2, instituteA, t(5));
      expect(await repo.countSince(instituteA, t(0))).toBe(2);
      expect(await repo.countSince(instituteA, t(3))).toBe(1);
      expect(await repo.countSince(instituteB, t(0))).toBe(0);
    });
  });
}
