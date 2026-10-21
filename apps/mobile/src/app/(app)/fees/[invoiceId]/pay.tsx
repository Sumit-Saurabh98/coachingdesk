// "Record payment" (owner, staff): money paid at the centre (cash, bank transfer, other).
// Partial payments are fine; anything above what's left is kept as the family's credit.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  HelperText,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { DatePickerModal } from 'react-native-paper-dates';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { feeKeys, getInvoice, type Invoice, recordPayment } from '@/fees/fees-api';
import { isOpen } from '@/fees/invoice-rules';
import { extraAsCredit, paidAtFor, paiseToInput, parseRupees } from '@/fees/payment-rules';
import { rupees } from '@/fees/rupees';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { studentKeys } from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';

type Method = 'cash' | 'bank' | 'other';

export default function RecordPaymentScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canSeeFees = current?.role === 'owner' || current?.role === 'staff';

  // Usually cached from the invoice screen.
  const detail = useQuery({
    queryKey: feeKeys.invoice(instituteId, invoiceId),
    queryFn: ({ signal }) => getInvoice(instituteId, invoiceId, signal),
    enabled: instituteId !== '' && canSeeFees,
  });

  if (!canSeeFees) {
    return <Redirect href="/" />;
  }
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
  if (!isOpen(detail.data.invoice.status)) {
    return (
      <View style={styles.centered}>
        <Text>{t('payment.closed')}</Text>
      </View>
    );
  }
  return <PaymentForm instituteId={instituteId} invoice={detail.data.invoice} />;
}

function PaymentForm({ instituteId, invoice }: { instituteId: string; invoice: Invoice }) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const queryClient = useQueryClient();
  const today = toLocalDateString(new Date());

  const [amountText, setAmountText] = useState(() => paiseToInput(invoice.remainingPaise));
  const [method, setMethod] = useState<Method>('cash');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const [pickingDate, setPickingDate] = useState(false);
  const [triedToSubmit, setTriedToSubmit] = useState(false);
  // One key for this form: a double tap or a retry after a lost answer is the SAME payment.
  const [idempotencyKey] = useState(() => randomUUID());

  const amountPaise = parseRupees(amountText);
  const credit = amountPaise === null ? 0 : extraAsCredit(amountPaise, invoice.remainingPaise);

  const save = useMutation({
    mutationFn: (paise: number) =>
      recordPayment(
        instituteId,
        invoice.id,
        {
          amountPaise: paise,
          method,
          paidAt: paidAtFor(day, today, new Date()),
          note: note.trim() === '' ? null : note.trim(),
        },
        idempotencyKey,
      ),
    onSuccess: async (result) => {
      // Fees, the dashboard, and the student's profile (family credit) all change.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: feeKeys.all(instituteId) }),
        queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) }),
      ]);
      router.replace({
        pathname: '/fees/receipt/[paymentId]',
        params: { paymentId: result.payment.id },
      });
    },
  });

  const submit = () => {
    setTriedToSubmit(true);
    if (amountPaise !== null && !save.isPending) {
      save.mutate(amountPaise);
    }
  };

  const failure = (error: unknown) =>
    // 409: paid, waived or cancelled meanwhile (another phone, or the parent paid online).
    error instanceof ApiError && error.status === 409
      ? t('payment.closed')
      : errorMessage(t, error);

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text variant="titleMedium">{invoice.studentName ?? ''}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('payment.leftToPay', {
          description: invoice.description,
          amount: rupees(invoice.remainingPaise),
        })}
      </Text>

      <TextInput
        mode="outlined"
        label={t('payment.amount')}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        left={<TextInput.Affix text="₹" />}
        error={triedToSubmit && amountPaise === null}
        style={styles.amount}
      />
      <HelperText
        type={triedToSubmit && amountPaise === null ? 'error' : 'info'}
        visible={(triedToSubmit && amountPaise === null) || credit > 0}
      >
        {triedToSubmit && amountPaise === null
          ? t('payment.amountInvalid')
          : t('payment.extraCredit', { amount: rupees(credit) })}
      </HelperText>

      <Text variant="labelLarge" style={styles.label}>
        {t('payment.method')}
      </Text>
      <SegmentedButtons
        value={method}
        onValueChange={(value) => setMethod(value === 'bank' || value === 'other' ? value : 'cash')}
        buttons={[
          { value: 'cash', label: t('fees.method.cash'), icon: 'cash' },
          { value: 'bank', label: t('fees.method.bank'), icon: 'bank' },
          { value: 'other', label: t('fees.method.other') },
        ]}
      />

      <View style={styles.row}>
        <Text variant="labelLarge">{t('payment.paidOn')}</Text>
        <Button mode="outlined" icon="calendar" onPress={() => setPickingDate(true)}>
          {day === today ? t('studentForm.today') : formatLocalDate(day, months)}
        </Button>
      </View>

      <TextInput
        mode="outlined"
        label={t('payment.note')}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        style={styles.note}
      />

      {save.isError && (
        <Text style={[styles.error, { color: theme.colors.error }]}>{failure(save.error)}</Text>
      )}

      <Button
        mode="contained"
        icon="check"
        onPress={submit}
        loading={save.isPending}
        disabled={save.isPending}
        style={styles.submit}
        contentStyle={styles.buttonContent}
      >
        {amountPaise === null
          ? t('payment.save')
          : t('payment.saveAmount', { amount: rupees(amountPaise) })}
      </Button>

      <DatePickerModal
        mode="single"
        locale={i18n.language}
        visible={pickingDate}
        label={t('payment.paidOn')}
        date={fromLocalDateString(day)}
        validRange={{ endDate: new Date() }} // money can't be paid in the future
        onDismiss={() => setPickingDate(false)}
        onConfirm={({ date }) => {
          if (date) {
            setDay(toLocalDateString(date));
          }
          setPickingDate(false);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  form: { padding: 16 },
  amount: { marginTop: 16 },
  label: { marginTop: 8, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  note: { marginTop: 16 },
  error: { marginTop: 12 },
  submit: { marginTop: 24 },
  buttonContent: { paddingVertical: 6 },
});
