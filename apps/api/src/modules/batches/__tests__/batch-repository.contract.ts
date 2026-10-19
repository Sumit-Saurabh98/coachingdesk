import { describe, expect, it } from 'vitest';
import { Batch } from '../batch';
import type { BatchRepository } from '../batch.repository';

/**
 * Institutes that must exist before the contract runs (Postgres has a foreign key to
 * institutes; 10e inserts them). The in-memory repo doesn't care.
 */
export const CONTRACT_INSTITUTE_A = '00000000-0000-7000-8000-0000000003a1';
export const CONTRACT_INSTITUTE_B = '00000000-0000-7000-8000-0000000003b1';

const batchId = (n: number) => `00000000-0000-7000-8000-0000000004${String(n).padStart(2, '0')}`;

const newBatch = (n: number, instituteId = CONTRACT_INSTITUTE_A, name = `Batch ${n}`) =>
  Batch.create(batchId(n), instituteId, {
    name,
    subject: 'Maths',
    schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
    defaultFeePaise: 150000,
    defaultFeeCycle: 'monthly',
  });

const archivedAt = new Date('2026-10-19T10:00:00Z');
const names = (batches: Batch[]) => batches.map((b) => b.name);

export function describeBatchRepositoryContract(name: string, create: () => BatchRepository): void {
  describe(`BatchRepository contract: ${name}`, () => {
    it('creates a batch that can be found again, unchanged', async () => {
      const repo = create();
      const batch = newBatch(1);

      await repo.create(batch);

      expect((await repo.findById(CONTRACT_INSTITUTE_A, batch.id))?.toProps()).toEqual(
        batch.toProps(),
      );
    });

    it("TENANCY: another institute's batch is invisible", async () => {
      const repo = create();
      await repo.create(newBatch(1, CONTRACT_INSTITUTE_A));

      expect(await repo.findById(CONTRACT_INSTITUTE_B, batchId(1))).toBeNull();
    });

    it('returns null for an unknown batch', async () => {
      expect(await create().findById(CONTRACT_INSTITUTE_A, batchId(99))).toBeNull();
    });

    it('refuses a duplicate id', async () => {
      const repo = create();
      await repo.create(newBatch(1));
      await expect(repo.create(newBatch(1))).rejects.toThrow();
    });

    it("lists only this institute's batches, oldest first", async () => {
      const repo = create();
      await repo.create(newBatch(1, CONTRACT_INSTITUTE_A, 'First'));
      await repo.create(newBatch(2, CONTRACT_INSTITUTE_B, 'Not mine'));
      await repo.create(newBatch(3, CONTRACT_INSTITUTE_A, 'Second'));

      const listed = await repo.listForInstitute(CONTRACT_INSTITUTE_A, { includeArchived: false });

      expect(names(listed)).toEqual(['First', 'Second']);
    });

    it('hides archived batches unless asked', async () => {
      const repo = create();
      await repo.create(newBatch(1, CONTRACT_INSTITUTE_A, 'Active'));
      await repo.create(newBatch(2, CONTRACT_INSTITUTE_A, 'Old'));
      await repo.update(newBatch(2, CONTRACT_INSTITUTE_A, 'Old').archive(archivedAt));

      const active = await repo.listForInstitute(CONTRACT_INSTITUTE_A, { includeArchived: false });
      const all = await repo.listForInstitute(CONTRACT_INSTITUTE_A, { includeArchived: true });

      expect(names(active)).toEqual(['Active']);
      expect(names(all)).toEqual(['Active', 'Old']);
    });

    it('saves edits', async () => {
      const repo = create();
      const batch = newBatch(1);
      await repo.create(batch);

      await repo.update(
        batch.withChanges({
          name: 'Renamed',
          subject: null,
          schedule: { days: [6], start: '09:00', end: '11:00' },
          defaultFeePaise: 0,
          defaultFeeCycle: 'none',
        }),
      );

      expect((await repo.findById(CONTRACT_INSTITUTE_A, batch.id))?.toPublicJSON()).toEqual({
        id: batch.id,
        name: 'Renamed',
        subject: null,
        schedule: { days: [6], start: '09:00', end: '11:00' },
        defaultFeePaise: 0,
        defaultFeeCycle: 'none',
        archivedAt: null,
      });
    });

    it('saves the archive time', async () => {
      const repo = create();
      const batch = newBatch(1);
      await repo.create(batch);

      await repo.update(batch.archive(archivedAt));

      expect((await repo.findById(CONTRACT_INSTITUTE_A, batch.id))?.archivedAt).toEqual(archivedAt);
    });

    it('refuses to update a batch that does not exist', async () => {
      await expect(create().update(newBatch(99))).rejects.toThrow();
    });

    it("TENANCY: refuses to update another institute's batch, and leaves it untouched", async () => {
      const repo = create();
      const mine = newBatch(1, CONTRACT_INSTITUTE_A, 'Mine');
      await repo.create(mine);
      // Same id, but claims to belong to institute B: e.g. a bug that mixed up two requests.
      const hijacked = Batch.restore({
        ...mine.toProps(),
        instituteId: CONTRACT_INSTITUTE_B,
        name: 'Hijacked',
      });

      await expect(repo.update(hijacked)).rejects.toThrow();
      expect((await repo.findById(CONTRACT_INSTITUTE_A, mine.id))?.name).toBe('Mine');
    });
  });
}
