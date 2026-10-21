// A student's invoices on their profile (owner, staff): open ones first, then the history.
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Button, List, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { toLocalDateString } from '@/lib/date-format';
import { useAppTheme } from '@/theme/theme';
import { feeKeys, listInvoices } from './fees-api';
import { InvoiceRow } from './invoice-row';
import { forProfile } from './invoice-rules';

export function StudentInvoices({
  instituteId,
  studentId,
  studentName,
  canAddInvoice,
}: {
  instituteId: string;
  studentId: string;
  studentName: string;
  canAddInvoice: boolean; // owner, and the student is active
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const today = toLocalDateString(new Date());
  const invoices = useQuery({
    queryKey: feeKeys.studentInvoices(instituteId, studentId),
    queryFn: ({ signal }) => listInvoices(instituteId, { studentId, signal }),
    enabled: instituteId !== '',
  });

  return (
    <List.Section>
      <List.Subheader>{t('invoices.studentTitle')}</List.Subheader>
      {!invoices.data ? (
        invoices.isError ? (
          <>
            <Text style={{ color: theme.colors.error, paddingHorizontal: 16 }}>
              {errorMessage(t, invoices.error)}
            </Text>
            <Button onPress={() => void invoices.refetch()}>{t('common.retry')}</Button>
          </>
        ) : (
          <ActivityIndicator />
        )
      ) : (
        <>
          {invoices.data.length === 0 && <List.Item title={t('invoices.noneForStudent')} />}
          {forProfile(invoices.data).map((invoice) => (
            <InvoiceRow
              key={invoice.id}
              invoice={invoice}
              today={today}
              showStudent={false}
              onPress={() =>
                router.push({ pathname: '/fees/[invoiceId]', params: { invoiceId: invoice.id } })
              }
            />
          ))}
        </>
      )}
      {canAddInvoice && (
        <Button
          icon="file-document-plus-outline"
          onPress={() =>
            router.push({ pathname: '/fees/new', params: { studentId, name: studentName } })
          }
        >
          {t('manualInvoice.open')}
        </Button>
      )}
    </List.Section>
  );
}
