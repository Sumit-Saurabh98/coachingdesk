// The test form, for "New test" and "Edit test": name, maximum marks, date.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { DatePickerModal } from 'react-native-paper-dates';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';
import { type TestFormValues, validateTestForm } from './test-rules';

export function TestForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  initial: TestFormValues;
  submitLabel: string;
  pending: boolean;
  error: string | null; // the last failed submit, in words (null = none)
  onSubmit: (values: TestFormValues) => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const [values, setValues] = useState<TestFormValues>(initial);
  const [tried, setTried] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const set = <K extends keyof TestFormValues>(field: K, value: TestFormValues[K]) =>
    setValues((v) => ({ ...v, [field]: value }));

  const errors = validateTestForm(values);
  const shown = tried ? errors : {};
  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length === 0 && !pending) {
      onSubmit(values);
    }
  };

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

      {error !== null && <Text style={[styles.error, { color: theme.colors.error }]}>{error}</Text>}

      <Button
        mode="contained"
        onPress={submit}
        loading={pending}
        disabled={pending}
        style={styles.submit}
        contentStyle={styles.buttonContent}
      >
        {submitLabel}
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
