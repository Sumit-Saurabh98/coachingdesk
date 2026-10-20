// The institute's batches (More -> Batches). Read by everyone; created and edited by the
// owner and staff (29c). Teachers see no fees: the server leaves them out of the answer.
import { Money } from '@coachingdesk/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Divider,
  List,
  SegmentedButtons,
  Text,
} from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { type Batch, batchKeys, listBatches } from '@/batches/batches-api';
import { formatSchedule } from '@/batches/schedule-format';
import { useScheduleLabels } from '@/batches/use-schedule-labels';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { useAppTheme } from '@/theme/theme';

export default function BatchesScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const labels = useScheduleLabels();
  // Always set here: the (app) layout only opens this screen with an institute chosen.
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canManage = current?.role === 'owner' || current?.role === 'staff';

  // Two views: the batches in use, or ONLY the archived ones. (The API's includeArchived
  // returns active + archived together; the Archived view keeps just the archived part.)
  const [view, setView] = useState<'active' | 'archived'>('active');
  const archivedView = view === 'archived';
  const batches = useQuery({
    queryKey: batchKeys.list(instituteId, archivedView),
    queryFn: ({ signal }) => listBatches(instituteId, archivedView, signal),
    enabled: instituteId !== '',
    select: (list) => (archivedView ? list.filter((batch) => batch.archivedAt !== null) : list),
  });

  /** "₹1,500 per month", or nothing when the server didn't send a fee (teachers). */
  const feeText = (batch: Batch): string | null => {
    if (batch.defaultFeePaise === undefined) {
      return null;
    }
    if (batch.defaultFeeCycle === 'none') {
      return t('feeCycle.none');
    }
    return `${Money.ofPaise(batch.defaultFeePaise).format()} ${t(`feeCycle.${batch.defaultFeeCycle}`)}`;
  };

  return (
    <View style={styles.screen}>
      {/* Above the list, so it stays put while the list loads or is empty. */}
      <SegmentedButtons
        style={styles.filters}
        value={view}
        onValueChange={setView}
        buttons={[
          { value: 'active', label: t('batches.active') },
          { value: 'archived', label: t('batches.archivedTab'), icon: 'archive-outline' },
        ]}
      />
      {batches.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      ) : batches.isError ? (
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.error }}>{errorMessage(t, batches.error)}</Text>
          <Button mode="contained" onPress={() => void batches.refetch()}>
            {t('common.retry')}
          </Button>
        </View>
      ) : (
        // FlatList draws only the rows on screen: fine for 5 batches and for 500.
        <FlatList
          data={batches.data}
          keyExtractor={(batch) => batch.id}
          contentContainerStyle={batches.data.length === 0 ? styles.emptyContainer : undefined}
          // Pull down to refresh.
          refreshControl={
            <RefreshControl
              refreshing={batches.isRefetching}
              onRefresh={() => void batches.refetch()}
            />
          }
          ItemSeparatorComponent={Divider}
          renderItem={({ item: batch }) => (
            <List.Item
              title={batch.name}
              description={[batch.subject, formatSchedule(batch.schedule, labels)]
                .filter(Boolean)
                .join('\n')}
              descriptionNumberOfLines={2}
              left={(props) => <List.Icon {...props} icon="google-classroom" />}
              right={() => (
                <View style={styles.right}>
                  {feeText(batch) !== null && (
                    <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
                      {feeText(batch)}
                    </Text>
                  )}
                </View>
              )}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text variant="titleMedium">
                {archivedView ? t('batches.emptyArchivedTitle') : t('batches.emptyTitle')}
              </Text>
              <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
                {archivedView
                  ? t('batches.emptyArchived')
                  : canManage
                    ? t('batches.emptyOwner')
                    : t('batches.emptyMember')}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  screen: { flex: 1 },
  filters: { margin: 16, marginBottom: 8 },
  right: { alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  emptyContainer: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyText: { textAlign: 'center' },
});
