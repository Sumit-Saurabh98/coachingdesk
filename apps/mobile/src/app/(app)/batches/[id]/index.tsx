// One batch: its timings, default fee (owner/staff only), how many students are in it today,
// and, for the owner and staff, Edit and Archive.
import { Money } from '@coachingdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Dialog, List, Portal, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { archiveBatch, batchKeys, getBatch } from '@/batches/batches-api';
import { formatSchedule } from '@/batches/schedule-format';
import { useScheduleLabels } from '@/batches/use-schedule-labels';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { useAppTheme } from '@/theme/theme';

export default function BatchScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const labels = useScheduleLabels();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canManage = current?.role === 'owner' || current?.role === 'staff';
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const detail = useQuery({
    queryKey: batchKeys.detail(instituteId, id),
    queryFn: ({ signal }) => getBatch(instituteId, id, signal),
    enabled: instituteId !== '',
  });

  const archive = useMutation({
    mutationFn: () => archiveBatch(instituteId, id),
    onSuccess: async () => {
      setConfirmingArchive(false);
      // The batch moved from "Active" to "Archived": refresh every batch query.
      await queryClient.invalidateQueries({ queryKey: batchKeys.all(instituteId) });
    },
  });

  if (detail.isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (detail.isError) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: theme.colors.error }}>{errorMessage(t, detail.error)}</Text>
        <Button mode="contained" onPress={() => void detail.refetch()}>
          {t('common.retry')}
        </Button>
      </View>
    );
  }

  const { batch, enrolledCount } = detail.data;
  const archived = batch.archivedAt !== null;

  return (
    <>
      <Stack.Screen options={{ title: batch.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        {archived && (
          <Card mode="contained" style={{ backgroundColor: theme.colors.surfaceVariant }}>
            <Card.Content>
              <Text>{t('batch.archivedNote')}</Text>
            </Card.Content>
          </Card>
        )}

        <List.Section>
          <List.Item
            title={formatSchedule(batch.schedule, labels)}
            description={t('batch.timings')}
            left={(props) => <List.Icon {...props} icon="clock-outline" />}
          />
          {batch.subject !== null && (
            <List.Item
              title={batch.subject}
              description={t('batch.subject')}
              left={(props) => <List.Icon {...props} icon="book-open-variant" />}
            />
          )}
          {/* Only when the server sent it: teachers never get fee fields (KB #31). */}
          {batch.defaultFeePaise !== undefined && (
            <List.Item
              title={
                batch.defaultFeeCycle === 'none'
                  ? t('feeCycle.none')
                  : `${Money.ofPaise(batch.defaultFeePaise).format()} ${t(`feeCycle.${batch.defaultFeeCycle}`)}`
              }
              description={t('batch.defaultFee')}
              left={(props) => <List.Icon {...props} icon="currency-inr" />}
            />
          )}
          <List.Item
            title={t('batch.enrolledToday', { count: enrolledCount })}
            left={(props) => <List.Icon {...props} icon="account-group-outline" />}
          />
        </List.Section>

        {canManage && !archived && (
          <View style={styles.actions}>
            <Button
              mode="contained"
              icon="pencil"
              onPress={() => router.push({ pathname: '/batches/[id]/edit', params: { id } })}
            >
              {t('batch.edit')}
            </Button>
            <Button
              mode="outlined"
              icon="archive-outline"
              onPress={() => setConfirmingArchive(true)}
            >
              {t('batch.archive')}
            </Button>
          </View>
        )}
      </ScrollView>

      <Portal>
        <Dialog visible={confirmingArchive} onDismiss={() => setConfirmingArchive(false)}>
          <Dialog.Title>{t('batch.archiveTitle')}</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text>{t('batch.archiveBody')}</Text>
            {archive.isError && (
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, archive.error)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmingArchive(false)}>{t('common.cancel')}</Button>
            <Button
              onPress={() => archive.mutate()}
              loading={archive.isPending}
              disabled={archive.isPending}
            >
              {t('batch.archive')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 16, gap: 8 },
  actions: { gap: 12, marginTop: 8 },
  dialogContent: { gap: 8 },
});
