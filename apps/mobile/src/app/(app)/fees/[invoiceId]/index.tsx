// One invoice (owner, staff): what it's for, the amounts, and the payments made on it.
// Owner/staff record a payment from here; the owner's own actions arrive in 32d–32e.
import { useQuery } from '@tanstack/react-query';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, List, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { feeKeys, getInvoice } from '@/fees/fees-api';
import { InvoiceActions } from '@/fees/invoice-actions';
import { invoiceTone, isOpen } from '@/fees/invoice-rules';
import { InvoiceStatusChip } from '@/fees/invoice-status-chip';
import { rupees } from '@/fees/rupees';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';

export default function InvoiceScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canSeeFees = current?.role === 'owner' || current?.role === 'staff';

  const detail = useQuery({
    queryKey: feeKeys.invoice(instituteId, invoiceId),
    queryFn: ({ signal }) => getInvoice(instituteId, invoiceId, signal),
    enabled: instituteId !== '' && canSeeFees,
  });

  if (!canSeeFees) {
    return <Redirect href="/" />;
  }
  // Saved data (also from the phone, when offline) wins over a failed refresh.
  if (!detail.data) {
    return (
      <View style={styles.centered}>
        {detail.isError ? (
          <>
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, detail.error)}</Text>
            <Button mode="contained" onPress={() => void detail.refetch()}>
              {t('common.retry')}
            </Button>
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }

  const { invoice, payments } = detail.data;
  const date = (iso: string) => formatLocalDate(iso, months);
  const line = (label: string, value: string, strong = false) => (
    <View style={styles.line}>
      <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
      <Text variant={strong ? 'titleLarge' : 'bodyLarge'}>{value}</Text>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: invoice.number }} />

      <List.Item
        title={invoice.studentName ?? '…'}
        description={invoice.description}
        onPress={() =>
          router.push({ pathname: '/students/[id]', params: { id: invoice.studentId } })
        }
        left={(props) => <List.Icon {...props} icon="account" />}
        right={() => (
          <InvoiceStatusChip tone={invoiceTone(invoice, toLocalDateString(new Date()))} />
        )}
      />

      <Card mode="outlined">
        <Card.Content style={styles.amounts}>
          {line(t('invoice.amount'), rupees(invoice.amountPaise))}
          {invoice.discountPaise > 0 &&
            line(t('invoice.discount'), `− ${rupees(invoice.discountPaise)}`)}
          {invoice.discountPaise > 0 && line(t('invoice.net'), rupees(invoice.netPaise))}
          {line(t('invoice.paid'), rupees(invoice.paidPaise))}
          {line(t('invoice.remaining'), rupees(invoice.remainingPaise), true)}
        </Card.Content>
      </Card>

      {isOpen(invoice.status) && (
        <Button
          mode="contained"
          icon="cash-plus"
          contentStyle={styles.buttonContent}
          onPress={() =>
            router.push({ pathname: '/fees/[invoiceId]/pay', params: { invoiceId: invoice.id } })
          }
        >
          {t('payment.record')}
        </Button>
      )}
      {isOpen(invoice.status) && (
        <InvoiceActions
          instituteId={instituteId}
          instituteName={current?.name ?? ''}
          isOwner={current?.role === 'owner'}
          invoice={invoice}
        />
      )}

      <View style={styles.facts}>
        <Text variant="bodyMedium">{t('invoice.dueOn', { date: date(invoice.dueDate) })}</Text>
        {invoice.periodStart && invoice.periodEnd && (
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('invoice.period', { from: date(invoice.periodStart), to: date(invoice.periodEnd) })}
          </Text>
        )}
        {invoice.closeReason && (
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('invoice.reason', { reason: invoice.closeReason })}
          </Text>
        )}
      </View>

      <List.Section>
        <List.Subheader>{t('invoice.payments')}</List.Subheader>
        {payments.length === 0 && <List.Item title={t('invoice.noPayments')} />}
        {payments.map((payment) => (
          <List.Item
            key={payment.id}
            title={`${rupees(payment.allocatedPaise)} · ${t(`fees.method.${payment.method}`)}`}
            description={[
              t('invoice.receiptOn', {
                number: payment.receiptNumber,
                date: date(toLocalDateString(new Date(payment.paidAt))),
              }),
              payment.note,
              payment.voidReason ? t('invoice.reason', { reason: payment.voidReason }) : null,
            ]
              .filter(Boolean)
              .join('\n')}
            descriptionNumberOfLines={3}
            left={(props) => <List.Icon {...props} icon="cash-check" />}
            onPress={() =>
              router.push({
                pathname: '/fees/receipt/[paymentId]',
                params: { paymentId: payment.id },
              })
            }
            right={() =>
              payment.status === 'voided' ? (
                <Chip compact style={{ backgroundColor: theme.colors.surfaceVariant }}>
                  {t('invoice.voided')}
                </Chip>
              ) : null
            }
          />
        ))}
      </List.Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 16, gap: 12 },
  amounts: { gap: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  facts: { gap: 4, paddingHorizontal: 4 },
  buttonContent: { paddingVertical: 6 },
});
