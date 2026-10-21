// "New test" (owner, teacher): a name, the date it was written, and the maximum marks.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { DatePickerModal } from 'react-native-paper-dates';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { type TestFormValues, toTestRequest, validateTestForm } from '@/class-tests/test-rules';
import { createTest, testKeys } from '@/class-tests/tests-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';

export default function NewTestScreen() {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const queryClient = useQueryClient();
  const { id: batchId } = useLocalSearchParams<{ id: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  const [values, setValues] = useState<TestFormValues>(() => ({
    name: '',
    date: toLocalDateString(new Date()),
    maxMarksText: '',
  }));
  const [tried, setTried] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const set = <K extends keyof TestFormValues>(field: K, value: TestFormValues[K]) =>
    setValues((v) => ({ ...v, [field]: value }));

  const create = useMutation({
    mutationFn: () => createTest(instituteId, batchId, toTestRequest(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testKeys.all(instituteId) });
      router.back();
    },
  });

  // Staff manage batches but don't set tests (API_DOCS roles: owner and teacher write).
  if (current?.role !== 'owner' && current?.role !== 'teacher') {
    return <Redirect href="/" />;
  }

  const errors = validateTestForm(values);
  const shown = tried ? errors : {};
  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length === 0 && !create.isPending) {
      create.mutate();
    }
  };
  const failure = (error: unknown) =>
    error instanceof ApiError && error.code === 'FEATURE_NOT_IN_PLAN'
      ? t('tests.notInPlan')
      : errorMessage(t, error);

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <TextInput
        mode="outlined"
        label={t('testForm.name')}
        placeholder={t('testForm.nameExample')}
        value={values.name}
        onChangeText={(text) => set('name', text)}
        maxLength={80}
        error={shown.name !== undefined}
      />
      <HelperText type="error" visible={shown.name !== undefined}>
        {t('testForm.nameInvalid')}
      </HelperText>

      <TextInput
        mode="outlined"
        label={t('testForm.maxMarks')}
        value={values.maxMarksText}
        onChangeText={(text) => set('maxMarksText', text)}
        keyboardType="decimal-pad"
        error={shown.maxMarks !== undefined}
      />
      <HelperText type="error" visible={shown.maxMarks !== undefined}>
        {t('testForm.maxInvalid')}
      </HelperText>

      <View style={styles.row}>
        <Text variant="labelLarge">{t('testForm.date')}</Text>
        <Button mode="outlined" icon="calendar" onPress={() => setPickingDate(true)}>
          {formatLocalDate(values.date, months)}
        </Button>
      </View>

      {create.isError && (
        <Text style={[styles.error, { color: theme.colors.error }]}>{failure(create.error)}</Text>
      )}

      <Button
        mode="contained"
        onPress={submit}
        loading={create.isPending}
        disabled={create.isPending}
        style={styles.submit}
        contentStyle={styles.buttonContent}
      >
        {t('testForm.create')}
      </Button>

      <DatePickerModal
        mode="single"
        locale={i18n.language}
        visible={pickingDate}
        label={t('testForm.date')}
        date={fromLocalDateString(values.date)}
        onDismiss={() => setPickingDate(false)}
        onConfirm={({ date }) => {
          if (date) {
            set('date', toLocalDateString(date));
          }
          setPickingDate(false);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: { marginTop: 12 },
  submit: { marginTop: 24 },
  buttonContent: { paddingVertical: 6 },
});
