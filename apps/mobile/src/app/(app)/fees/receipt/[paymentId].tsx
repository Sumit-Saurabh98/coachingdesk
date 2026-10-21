// A payment's receipt (owner, staff), and "Share" to send it to the parent: on the Free plan
// nothing is sent automatically, so the owner shares it (e.g. on WhatsApp) from here.
import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, Divider, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { feeKeys, getReceipt, type Receipt } from '@/fees/fees-api';
import { rupees } from '@/fees/rupees';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';

export default function ReceiptScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canSeeFees = current?.role === 'owner' || current?.role === 'staff';

  const receipt = useQuery({
    queryKey: feeKeys.receipt(instituteId, paymentId),
    queryFn: ({ signal }) => getReceipt(instituteId, paymentId, signal),
    enabled: instituteId !== '' && canSeeFees,
  });

  if (!canSeeFees) {
    return <Redirect href="/" />;
  }
  if (!receipt.data) {
    return (
      <View style={styles.centered}>
        {receipt.isError ? (
          <>
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, receipt.error)}</Text>
            <Button mode="contained" onPress={() => void receipt.refetch()}>
              {t('common.retry')}
            </Button>
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }

  const r = receipt.data;
  const paidOn = formatLocalDate(toLocalDateString(new Date(r.paidAt)), months);
  const voided = r.status === 'voided';

  /** The receipt as a plain text message, in the app's language. */
  const message = (data: Receipt) =>
    [
      data.institute.name,
      t('receipt.numberOn', { number: data.receiptNumber, date: paidOn }),
      '',
      ...data.lines.map(
        (line) => `${line.studentName} · ${line.description}: ${rupees(line.amountPaise)}`,
      ),
      data.creditPaise > 0 ? t('receipt.credit', { amount: rupees(data.creditPaise) }) : null,
      '',
      t('receipt.total', {
        amount: rupees(data.amountPaise),
        method: t(`fees.method.${data.method}`),
      }),
      t('receipt.thanks'),
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card mode="outlined">
        <Card.Content style={styles.card}>
          <Text variant="titleLarge">{r.institute.name}</Text>
          {r.institute.city && (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {r.institute.city}
            </Text>
          )}
          <View style={styles.row}>
            <Text variant="bodyMedium">
              {t('receipt.numberOn', { number: r.receiptNumber, date: paidOn })}
            </Text>
            {voided && (
              <Chip compact style={{ backgroundColor: theme.colors.errorContainer }}>
                {t('invoice.voided')}
              </Chip>
            )}
          </View>
          <Divider style={styles.divider} />
          {r.lines.map((line) => (
            <View key={line.invoiceId} style={styles.row}>
              <View style={styles.lineText}>
                <Text variant="bodyLarge">{line.studentName}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {`${line.invoiceNumber} · ${line.description}`}
                </Text>
              </View>
              <Text variant="bodyLarge">{rupees(line.amountPaise)}</Text>
            </View>
          ))}
          {r.creditPaise > 0 && (
            <View style={styles.row}>
              <Text variant="bodyLarge">{t('receipt.creditLine')}</Text>
              <Text variant="bodyLarge">{rupees(r.creditPaise)}</Text>
            </View>
          )}
          <Divider style={styles.divider} />
          <View style={styles.row}>
            <Text variant="titleMedium">{t(`fees.method.${r.method}`)}</Text>
            <Text variant="headlineSmall">{rupees(r.amountPaise)}</Text>
          </View>
          {r.note && (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {r.note}
            </Text>
          )}
          {voided && r.voidReason && (
            <Text variant="bodySmall" style={{ color: theme.colors.error }}>
              {t('invoice.reason', { reason: r.voidReason })}
            </Text>
          )}
        </Card.Content>
      </Card>

      {!voided && (
        <Button
          mode="contained"
          icon="share-variant"
          contentStyle={styles.buttonContent}
          onPress={() => void Share.share({ message: message(r) })}
        >
          {t('receipt.share')}
        </Button>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 16, gap: 16 },
  card: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  lineText: { flex: 1 },
  divider: { marginVertical: 4 },
  buttonContent: { paddingVertical: 6 },
});
