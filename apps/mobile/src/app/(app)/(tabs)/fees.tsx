// Fees (owner, staff): what came in this month, what's still pending, and who owes the most
// (FR-4.7). Teachers never see fees (KB #31): the tab is hidden for them.
import { useQuery } from '@tanstack/react-query';
import { Redirect, router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, IconButton, List, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { formatMonth, monthOf, shiftMonth } from '@/attendance/history-rules';
import { methodParts } from '@/fees/dashboard-rules';
import { feeKeys, getFeeDashboard } from '@/fees/fees-api';
import { rupees } from '@/fees/rupees';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';

export default function FeesTab() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canSeeFees = current?.role === 'owner' || current?.role === 'staff';
  // null = this month at the institute (the server decides which month that is).
  const [month, setMonth] = useState<string | null>(null);

  const dashboard = useQuery({
    queryKey: feeKeys.dashboard(instituteId, month),
    queryFn: ({ signal }) => getFeeDashboard(instituteId, month, signal),
    enabled: instituteId !== '' && canSeeFees,
    placeholderData: (previous) => previous, // keep the old month on screen while switching
  });

  if (!canSeeFees) {
    return <Redirect href="/" />;
  }

  const header = <Stack.Screen options={{ title: t('tabs.fees') }} />;

  // Saved data (also from the phone, when offline) wins over a failed refresh.
  if (!dashboard.data) {
    return (
      <View style={styles.centered}>
        {header}
        {dashboard.isError ? (
          <>
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, dashboard.error)}</Text>
            <Button mode="contained" onPress={() => void dashboard.refetch()}>
              {t('common.retry')}
            </Button>
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }

  const data = dashboard.data;
  const shown = data.month;
  const thisMonth = monthOf(toLocalDateString(new Date()));
  const methods = methodParts(data.byMethod);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching}
          onRefresh={() => void dashboard.refetch()}
        />
      }
    >
      {header}
      {dashboard.isError && (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('common.showingSaved')}
        </Text>
      )}

      <Card mode="contained" style={{ backgroundColor: theme.colors.primaryContainer }}>
        <Card.Content>
          <View style={styles.monthRow}>
            <IconButton
              icon="chevron-left"
              iconColor={theme.colors.onPrimaryContainer}
              accessibilityLabel={t('studentAttendance.previous')}
              onPress={() => setMonth(shiftMonth(shown, -1))}
            />
            <Text variant="titleSmall" style={{ color: theme.colors.onPrimaryContainer }}>
              {t('fees.collectedIn', { month: formatMonth(shown, months) })}
            </Text>
            <IconButton
              icon="chevron-right"
              iconColor={theme.colors.onPrimaryContainer}
              accessibilityLabel={t('studentAttendance.next')}
              disabled={shown >= thisMonth}
              onPress={() => setMonth(shiftMonth(shown, 1))}
            />
          </View>
          <Text
            variant="displaySmall"
            style={[styles.center, { color: theme.colors.onPrimaryContainer }]}
          >
            {rupees(data.collectedPaise)}
          </Text>
          {methods.length > 0 && (
            <Text
              variant="bodyMedium"
              style={[styles.center, { color: theme.colors.onPrimaryContainer }]}
            >
              {methods
                .map(({ method, paise }) => `${t(`fees.method.${method}`)} ${rupees(paise)}`)
                .join(' · ')}
            </Text>
          )}
        </Card.Content>
      </Card>

      <View style={styles.pair}>
        <Card
          mode="outlined"
          style={styles.half}
          onPress={() => router.push({ pathname: '/fees/invoices', params: { filter: 'open' } })}
        >
          <Card.Content>
            <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('fees.pending')}
            </Text>
            <Text variant="titleLarge">{rupees(data.pendingPaise)}</Text>
          </Card.Content>
        </Card>
        <Card
          mode="contained"
          onPress={() => router.push({ pathname: '/fees/invoices', params: { filter: 'overdue' } })}
          style={[
            styles.half,
            {
              backgroundColor:
                data.overdueCount > 0 ? theme.colors.warningContainer : theme.colors.surfaceVariant,
            },
          ]}
        >
          <Card.Content>
            <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('fees.overdue')}
            </Text>
            <Text variant="titleLarge">{t('fees.overdueCount', { count: data.overdueCount })}</Text>
          </Card.Content>
        </Card>
      </View>

      <List.Section>
        <List.Item
          title={t('invoices.allOpen')}
          left={(props) => <List.Icon {...props} icon="file-document-multiple-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push({ pathname: '/fees/invoices', params: { filter: 'open' } })}
        />
        <List.Subheader>{t('fees.topOverdue')}</List.Subheader>
        {data.topOverdue.length === 0 && <List.Item title={t('fees.noneOverdue')} />}
        {data.topOverdue.map((row) => (
          <List.Item
            key={row.studentId}
            title={row.name}
            description={t('fees.daysOverdue', { count: row.daysOverdue })}
            onPress={() =>
              router.push({ pathname: '/students/[id]', params: { id: row.studentId } })
            }
            left={(props) => <List.Icon {...props} icon="account-clock-outline" />}
            right={() => (
              <Text variant="titleMedium" style={[styles.amount, { color: theme.colors.error }]}>
                {rupees(row.overduePaise)}
              </Text>
            )}
          />
        ))}
      </List.Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 16, gap: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { textAlign: 'center' },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  amount: { alignSelf: 'center' },
});
