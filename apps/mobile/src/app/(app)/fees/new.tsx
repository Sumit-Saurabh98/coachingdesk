// "Add invoice" (owner): a one-off charge for one student (exam fee, books, a trip). Regular
// fees are billed automatically from the batch; this is for everything else.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { DatePickerModal } from 'react-native-paper-dates';
import { errorMessage } from '@/api/error-message';
import { createManualInvoice, feeKeys } from '@/fees/fees-api';
import {
  type ManualInvoiceValues,
  toManualInvoiceRequest,
  validateManualInvoice,
} from '@/fees/owner-actions-rules';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { studentKeys } from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';

export default function NewInvoiceScreen() {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const queryClient = useQueryClient();
  const { studentId, name } = useLocalSearchParams<{ studentId: string; name?: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  const [values, setValues] = useState<ManualInvoiceValues>(() => ({
    description: '',
    amountText: '',
    discountText: '',
    dueDate: toLocalDateString(new Date()),
  }));
  const [tried, setTried] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const set = <K extends keyof ManualInvoiceValues>(field: K, value: ManualInvoiceValues[K]) =>
    setValues((v) => ({ ...v, [field]: value }));

  const create = useMutation({
    mutationFn: () => createManualInvoice(instituteId, toManualInvoiceRequest(studentId, values)),
    onSuccess: async (invoice) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: feeKeys.all(instituteId) }),
        queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) }),
      ]);
      router.replace({ pathname: '/fees/[invoiceId]', params: { invoiceId: invoice.id } });
    },
  });

  if (current?.role !== 'owner') {
    return <Redirect href="/" />;
  }

  const errors = validateManualInvoice(values);
  const shown = tried ? errors : {};
  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length === 0 && !create.isPending) {
      create.mutate();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      {name ? <Text variant="titleMedium">{name}</Text> : null}
      <TextInput
        mode="outlined"
        label={t('manualInvoice.description')}
        placeholder={t('manualInvoice.descriptionExample')}
        value={values.description}
        onChangeText={(text) => set('description', text)}
        maxLength={200}
        error={shown.description !== undefined}
        style={styles.field}
      />
      <HelperText type="error" visible={shown.description !== undefined}>
        {t('manualInvoice.descriptionInvalid')}
      </HelperText>

      <TextInput
        mode="outlined"
        label={t('manualInvoice.amount')}
        value={values.amountText}
        onChangeText={(text) => set('amountText', text)}
        keyboardType="decimal-pad"
        left={<TextInput.Affix text="₹" />}
        error={shown.amount !== undefined}
      />
      <HelperText type="error" visible={shown.amount !== undefined}>
        {t('payment.amountInvalid')}
      </HelperText>

      <TextInput
        mode="outlined"
        label={t('manualInvoice.discount')}
        value={values.discountText}
        onChangeText={(text) => set('discountText', text)}
        keyboardType="decimal-pad"
        left={<TextInput.Affix text="₹" />}
        error={shown.discount !== undefined}
      />
      <HelperText type="error" visible={shown.discount !== undefined}>
        {t('manualInvoice.discountInvalid')}
      </HelperText>

      <View style={styles.row}>
        <Text variant="labelLarge">{t('manualInvoice.dueDate')}</Text>
        <Button mode="outlined" icon="calendar" onPress={() => setPickingDate(true)}>
          {formatLocalDate(values.dueDate, months)}
        </Button>
      </View>

      {create.isError && (
        <Text style={[styles.error, { color: theme.colors.error }]}>
          {errorMessage(t, create.error)}
        </Text>
      )}

      <Button
        mode="contained"
        onPress={submit}
        loading={create.isPending}
        disabled={create.isPending}
        style={styles.submit}
        contentStyle={styles.buttonContent}
      >
        {t('manualInvoice.create')}
      </Button>

      <DatePickerModal
        mode="single"
        locale={i18n.language}
        visible={pickingDate}
        label={t('manualInvoice.dueDate')}
        date={fromLocalDateString(values.dueDate)}
        onDismiss={() => setPickingDate(false)}
        onConfirm={({ date }) => {
          if (date) {
            set('dueDate', toLocalDateString(date));
          }
          setPickingDate(false);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16 },
  field: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: { marginTop: 12 },
  submit: { marginTop: 24 },
  buttonContent: { paddingVertical: 6 },
});
