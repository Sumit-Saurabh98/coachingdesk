// The attendance queue in SQLite: survives the app being closed, the phone restarting, and
// days without internet. Each row is one save, stored as JSON; `seq` keeps the order.
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { AttendanceOutbox, PendingAttendance, StoredError } from './attendance-outbox';

export class SqliteAttendanceOutbox implements AttendanceOutbox {
  private db: Promise<SQLiteDatabase> | null = null;

  constructor(private readonly fileName = 'attendance-outbox.db') {}

  async add(item: PendingAttendance): Promise<void> {
    const db = await this.open();
    await db.runAsync('INSERT INTO pending_attendance (client_id, item) VALUES (?, ?)', [
      item.clientId,
      JSON.stringify(item),
    ]);
  }

  async all(): Promise<PendingAttendance[]> {
    const db = await this.open();
    const rows = await db.getAllAsync<{ item: string }>(
      'SELECT item FROM pending_attendance ORDER BY seq',
    );
    return rows.map((row) => JSON.parse(row.item) as PendingAttendance);
  }

  async remove(clientId: string): Promise<void> {
    const db = await this.open();
    await db.runAsync('DELETE FROM pending_attendance WHERE client_id = ?', [clientId]);
  }

  async markFailed(clientId: string, error: StoredError): Promise<void> {
    const db = await this.open();
    await db.runAsync(
      "UPDATE pending_attendance SET item = json_set(item, '$.error', json(?)) WHERE client_id = ?",
      [JSON.stringify(error), clientId],
    );
  }

  /** Opened on first use, once; a failed open is tried again next time. */
  private open(): Promise<SQLiteDatabase> {
    this.db ??= (async () => {
      const db = await openDatabaseAsync(this.fileName);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS pending_attendance (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id TEXT NOT NULL UNIQUE,
          item TEXT NOT NULL
        );
      `);
      return db;
    })().catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }
}
