// Sends the queued attendance to the server, oldest first. Every save goes through here, online
// or not: online it's sent at once; offline it waits and is sent later by itself.
import { ApiError } from '../../api/api-error';
import type { SyncAttendanceResult } from '../attendance-api';
import type { AttendanceOutbox, PendingAttendance, StoredError } from './attendance-outbox';

/** Sends one save to the server (in the app: PUT .../attendance-sessions/:clientId). */
export interface AttendanceSender {
  send(item: PendingAttendance): Promise<SyncAttendanceResult>;
}

export type SyncOutcome =
  | { kind: 'synced'; result: SyncAttendanceResult }
  | { kind: 'failed'; clientId: string; error: StoredError } // refused: retrying won't help
  | { kind: 'queued' }; // not sent yet (offline, server down...): it will be

/**
 * Worth trying again later? No connection, a timeout, a server error, an expired login, or
 * "too many requests": yes. Any other 4xx means THIS save is wrong (too old, archived batch):
 * sending it again would fail again, and it would block every save behind it.
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return true; // unknown trouble: keep it (losing a class's attendance is the worst outcome)
  }
  if (error.kind !== 'http') {
    return true;
  }
  const status = error.status ?? 0;
  return status >= 500 || status === 401 || status === 408 || status === 429;
}

export function toStoredError(error: unknown): StoredError {
  return error instanceof ApiError
    ? { status: error.status, code: error.code, details: error.details }
    : { status: null, code: null, details: {} };
}

type Listener = (synced: PendingAttendance[]) => void;

export class AttendanceSyncer {
  private running: Promise<Map<string, SyncOutcome>> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly outbox: AttendanceOutbox,
    private readonly sender: AttendanceSender,
  ) {}

  /** Called after every change to the queue, with the saves that reached the server. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pending(): Promise<PendingAttendance[]> {
    return this.outbox.all();
  }

  /** Save: queue it, then send everything queued (older saves first). */
  async submit(item: PendingAttendance): Promise<SyncOutcome> {
    await this.outbox.add(item);
    this.emit([]);
    // A send already running may have read the queue before this item was added: let it
    // finish, then send again so this item is included.
    const earlier = this.running ? await this.running : new Map<string, SyncOutcome>();
    const now = await this.syncNow();
    return now.get(item.clientId) ?? earlier.get(item.clientId) ?? (await this.stateOf(item));
  }

  /** Send what's queued. Only one send runs at a time; a second call joins it. */
  syncNow(): Promise<Map<string, SyncOutcome>> {
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Forget a save the server refused (the teacher decided). */
  async discard(clientId: string): Promise<void> {
    await this.outbox.remove(clientId);
    this.emit([]);
  }

  private async drain(): Promise<Map<string, SyncOutcome>> {
    const outcomes = new Map<string, SyncOutcome>();
    const synced: PendingAttendance[] = [];
    try {
      for (;;) {
        // Read the queue every time: saves made while sending are picked up too.
        const next = (await this.outbox.all()).find((item) => item.error === null);
        if (!next) {
          break;
        }
        try {
          const result = await this.sender.send(next);
          await this.outbox.remove(next.clientId);
          outcomes.set(next.clientId, { kind: 'synced', result });
          synced.push(next);
        } catch (error) {
          if (isRetryable(error)) {
            break; // offline: the rest would fail too, and order matters. Try later.
          }
          const stored = toStoredError(error);
          await this.outbox.markFailed(next.clientId, stored);
          outcomes.set(next.clientId, { kind: 'failed', clientId: next.clientId, error: stored });
        }
      }
    } finally {
      this.emit(synced);
    }
    return outcomes;
  }

  private async stateOf(item: PendingAttendance): Promise<SyncOutcome> {
    const stored = (await this.outbox.all()).find((i) => i.clientId === item.clientId);
    return stored?.error
      ? { kind: 'failed', clientId: item.clientId, error: stored.error }
      : { kind: 'queued' };
  }

  private emit(synced: PendingAttendance[]): void {
    for (const listener of this.listeners) {
      listener(synced);
    }
  }
}
