// "Today": the classes meeting today at the institute and whether attendance is taken. The
// server decides what "today" is (the institute's time zone), and which batches meet.
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { attendanceKeys, type DayBatch, getTodaySummary } from '@/attendance/attendance-api';
import { classTiming, countParts, isoWeekday, nowHHMM, takenCount } from '@/attendance/today-rules';
import { formatTime } from '@/batches/schedule-format';
import { useScheduleLabels } from '@/batches/use-schedule-labels';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';

export default function TodayScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const labels = useScheduleLabels();
  const months = useMonthLabels();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canManage = current?.role === 'owner' || current?.role === 'staff';

  const summary = useQuery({
    queryKey: attendanceKeys.today(instituteId),
    queryFn: ({ signal }) => getTodaySummary(instituteId, signal),
    enabled: instituteId !== '',
  });

  const header = <Stack.Screen options={{ title: current?.name ?? '' }} />;

  if (summary.isPending) {
    return (
      <View style={styles.centered}>
        {header}
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (summary.isError) {
    return (
      <View style={styles.centered}>
        {header}
        <Text style={{ color: theme.colors.error }}>{errorMessage(t, summary.error)}</Text>
        <Button mode="contained" onPress={() => void summary.refetch()}>
          {t('common.retry')}
        </Button>
      </View>
    );
  }

  const { date, batches } = summary.data;
  // "Now" / "Not taken" hints only make sense when the phone's day IS the institute's day.
  const now = date === toLocalDateString(new Date()) ? nowHHMM(new Date()) : null;

  const renderClass = ({ item }: { item: DayBatch }) => {
    const timing = now === null ? null : classTiming(item.start, item.end, now);
    return (
      <Card
        mode="outlined"
        onPress={() =>
          router.push({
            pathname: '/attendance/[batchId]',
            params: { batchId: item.batchId, date, name: item.name },
          })
        }
      >
        <Card.Title
          title={item.name}
          subtitle={`${formatTime(item.start, labels)} – ${formatTime(item.end, labels)}`}
          right={() => <StatusChip batch={item} timing={timing} />}
          rightStyle={styles.chip}
        />
        {item.counts && (
          <Card.Content>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {countParts(item.counts)
                .map(({ status, count }) => t(`today.${status}`, { count }))
                .join(' · ')}
            </Text>
          </Card.Content>
        )}
      </Card>
    );
  };

  return (
    <>
      {header}
      <FlatList
        data={batches}
        keyExtractor={(batch) => batch.batchId}
        renderItem={renderClass}
        contentContainerStyle={batches.length === 0 ? styles.emptyContainer : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={summary.isRefetching}
            onRefresh={() => void summary.refetch()}
          />
        }
        ListHeaderComponent={
          <View style={styles.heading}>
            <Text variant="titleLarge">
              {t('today.heading', {
                weekday: labels.weekdays[isoWeekday(date) - 1] ?? '',
                date: formatLocalDate(date, months),
              })}
            </Text>
            {batches.length > 0 && (
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('today.classesTaken', { taken: takenCount(batches), total: batches.length })}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="titleMedium">{t('today.noClasses')}</Text>
            <Text
              variant="bodyMedium"
              style={[styles.emptyHelp, { color: theme.colors.onSurfaceVariant }]}
            >
              {t('today.noClassesHelp')}
            </Text>
            {canManage && (
              <Button mode="contained" icon="plus" onPress={() => router.push('/batches/new')}>
                {t('today.addBatch')}
              </Button>
            )}
          </View>
        }
      />
    </>
  );
}

/** Taken (green) · Now (blue) · Not taken after the class ended (amber) · nothing before. */
function StatusChip({
  batch,
  timing,
}: {
  batch: DayBatch;
  timing: ReturnType<typeof classTiming> | null;
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  if (batch.taken) {
    return (
      <Chip
        compact
        icon="check"
        style={{ backgroundColor: theme.colors.successContainer }}
        textStyle={{ color: theme.colors.onSuccessContainer }}
      >
        {t('today.taken')}
      </Chip>
    );
  }
  if (timing === 'now') {
    return (
      <Chip
        compact
        icon="clock-outline"
        style={{ backgroundColor: theme.colors.primaryContainer }}
        textStyle={{ color: theme.colors.onPrimaryContainer }}
      >
        {t('today.now')}
      </Chip>
    );
  }
  if (timing === 'over') {
    return (
      <Chip
        compact
        icon="alert-circle-outline"
        style={{ backgroundColor: theme.colors.warningContainer }}
        textStyle={{ color: theme.colors.onWarningContainer }}
      >
        {t('today.notTaken')}
      </Chip>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  list: { padding: 16, gap: 12 },
  emptyContainer: { flexGrow: 1, padding: 16 },
  heading: { gap: 4, marginBottom: 4 },
  chip: { marginRight: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyHelp: { textAlign: 'center', marginBottom: 8 },
});
