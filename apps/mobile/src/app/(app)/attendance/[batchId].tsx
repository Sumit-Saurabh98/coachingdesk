// The register (any member): one class on one day. Everyone starts present; the teacher taps
// the absentees (FR-3.1) and saves once. Absence messages go out AFTER saving, never per tap.
import type { AttendanceStatus } from '@coachingdesk/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  IconButton,
  List,
  Menu,
  Portal,
  Text,
} from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { attendanceKeys, getRegister, type Register } from '@/attendance/attendance-api';
import type { PendingAttendance, StoredError } from '@/attendance/outbox/attendance-outbox';
import {
  allPresent,
  countMarks,
  initialMarks,
  type Marks,
  marksToSend,
  tapped,
  withSaves,
} from '@/attendance/register-rules';
import { attendanceSyncer, syncFailureText, usePendingAttendance } from '@/attendance/sync';
import { AttendanceStatusChip } from '@/attendance/status-chip';
import { countParts } from '@/attendance/today-rules';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { useAppTheme } from '@/theme/theme';

export default function RegisterScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { batchId, date, name } = useLocalSearchParams<{
    batchId: string;
    date: string;
    name?: string;
  }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  const register = useQuery({
    queryKey: attendanceKeys.register(instituteId, batchId, date),
    queryFn: ({ signal }) => getRegister(instituteId, batchId, date, signal),
    enabled: instituteId !== '',
  });

  // This class's saves still on the phone: the register shows them, not the server's older copy.
  const saves = usePendingAttendance(instituteId).filter(
    (save) => save.error === null && save.batchId === batchId && save.date === date,
  );

  const header = name ? <Stack.Screen options={{ title: name }} /> : null;

  // Saved data (also from the phone, when offline) wins over a failed refresh.
  if (!register.data) {
    if (register.isError) {
      return (
        <View style={styles.centered}>
          {header}
          <Text style={{ color: theme.colors.error }}>{errorMessage(t, register.error)}</Text>
          <Button mode="contained" onPress={() => void register.refetch()}>
            {t('common.retry')}
          </Button>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        {header}
        <ActivityIndicator size="large" />
      </View>
    );
  }
  // Loaded once; the teacher's taps live in the form (a background refresh never undoes them).
  return (
    <>
      {header}
      <RegisterForm
        instituteId={instituteId}
        batchName={name ?? ''}
        register={register.data}
        saves={saves}
        stale={register.isError}
      />
    </>
  );
}

function RegisterForm({
  instituteId,
  batchName,
  register,
  saves,
  stale,
}: {
  instituteId: string;
  batchName: string;
  register: Register;
  saves: PendingAttendance[];
  stale: boolean; // couldn't refresh: showing the copy saved on the phone
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const rows = register.students;

  const [marks, setMarks] = useState<Marks>(() => withSaves(initialMarks(rows), saves));
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refused, setRefused] = useState<StoredError | null>(null);

  const mark = (studentId: string, status: AttendanceStatus) =>
    setMarks((currentMarks) => ({ ...currentMarks, [studentId]: status }));

  const save = useMutation({
    // Every save goes into the phone's queue first, then out (at once when online). Its own
    // UUID: if the answer is lost, sending it again is harmless (no second session or alert).
    mutationFn: () =>
      attendanceSyncer.submit({
        clientId: randomUUID(),
        instituteId,
        batchId: register.batchId,
        batchName,
        date: register.date,
        records: marksToSend(rows, marks),
        createdAt: new Date().toISOString(),
        error: null,
      }),
    onMutate: () => setRefused(null),
    onSuccess: async (outcome) => {
      if (outcome.kind === 'queued') {
        setNotice(t('register.savedOffline'));
        return;
      }
      if (outcome.kind === 'failed') {
        // The teacher is right here: show why, and don't keep it on Today's list too.
        setRefused(outcome.error);
        await attendanceSyncer.discard(outcome.clientId);
        return;
      }
      const { result } = outcome;
      // Tell the teacher what happened when it isn't simply "saved".
      if (result.skippedReadOnly.length > 0) {
        setNotice(t('register.skippedReadOnly', { count: result.skippedReadOnly.length }));
      } else if (result.alerts.status === 'too_late') {
        setNotice(t('register.alertsTooLate'));
      } else if (result.alerts.status === 'queued' && result.alerts.queued > 0) {
        setNotice(t('register.alertsQueued', { count: result.alerts.queued }));
      } else {
        router.back();
      }
    },
  });

  const submit = () => {
    if (save.isPending) {
      return;
    }
    // A taken register nobody changed: nothing to send.
    if (marksToSend(rows, marks).length === 0) {
      router.back();
      return;
    }
    save.mutate();
  };

  if (rows.length === 0) {
    return (
      <View style={styles.centered}>
        <Text variant="bodyLarge">{t('register.noStudents')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.studentId}
        extraData={{ marks, menuFor }}
        ListHeaderComponent={
          <View style={styles.header}>
            {stale && (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('common.showingSaved')}
              </Text>
            )}
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('register.help')}
            </Text>
            <View style={styles.row}>
              <Text variant="titleSmall" style={styles.counts}>
                {countParts(countMarks(marks))
                  .map(({ status, count }) => t(`today.${status}`, { count }))
                  .join(' · ')}
              </Text>
              <Button compact icon="check-all" onPress={() => setMarks(allPresent(rows))}>
                {t('register.allPresent')}
              </Button>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const status = marks[item.studentId] ?? item.status;
          return (
            <List.Item
              title={item.name}
              onPress={() => mark(item.studentId, tapped(status))}
              right={() => (
                <View style={styles.row}>
                  <AttendanceStatusChip status={status} />
                  <Menu
                    visible={menuFor === item.studentId}
                    onDismiss={() => setMenuFor(null)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        accessibilityLabel={t('register.changeStatus')}
                        onPress={() => setMenuFor(item.studentId)}
                      />
                    }
                  >
                    {(['present', 'absent', 'late', 'leave'] as const).map((choice) => (
                      <Menu.Item
                        key={choice}
                        title={t(`register.${choice}`)}
                        leadingIcon={choice === status ? 'check' : undefined}
                        onPress={() => {
                          mark(item.studentId, choice);
                          setMenuFor(null);
                        }}
                      />
                    ))}
                  </Menu>
                </View>
              )}
            />
          );
        }}
      />

      <View style={[styles.footer, { borderTopColor: theme.colors.outlineVariant }]}>
        {(refused !== null || save.isError) && (
          <Text style={[styles.error, { color: theme.colors.error }]}>
            {refused !== null ? syncFailureText(t, refused) : errorMessage(t, save.error)}
          </Text>
        )}
        <Button
          mode="contained"
          icon="content-save"
          onPress={submit}
          loading={save.isPending}
          disabled={save.isPending}
          contentStyle={styles.buttonContent}
        >
          {t('register.save')}
        </Button>
      </View>

      <Portal>
        <Dialog visible={notice !== null} onDismiss={() => router.back()}>
          <Dialog.Title>{t('register.saved')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{notice}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => router.back()}>{t('register.ok')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  header: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  counts: { flex: 1 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  error: { marginBottom: 8 },
  buttonContent: { paddingVertical: 6 },
});
