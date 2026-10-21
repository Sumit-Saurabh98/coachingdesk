// One invoice in a list: who, what for, number and due date, what's left, and its status.
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { List, Text } from 'react-native-paper';
import { formatLocalDate } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import type { Invoice } from './fees-api';
import { invoiceTone, isOpen } from './invoice-rules';
import { InvoiceStatusChip } from './invoice-status-chip';
import { rupees } from './rupees';

export function InvoiceRow({
  invoice,
  today,
  showStudent,
  onPress,
}: {
  invoice: Invoice;
  today: string;
  showStudent: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const months = useMonthLabels();
  const amount = isOpen(invoice.status) ? invoice.remainingPaise : invoice.netPaise;
  return (
    <List.Item
      title={showStudent ? (invoice.studentName ?? '…') : invoice.description}
      description={[
        showStudent ? invoice.description : null,
        t('invoice.numberDue', {
          number: invoice.number,
          date: formatLocalDate(invoice.dueDate, months),
        }),
      ]
        .filter(Boolean)
        .join('\n')}
      descriptionNumberOfLines={2}
      onPress={onPress}
      right={() => (
        <View style={styles.right}>
          <Text variant="titleMedium">{rupees(amount)}</Text>
          <InvoiceStatusChip tone={invoiceTone(invoice, today)} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  right: { alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
});
