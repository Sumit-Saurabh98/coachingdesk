// Your data (owner): a full export of the institute (a ZIP of spreadsheets), saved to a folder
// on this phone. The file holds every parent's phone number: it never goes through a link.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Directory } from 'expo-file-system';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, List, Snackbar, Text } from 'react-native-paper';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { nowHHMM } from '@/attendance/today-rules';
import { formatTime } from '@/batches/schedule-format';
import { useScheduleLabels } from '@/batches/use-schedule-labels';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { type DataExport, exportFileName, formatBytes, isWorking } from '@/privacy/data-rules';
import { downloadExport, exportKeys, listExports, requestExport } from '@/privacy/privacy-api';
import { useAppTheme } from '@/theme/theme';

export default function DataScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const labels = useScheduleLabels();
  const queryClient = useQueryClient();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const isOwner = current?.role === 'owner';
  const [notice, setNotice] = useState<string | null>(null);

  const exports = useQuery({
    queryKey: exportKeys.all(instituteId),
    queryFn: ({ signal }) => listExports(instituteId, signal),
    enabled: instituteId !== '' && isOwner,
    // While one is being made, look again every few seconds.
    refetchInterval: (query) => (query.state.data?.some((e) => isWorking(e.status)) ? 4000 : false),
  });
  const request = useMutation({
    mutationFn: () => requestExport(instituteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: exportKeys.all(instituteId) });
    },
  });
  const save = useMutation({
    mutationFn: async (item: DataExport) => {
      const downloaded = await downloadExport(item);
      try {
        // The phone's own folder picker (e.g. Downloads): the owner decides where it goes.
        const folder = await Directory.pickDirectoryAsync();
        const target = folder.createFile(exportFileName(item.createdAt), 'application/zip');
        await target.write(await downloaded.bytes());
        return target.name;
      } finally {
        downloaded.delete(); // never leave a copy in the app's cache
      }
    },
    onSuccess: (name) => setNotice(t('data.saved', { name })),
    onError: (error) => {
      // Closing the folder picker isn't an error worth a message.
      if (!(error instanceof Error && /cancel/i.test(error.message))) {
        setNotice(errorMessage(t, error));
      }
    },
  });

  if (!isOwner) {
    return <Redirect href="/" />;
  }

  const when = (iso: string) => {
    const date = new Date(iso);
    return `${formatLocalDate(toLocalDateString(date), months)}, ${formatTime(nowHHMM(date), labels)}`;
  };
  const requestFailure = (error: unknown) =>
    error instanceof ApiError && error.code === 'DAILY_LIMIT_REACHED'
      ? t('data.dailyLimit')
      : errorMessage(t, error);
  const working = exports.data?.some((e) => isWorking(e.status)) ?? false;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card mode="outlined">
          <Card.Title title={t('data.exportTitle')} />
          <Card.Content style={styles.gap}>
            <Text variant="bodyMedium">{t('data.exportBody')}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('data.exportNote')}
            </Text>
            {request.isError && (
              <Text style={{ color: theme.colors.error }}>{requestFailure(request.error)}</Text>
            )}
          </Card.Content>
          <Card.Actions>
            <Button
              mode="contained"
              icon="database-export-outline"
              loading={request.isPending}
              disabled={request.isPending || working}
              onPress={() => request.mutate()}
            >
              {working ? t('data.preparing') : t('data.prepare')}
            </Button>
          </Card.Actions>
        </Card>

        <List.Section>
          <List.Subheader>{t('data.recent')}</List.Subheader>
          {!exports.data ? (
            <ActivityIndicator />
          ) : exports.data.length === 0 ? (
            <List.Item title={t('data.none')} />
          ) : (
            exports.data.map((item) => (
              <List.Item
                key={item.id}
                title={when(item.createdAt)}
                description={[
                  t(`data.status.${item.status}`),
                  item.byteSize !== null ? formatBytes(item.byteSize) : null,
                  item.status === 'ready' && item.expiresAt
                    ? t('data.keptUntil', { date: when(item.expiresAt) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                left={(props) => (
                  <List.Icon
                    {...props}
                    icon={item.status === 'ready' ? 'folder-zip-outline' : 'timer-sand'}
                  />
                )}
                right={() =>
                  item.status === 'ready' ? (
                    <Button
                      compact
                      icon="download"
                      loading={save.isPending && save.variables?.id === item.id}
                      disabled={save.isPending}
                      onPress={() => save.mutate(item)}
                    >
                      {t('data.save')}
                    </Button>
                  ) : isWorking(item.status) ? (
                    <ActivityIndicator style={styles.spinner} />
                  ) : null
                }
              />
            ))
          )}
        </List.Section>
      </ScrollView>
      <Snackbar visible={notice !== null} onDismiss={() => setNotice(null)} duration={5000}>
        {notice ?? ''}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  gap: { gap: 8 },
  spinner: { marginRight: 12 },
});
