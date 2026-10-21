// Messages (owner, staff): every WhatsApp message the institute queued, and what happened to
// it, plus this month's usage against the plan. Answers "did the parent get it?".
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, List, ProgressBar, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { nowHHMM } from '@/attendance/today-rules';
import { formatTime } from '@/batches/schedule-format';
import { useScheduleLabels } from '@/batches/use-schedule-labels';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import {
  type MessageCategory,
  nearLimit,
  type StatusTone,
  statusTone,
  usageShare,
} from '@/messages/message-rules';
import { getUsage, listMessages, messageKeys, type OutboxMessage } from '@/messages/messages-api';
import { type AppTheme, useAppTheme } from '@/theme/theme';

const CATEGORIES: readonly MessageCategory[] = [
  'fee_reminder',
  'receipt',
  'absence',
  'notice',
  'result',
];

const ICONS: Record<MessageCategory, string> = {
  fee_reminder: 'bell-ring-outline',
  receipt: 'receipt',
  absence: 'account-cancel-outline',
  result: 'school-outline',
  notice: 'bullhorn-outline',
};

function toneColours(theme: AppTheme): Record<StatusTone, { bg: string; fg: string }> {
  return {
    waiting: { bg: theme.colors.secondaryContainer, fg: theme.colors.onSecondaryContainer },
    sent: { bg: theme.colors.primaryContainer, fg: theme.colors.onPrimaryContainer },
    delivered: { bg: theme.colors.successContainer, fg: theme.colors.onSuccessContainer },
    read: { bg: theme.colors.successContainer, fg: theme.colors.onSuccessContainer },
    failed: { bg: theme.colors.errorContainer, fg: theme.colors.onErrorContainer },
    skipped: { bg: theme.colors.surfaceVariant, fg: theme.colors.onSurfaceVariant },
  };
}

export default function MessagesScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const labels = useScheduleLabels();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canSee = current?.role === 'owner' || current?.role === 'staff';
  const [category, setCategory] = useState<MessageCategory | null>(null);

  const usage = useQuery({
    queryKey: messageKeys.usage(instituteId),
    queryFn: ({ signal }) => getUsage(instituteId, signal),
    enabled: instituteId !== '' && canSee,
  });
  const messages = useInfiniteQuery({
    queryKey: messageKeys.list(instituteId, category),
    queryFn: ({ pageParam, signal }) =>
      listMessages(instituteId, { category, cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: instituteId !== '' && canSee,
  });

  if (!canSee) {
    return <Redirect href="/" />;
  }

  const rows = messages.data?.pages.flatMap((page) => page.messages) ?? [];
  const colours = toneColours(theme);
  const when = (iso: string) => {
    const date = new Date(iso);
    return `${formatLocalDate(toLocalDateString(date), months)}, ${formatTime(nowHHMM(date), labels)}`;
  };

  const describe = (m: OutboxMessage) =>
    [
      t('messages.toLine', { to: m.to, when: when(m.createdAt) }),
      m.status === 'scheduled' ? t('messages.scheduledFor', { when: when(m.scheduledFor) }) : null,
      m.status === 'skipped' && m.skipReason ? t(`messages.skip.${m.skipReason}`) : null,
      m.status === 'failed' ? t('messages.failedHelp') : null,
    ]
      .filter(Boolean)
      .join('\n');

  const header = (
    <View style={styles.header}>
      {usage.data && (
        <Card mode="outlined">
          <Card.Content style={styles.usage}>
            <View style={styles.row}>
              <Text variant="titleSmall">{t('messages.thisMonth')}</Text>
              <Text variant="titleSmall">
                {usage.data.limit > 0
                  ? t('messages.usedOf', { used: usage.data.used, limit: usage.data.limit })
                  : t('messages.noneInPlan')}
              </Text>
            </View>
            <ProgressBar
              progress={usageShare(usage.data)}
              color={nearLimit(usage.data) ? theme.colors.error : theme.colors.primary}
            />
            {usage.data.todayLimit !== null && (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('messages.today', {
                  used: usage.data.todayUsed,
                  limit: usage.data.todayLimit,
                })}
              </Text>
            )}
            {usage.data.trialTotalLimit !== null && (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('messages.trialTotal', { limit: usage.data.trialTotalLimit })}
              </Text>
            )}
          </Card.Content>
        </Card>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chips}>
          <Chip selected={category === null} showSelectedCheck onPress={() => setCategory(null)}>
            {t('messages.all')}
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c} icon={ICONS[c]} selected={category === c} onPress={() => setCategory(c)}>
              {t(`messages.category.${c}`)}
            </Chip>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl
          refreshing={messages.isRefetching && !messages.isFetchingNextPage}
          onRefresh={() => {
            void usage.refetch();
            void messages.refetch();
          }}
        />
      }
      onEndReached={() => {
        if (messages.hasNextPage && !messages.isFetchingNextPage) {
          void messages.fetchNextPage();
        }
      }}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        !messages.data ? (
          messages.isError ? (
            <View style={styles.centered}>
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, messages.error)}</Text>
              <Button onPress={() => void messages.refetch()}>{t('common.retry')}</Button>
            </View>
          ) : (
            <ActivityIndicator style={styles.loading} />
          )
        ) : (
          <Text style={styles.empty}>{t('messages.empty')}</Text>
        )
      }
      ListFooterComponent={
        messages.isFetchingNextPage ? <ActivityIndicator style={styles.loading} /> : undefined
      }
      renderItem={({ item }) => {
        const tone = statusTone(item.status);
        return (
          <List.Item
            title={t(`messages.category.${item.category}`)}
            description={describe(item)}
            descriptionNumberOfLines={3}
            left={(props) => <List.Icon {...props} icon={ICONS[item.category]} />}
            right={() => (
              <Chip
                compact
                style={[styles.status, { backgroundColor: colours[tone].bg }]}
                textStyle={{ color: colours[tone].fg }}
              >
                {t(`messages.status.${tone}`)}
              </Chip>
            )}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, gap: 12 },
  usage: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', gap: 8 },
  centered: { alignItems: 'center', gap: 8, padding: 24 },
  loading: { padding: 24 },
  empty: { textAlign: 'center', padding: 24 },
  status: { alignSelf: 'center' },
});
