// Invoices (owner, staff): the overdue ones, or everything still open. Oldest due first, so
// whoever has waited longest is at the top.
import { useQuery } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, SegmentedButtons, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { feeKeys, listInvoices } from '@/fees/fees-api';
import { InvoiceRow } from '@/fees/invoice-row';
import type { InvoiceFilter } from '@/fees/invoice-rules';
import { rupees } from '@/fees/rupees';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { toLocalDateString } from '@/lib/date-format';
import { useAppTheme } from '@/theme/theme';

export default function InvoicesScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<InvoiceFilter>(
    params.filter === 'open' ? 'open' : 'overdue',
  );
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canSeeFees = current?.role === 'owner' || current?.role === 'staff';
  const today = toLocalDateString(new Date());

  const invoices = useQuery({
    queryKey: feeKeys.invoices(instituteId, filter),
    queryFn: ({ signal }) => listInvoices(instituteId, { filter, signal }),
    enabled: instituteId !== '' && canSeeFees,
  });

  if (!canSeeFees) {
    return <Redirect href="/" />;
  }

  const rows = invoices.data ?? [];
  const total = rows.reduce((sum, invoice) => sum + invoice.remainingPaise, 0);

  return (
    <View style={styles.screen}>
      <SegmentedButtons
        style={styles.filter}
        value={filter}
        onValueChange={(value) => setFilter(value === 'open' ? 'open' : 'overdue')}
        buttons={[
          { value: 'overdue', label: t('invoices.overdue') },
          { value: 'open', label: t('invoices.open') },
        ]}
      />
      {!invoices.data ? (
        <View style={styles.centered}>
          {invoices.isError ? (
            <>
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, invoices.error)}</Text>
              <Button mode="contained" onPress={() => void invoices.refetch()}>
                {t('common.retry')}
              </Button>
            </>
          ) : (
            <ActivityIndicator size="large" />
          )}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(invoice) => invoice.id}
          refreshControl={
            <RefreshControl
              refreshing={invoices.isRefetching}
              onRefresh={() => void invoices.refetch()}
            />
          }
          ListHeaderComponent={
            rows.length > 0 ? (
              <Text
                variant="bodyMedium"
                style={[styles.total, { color: theme.colors.onSurfaceVariant }]}
              >
                {t('invoices.total', { count: rows.length, amount: rupees(total) })}
              </Text>
            ) : undefined
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {filter === 'overdue' ? t('fees.noneOverdue') : t('invoices.noneOpen')}
            </Text>
          }
          renderItem={({ item }) => (
            <InvoiceRow
              invoice={item}
              today={today}
              showStudent
              onPress={() =>
                router.push({ pathname: '/fees/[invoiceId]', params: { invoiceId: item.id } })
              }
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filter: { margin: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  total: { paddingHorizontal: 16, paddingBottom: 4 },
  empty: { textAlign: 'center', padding: 24 },
});
