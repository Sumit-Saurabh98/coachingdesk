// The app's ONE attendance queue and syncer (composition root for offline attendance), plus
// the hooks screens use. Screens never talk to SQLite or the syncer's internals directly.
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { ApiError, queryClient } from '@/api';
import { errorMessage } from '@/api/error-message';
import { attendanceKeys, syncAttendance } from './attendance-api';
import type { PendingAttendance, StoredError } from './outbox/attendance-outbox';
import { AttendanceSyncer } from './outbox/attendance-syncer';
import { SqliteAttendanceOutbox } from './outbox/sqlite-attendance-outbox';
import { syncFailureKey } from './outbox/sync-failure';

export const attendanceSyncer = new AttendanceSyncer(new SqliteAttendanceOutbox(), {
  send: (item) =>
    syncAttendance(item.instituteId, item.clientId, {
      batchId: item.batchId,
      date: item.date,
      records: item.records,
    }),
});

/** The queue as cached data, so screens re-render when it changes. */
const OUTBOX_KEY = ['attendance-outbox'] as const;

attendanceSyncer.subscribe((synced) => {
  void queryClient.invalidateQueries({ queryKey: OUTBOX_KEY });
  // Saves that reached the server change that institute's Today and registers.
  for (const instituteId of new Set(synced.map((item) => item.instituteId))) {
    void queryClient.invalidateQueries({ queryKey: attendanceKeys.all(instituteId) });
  }
});

/** This institute's saves still on the phone: waiting (error null) or refused (error set). */
export function usePendingAttendance(instituteId: string): PendingAttendance[] {
  const pending = useQuery({
    queryKey: OUTBOX_KEY,
    queryFn: () => attendanceSyncer.pending(),
    staleTime: Infinity, // local data: it changes only through the syncer, which says so
  });
  return (pending.data ?? []).filter((item) => item.instituteId === instituteId);
}

/**
 * Sends waiting attendance: when a logged-in user opens the app, whenever it comes back to
 * the foreground, and every minute while it's open (cheap: an empty queue sends nothing).
 */
export function useAttendanceSync(): void {
  useEffect(() => {
    const sync = () => void attendanceSyncer.syncNow();
    sync();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        sync();
      }
    });
    const timer = setInterval(sync, 60_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);
}

/** A refused save in words: the attendance-specific reason when there is one. */
export function syncFailureText(t: TFunction, error: StoredError): string {
  const key = syncFailureKey(error);
  return key ? t(key) : errorMessage(t, new ApiError({ kind: 'http', message: '', ...error }));
}
