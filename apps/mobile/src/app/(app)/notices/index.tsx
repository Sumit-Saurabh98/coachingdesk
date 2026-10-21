// Notices sent to parents (any member): newest first, with who got them.
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, FAB, List, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { batchKeys, listBatches } from '@/batches/batches-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { listNotices, type Notice, noticeKeys } from '@/notices/notices-api';
import { useAppTheme } from '@/theme/theme';

const ICONS = {
  holiday: 'beach',
  schedule_change: 'clock-edit-outline',
  general: 'bullhorn-outline',
} as const;

/** What parents read, in one line (the server stored the template's parameters). */
function summary(t: TFunction, notice: Notice): string {
  const c = notice.content;
  switch (notice.kind) {
    case 'holiday':
      return t('notices.holidaySummary', {
        date: c.date ?? '',
        resume: c.resume_date ?? '',
        reason: c.reason ?? '',
      });
    case 'schedule_change':
      return t('notices.changeSummary', {
        batch: c.batch ?? '',
        time: c.time ?? '',
        date: c.date ?? '',
      });
    case 'general':
      return c.text ?? '';
  }
}

export default function NoticesScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  const notices = useQuery({
    queryKey: noticeKeys.all(instituteId),
    queryFn: ({ signal }) => listNotices(instituteId, signal),
    enabled: instituteId !== '',
  });
  // Batch names for "to whom" (archived too: an old notice may name an archived batch).
  const batches = useQuery({
    queryKey: batchKeys.list(instituteId, true),
    queryFn: ({ signal }) => listBatches(instituteId, true, signal),
    enabled: instituteId !== '',
  });
  const batchName = (id: string) => batches.data?.find((b) => b.id === id)?.name ?? '…';

  return (
    <View style={styles.screen}>
      {!notices.data ? (
        <View style={styles.centered}>
          {notices.isError ? (
            <>
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, notices.error)}</Text>
              <Button mode="contained" onPress={() => void notices.refetch()}>
                {t('common.retry')}
              </Button>
            </>
          ) : (
            <ActivityIndicator size="large" />
          )}
        </View>
      ) : (
        <FlatList
          data={notices.data}
          keyExtractor={(notice) => notice.id}
          contentContainerStyle={notices.data.length === 0 ? styles.emptyContainer : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={notices.isRefetching}
              onRefresh={() => void notices.refetch()}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text variant="titleMedium">{t('notices.empty')}</Text>
              <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
                {t('notices.emptyHelp')}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <List.Item
              title={summary(t, item)}
              titleNumberOfLines={4}
              description={t('notices.sentLine', {
                date: formatLocalDate(item.day, months),
                count: item.recipients,
                batches: item.batchIds.map(batchName).join(', '),
              })}
              descriptionNumberOfLines={2}
              left={(props) => <List.Icon {...props} icon={ICONS[item.kind]} />}
            />
          )}
        />
      )}
      <FAB
        icon="send"
        label={t('notices.new')}
        style={styles.fab}
        onPress={() => router.push('/notices/new')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  list: { paddingBottom: 96 },
  emptyContainer: { flexGrow: 1 },
  help: { textAlign: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
