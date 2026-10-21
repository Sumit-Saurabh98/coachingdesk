// A student's attendance on their profile (any member): one month at a time, with the
// percentage the way the API counts it (late = attended; approved leave doesn't count).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, List, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { useScheduleLabels } from '@/batches/use-schedule-labels';
import { formatLocalDate, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';
import { attendanceKeys, getStudentAttendance } from './attendance-api';
import { formatMonth, monthOf, monthRange, newestFirst, shiftMonth } from './history-rules';
import { AttendanceStatusChip } from './status-chip';
import { countParts, isoWeekday } from './today-rules';

export function StudentAttendance({
  instituteId,
  studentId,
  batchName,
}: {
  instituteId: string;
  studentId: string;
  batchName: (batchId: string) => string;
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const labels = useScheduleLabels();
  const thisMonth = monthOf(toLocalDateString(new Date()));
  const [month, setMonth] = useState(thisMonth);

  const history = useQuery({
    queryKey: attendanceKeys.student(instituteId, studentId, month),
    queryFn: ({ signal }) => {
      const { from, to } = monthRange(month);
      return getStudentAttendance(instituteId, studentId, from, to, signal);
    },
    enabled: instituteId !== '',
    placeholderData: (previous) => previous, // keep the old month on screen while the next loads
  });

  const records = newestFirst(
    (history.data?.records ?? []).map((record) => ({
      ...record,
      batchName: batchName(record.batchId),
    })),
  );
  const summary = history.data?.summary;

  return (
    <List.Section>
      <List.Subheader>{t('studentAttendance.title')}</List.Subheader>
      <View style={styles.monthRow}>
        <IconButton
          icon="chevron-left"
          accessibilityLabel={t('studentAttendance.previous')}
          onPress={() => setMonth(shiftMonth(month, -1))}
        />
        <Text variant="titleMedium">{formatMonth(month, months)}</Text>
        <IconButton
          icon="chevron-right"
          accessibilityLabel={t('studentAttendance.next')}
          disabled={month >= thisMonth} // no attendance in the future
          onPress={() => setMonth(shiftMonth(month, 1))}
        />
      </View>

      {!history.data ? (
        history.isError ? (
          <View style={styles.centered}>
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, history.error)}</Text>
            <Button onPress={() => void history.refetch()}>{t('common.retry')}</Button>
          </View>
        ) : (
          <ActivityIndicator style={styles.loading} />
        )
      ) : (
        <>
          {summary && (
            <View style={styles.summary}>
              <Text variant="headlineSmall">
                {summary.percentage === null
                  ? t('studentAttendance.noPercentage')
                  : t('studentAttendance.percentage', { percent: summary.percentage })}
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {countParts(summary)
                  .map(({ status, count }) => t(`today.${status}`, { count }))
                  .join(' · ')}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('studentAttendance.howCounted')}
              </Text>
            </View>
          )}
          {records.length === 0 && <List.Item title={t('studentAttendance.noRecords')} />}
          {records.map((record) => (
            <List.Item
              key={`${record.date}|${record.batchId}`}
              title={t('studentAttendance.day', {
                weekday: labels.weekdays[isoWeekday(record.date) - 1] ?? '',
                date: formatLocalDate(record.date, months),
              })}
              description={record.batchName}
              right={() => <AttendanceStatusChip status={record.status} />}
            />
          ))}
        </>
      )}
    </List.Section>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summary: { paddingHorizontal: 16, paddingBottom: 8, gap: 2 },
  centered: { alignItems: 'center', gap: 8, padding: 16 },
  loading: { padding: 16 },
});
