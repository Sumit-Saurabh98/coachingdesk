// The phone's queue of attendance not yet on the server (ARCHITECTURE §6: attendance is the one
// thing that can be WRITTEN offline). An interface + implementations, like the API's providers:
// SQLite on the phone, in memory for tests.
import type { AttendanceStatus } from '@coachingdesk/shared';

/** Why the server refused a save, kept so the teacher can see it (never silently dropped). */
export interface StoredError {
  status: number | null;
  code: string | null;
  details: Record<string, unknown>;
}

/** One "Save attendance" waiting to reach the server. */
export interface PendingAttendance {
  clientId: string; // UUID made on the phone: sending it twice is harmless (idempotent PUT)
  instituteId: string;
  batchId: string;
  batchName: string; // for the Today screen while offline
  date: string; // "YYYY-MM-DD"
  records: Array<{ studentId: string; status: AttendanceStatus }>;
  createdAt: string; // ISO, phone time: only for display, the server orders by when it RECEIVES
  error: StoredError | null; // set when the server refused it; then it's no longer retried
}

export interface AttendanceOutbox {
  add(item: PendingAttendance): Promise<void>;
  /** Oldest first: they must reach the server in the order they were saved (last one wins). */
  all(): Promise<PendingAttendance[]>;
  remove(clientId: string): Promise<void>;
  markFailed(clientId: string, error: StoredError): Promise<void>;
}

/** For tests (and as the reference for how the SQLite one must behave). */
export class InMemoryAttendanceOutbox implements AttendanceOutbox {
  private items: PendingAttendance[] = [];

  add(item: PendingAttendance): Promise<void> {
    this.items.push({ ...item });
    return Promise.resolve();
  }

  all(): Promise<PendingAttendance[]> {
    return Promise.resolve(this.items.map((item) => ({ ...item })));
  }

  remove(clientId: string): Promise<void> {
    this.items = this.items.filter((item) => item.clientId !== clientId);
    return Promise.resolve();
  }

  markFailed(clientId: string, error: StoredError): Promise<void> {
    this.items = this.items.map((item) => (item.clientId === clientId ? { ...item, error } : item));
    return Promise.resolve();
  }
}
