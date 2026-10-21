import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/api-error';
import type { SyncAttendanceResult } from '../attendance-api';
import { InMemoryAttendanceOutbox, type PendingAttendance } from '../outbox/attendance-outbox';
import { type AttendanceSender, AttendanceSyncer, isRetryable } from '../outbox/attendance-syncer';
import { syncFailureKey } from '../outbox/sync-failure';

const ok: SyncAttendanceResult = {
  alerts: { status: 'none_absent', queued: 0 },
  skippedReadOnly: [],
};
const offline = new ApiError({ kind: 'network', message: 'offline' });
const http = (status: number, details: Record<string, unknown> = {}) =>
  new ApiError({ kind: 'http', status, code: 'X', message: 'x', details });

const item = (clientId: string): PendingAttendance => ({
  clientId,
  instituteId: 'i1',
  batchId: 'b1',
  batchName: 'Maths',
  date: '2026-10-21',
  records: [{ studentId: 's1', status: 'absent' }],
  createdAt: '2026-10-21T12:00:00.000Z',
  error: null,
});

/** A server we control: answers (or fails) per clientId, and records the order it was asked. */
class FakeSender implements AttendanceSender {
  readonly sent: string[] = [];
  failWith = new Map<string, Error>();
  send(pending: PendingAttendance): Promise<SyncAttendanceResult> {
    this.sent.push(pending.clientId);
    const error = this.failWith.get(pending.clientId);
    return error === undefined ? Promise.resolve(ok) : Promise.reject(error);
  }
}

const setup = () => {
  const outbox = new InMemoryAttendanceOutbox();
  const sender = new FakeSender();
  return { outbox, sender, syncer: new AttendanceSyncer(outbox, sender) };
};

describe('AttendanceSyncer', () => {
  it('online: sends at once and empties the queue', async () => {
    const { outbox, syncer } = setup();
    expect(await syncer.submit(item('a'))).toEqual({ kind: 'synced', result: ok });
    expect(await outbox.all()).toEqual([]);
  });

  it('offline: keeps the save, and sends it later', async () => {
    const { outbox, sender, syncer } = setup();
    sender.failWith.set('a', offline);
    expect(await syncer.submit(item('a'))).toEqual({ kind: 'queued' });
    expect((await outbox.all()).map((i) => i.clientId)).toEqual(['a']);

    sender.failWith.clear(); // back online
    await syncer.syncNow();
    expect(await outbox.all()).toEqual([]);
  });

  it('sends oldest first, and stops at the first connection problem (order matters)', async () => {
    const { outbox, sender, syncer } = setup();
    await outbox.add(item('old'));
    sender.failWith.set('old', offline);
    expect(await syncer.submit(item('new'))).toEqual({ kind: 'queued' });
    expect(sender.sent).toEqual(['old']); // "new" never overtakes "old"

    sender.failWith.clear();
    const outcomes = await syncer.syncNow();
    expect(sender.sent).toEqual(['old', 'old', 'new']);
    expect([...outcomes.keys()]).toEqual(['old', 'new']);
  });

  it('a refused save is kept as failed and does not block the ones after it', async () => {
    const { outbox, sender, syncer } = setup();
    await outbox.add(item('bad'));
    sender.failWith.set('bad', http(422, { field: 'date' }));
    expect(await syncer.submit(item('good'))).toEqual({ kind: 'synced', result: ok });

    const left = await outbox.all();
    expect(left.map((i) => i.clientId)).toEqual(['bad']);
    expect(left[0]?.error).toEqual({ status: 422, code: 'X', details: { field: 'date' } });

    await syncer.syncNow(); // a failed save is not retried
    expect(sender.sent.filter((id) => id === 'bad')).toHaveLength(1);
  });

  it('discard removes a failed save', async () => {
    const { outbox, sender, syncer } = setup();
    sender.failWith.set('a', http(409));
    expect((await syncer.submit(item('a'))).kind).toBe('failed');
    await syncer.discard('a');
    expect(await outbox.all()).toEqual([]);
  });

  it('two sends at once share one run (nothing is sent twice)', async () => {
    const { sender, syncer, outbox } = setup();
    await outbox.add(item('a'));
    await Promise.all([syncer.syncNow(), syncer.syncNow()]);
    expect(sender.sent).toEqual(['a']);
  });

  it('tells listeners which saves reached the server', async () => {
    const { syncer } = setup();
    const heard: string[][] = [];
    syncer.subscribe((synced) => heard.push(synced.map((i) => i.clientId)));
    await syncer.submit(item('a'));
    expect(heard).toContainEqual(['a']);
  });
});

describe('isRetryable', () => {
  it.each([
    [offline, true],
    [new ApiError({ kind: 'timeout', message: 't' }), true],
    [http(500), true],
    [http(503), true],
    [http(401), true],
    [http(429), true],
    [http(422), false],
    [http(409), false],
    [http(404), false],
    [new Error('bug'), true],
  ])('%s -> %s', (error, retry) => {
    expect(isRetryable(error)).toBe(retry);
  });
});

describe('syncFailureKey', () => {
  const stored = (status: number, details: Record<string, unknown> = {}) => ({
    status,
    code: 'X',
    details,
  });
  it.each([
    [stored(422, { field: 'date' }), 'register.failedDate'],
    [stored(422, { field: 'records' }), 'register.failedNotEnrolled'],
    [stored(409), 'register.failedArchived'],
    [stored(404), 'register.failedNoBatch'],
    [stored(422, { field: 'clientId' }), null],
    [stored(403), null],
  ])('%j -> %s', (error, key) => {
    expect(syncFailureKey(error)).toBe(key);
  });
});
