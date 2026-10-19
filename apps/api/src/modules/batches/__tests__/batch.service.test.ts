import { describe, expect, it } from 'vitest';
import { FixedClock, SequentialIdGenerator } from '@coachingdesk/shared';
import type { NewBatchInput } from '../batch';
import { InMemoryBatchRepository } from '../batch.repository';
import { BatchService } from '../batch.service';

const INSTITUTE_A = 'inst-a';
const INSTITUTE_B = 'inst-b';

const input = (name = 'Class 10 Maths'): NewBatchInput => ({
  name,
  schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
  defaultFeePaise: 150000,
  defaultFeeCycle: 'monthly',
});

function setup() {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const repository = new InMemoryBatchRepository();
  const service = new BatchService({
    batches: repository,
    ids: new SequentialIdGenerator(),
    clock,
  });
  return { service, repository, clock };
}

describe('BatchService.create', () => {
  it('stores a new batch in the given institute with a fresh id', async () => {
    const { service, repository } = setup();

    const batch = await service.create(INSTITUTE_A, input());

    expect(batch.id).toBe('00000000-0000-7000-8000-000000000001');
    expect(await repository.findById(INSTITUTE_A, batch.id)).toBe(batch);
  });

  it('stores nothing when the entity rejects the input', async () => {
    const { service } = setup();
    await expect(service.create(INSTITUTE_A, input('A'))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await service.list(INSTITUTE_A, { includeArchived: true })).toEqual([]);
  });
});

describe('BatchService.get', () => {
  it('returns the batch', async () => {
    const { service } = setup();
    const batch = await service.create(INSTITUTE_A, input());
    expect((await service.get(INSTITUTE_A, batch.id)).name).toBe('Class 10 Maths');
  });

  it("404s for another institute's batch, exactly like an unknown id", async () => {
    const { service } = setup();
    const batch = await service.create(INSTITUTE_A, input());

    const otherInstitute = service.get(INSTITUTE_B, batch.id);
    const unknown = service.get(INSTITUTE_A, 'no-such-batch');

    await expect(otherInstitute).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(unknown).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('BatchService.update', () => {
  it('saves the changes', async () => {
    const { service } = setup();
    const batch = await service.create(INSTITUTE_A, input());

    await service.update(INSTITUTE_A, batch.id, { defaultFeePaise: 200000 });

    expect((await service.get(INSTITUTE_A, batch.id)).defaultFee.toPaise()).toBe(200000);
  });

  it("cannot change another institute's batch", async () => {
    const { service } = setup();
    const batch = await service.create(INSTITUTE_A, input());

    await expect(service.update(INSTITUTE_B, batch.id, { name: 'Hijacked' })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    expect((await service.get(INSTITUTE_A, batch.id)).name).toBe('Class 10 Maths');
  });

  it('409s for an archived batch', async () => {
    const { service } = setup();
    const batch = await service.create(INSTITUTE_A, input());
    await service.archive(INSTITUTE_A, batch.id);

    await expect(service.update(INSTITUTE_A, batch.id, { name: 'New' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('BatchService.archive', () => {
  it("stamps the clock's time and hides the batch from the default list", async () => {
    const { service } = setup();
    const batch = await service.create(INSTITUTE_A, input());

    const archived = await service.archive(INSTITUTE_A, batch.id);

    expect(archived.archivedAt?.toISOString()).toBe('2026-10-19T10:00:00.000Z');
    expect(await service.list(INSTITUTE_A, { includeArchived: false })).toEqual([]);
    expect(await service.list(INSTITUTE_A, { includeArchived: true })).toHaveLength(1);
  });

  it('is idempotent: a retry later keeps the first archive time', async () => {
    const { service, clock } = setup();
    const batch = await service.create(INSTITUTE_A, input());
    await service.archive(INSTITUTE_A, batch.id);
    clock.advanceMinutes(5);

    const again = await service.archive(INSTITUTE_A, batch.id);

    expect(again.archivedAt?.toISOString()).toBe('2026-10-19T10:00:00.000Z');
  });

  it("404s for another institute's batch", async () => {
    const { service } = setup();
    const batch = await service.create(INSTITUTE_A, input());
    await expect(service.archive(INSTITUTE_B, batch.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('BatchService.list', () => {
  it("lists only this institute's batches", async () => {
    const { service } = setup();
    await service.create(INSTITUTE_A, input('Mine'));
    await service.create(INSTITUTE_B, input('Theirs'));

    const listed = await service.list(INSTITUTE_A, { includeArchived: false });

    expect(listed.map((b) => b.name)).toEqual(['Mine']);
  });
});
