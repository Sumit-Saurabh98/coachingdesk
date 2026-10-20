// The batch form, shared by "New batch" and "Edit batch". It only holds and checks the values;
// the screen decides what "submit" does (create or update) and shows its progress.
import { FEE_CYCLES } from '@coachingdesk/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, Text, TextInput } from 'react-native-paper';
import { TimePickerModal } from 'react-native-paper-dates';
import { errorMessage } from '@/api/error-message';
import { useAppTheme } from '@/theme/theme';
import { type BatchFormValues, fromHHMM, toHHMM, validateBatchForm } from './batch-form-rules';
import { formatTime } from './schedule-format';
import { useScheduleLabels } from './use-schedule-labels';

interface Props {
  initial: BatchFormValues;
  submitLabel: string;
  pending: boolean;
  error: unknown; // the last failed submit, shown above the button (null = none)
  onSubmit: (values: BatchFormValues) => void;
}

export function BatchForm({ initial, submitLabel, pending, error, onSubmit }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const labels = useScheduleLabels();

  const [values, setValues] = useState(initial);
  const [triedToSubmit, setTriedToSubmit] = useState(false);
  // Which time the picker is editing right now (null = picker closed).
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  // Change one field, keep the rest. `K` ties the field name to its value's type.
  const set = <K extends keyof BatchFormValues>(field: K, value: BatchFormValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  const errors = validateBatchForm(values);
  // Only complain after the first submit attempt (not while the user is still typing).
  const shown = triedToSubmit ? errors : {};

  const toggleDay = (day: number) =>
    set(
      'days',
      values.days.includes(day) ? values.days.filter((d) => d !== day) : [...values.days, day],
    );

  const submit = () => {
    setTriedToSubmit(true);
    if (Object.keys(errors).length === 0 && !pending) {
      onSubmit(values);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <View>
        <TextInput
          mode="outlined"
          label={t('batchForm.nameLabel')}
          value={values.name}
          onChangeText={(text) => set('name', text)}
          error={shown.name !== undefined}
        />
        <HelperText type="error" visible={shown.name !== undefined}>
          {shown.name && t('batchForm.nameInvalid')}
        </HelperText>
      </View>

      <View>
        <TextInput
          mode="outlined"
          label={t('batchForm.subjectLabel')}
          value={values.subject}
          onChangeText={(text) => set('subject', text)}
          error={shown.subject !== undefined}
        />
        <HelperText type="error" visible={shown.subject !== undefined}>
          {shown.subject && t('batchForm.subjectInvalid')}
        </HelperText>
      </View>

      <Text variant="labelLarge">{t('batchForm.days')}</Text>
      {/* One chip per weekday, Monday first; tap to switch it on or off. */}
      <View style={styles.chips}>
        {labels.weekdays.map((label, index) => {
          const day = index + 1; // ISO weekday
          return (
            <Chip
              key={day}
              selected={values.days.includes(day)}
              showSelectedOverlay
              onPress={() => toggleDay(day)}
            >
              {label}
            </Chip>
          );
        })}
      </View>
      <HelperText type="error" visible={shown.days !== undefined}>
        {shown.days && t('batchForm.daysRequired')}
      </HelperText>

      <View style={styles.times}>
        <View style={styles.time}>
          <Text variant="labelLarge">{t('batchForm.starts')}</Text>
          <Button mode="outlined" icon="clock-outline" onPress={() => setPicking('start')}>
            {formatTime(values.start, labels)}
          </Button>
        </View>
        <View style={styles.time}>
          <Text variant="labelLarge">{t('batchForm.ends')}</Text>
          <Button mode="outlined" icon="clock-outline" onPress={() => setPicking('end')}>
            {formatTime(values.end, labels)}
          </Button>
        </View>
      </View>
      <HelperText type="error" visible={shown.time !== undefined}>
        {shown.time && t('batchForm.timeInvalid')}
      </HelperText>

      <View>
        <TextInput
          mode="outlined"
          label={t('batchForm.feeLabel')}
          value={values.feeRupees}
          // Digits only: no decimals (fees are in whole rupees), no commas or spaces.
          onChangeText={(text) => set('feeRupees', text.replace(/\D/g, ''))}
          left={<TextInput.Affix text="₹" />}
          keyboardType="number-pad"
          error={shown.fee !== undefined}
        />
        <HelperText type="error" visible={shown.fee !== undefined}>
          {shown.fee && t('batchForm.feeInvalid')}
        </HelperText>
      </View>

      <Text variant="labelLarge">{t('batchForm.feeCycleLabel')}</Text>
      <View style={styles.chips}>
        {FEE_CYCLES.map((cycle) => (
          <Chip
            key={cycle}
            selected={values.feeCycle === cycle}
            showSelectedOverlay
            onPress={() => set('feeCycle', cycle)}
          >
            {t(`feeCycleName.${cycle}`)}
          </Chip>
        ))}
      </View>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('batchForm.feeNote')}
      </Text>

      {error !== null && error !== undefined && (
        <Text style={{ color: theme.colors.error }}>{errorMessage(t, error)}</Text>
      )}

      <Button
        mode="contained"
        onPress={submit}
        loading={pending}
        disabled={pending}
        contentStyle={styles.buttonContent}
      >
        {submitLabel}
      </Button>

      {/* One picker, used for both times: `picking` says which one it's editing. */}
      <TimePickerModal
        visible={picking !== null}
        locale={i18n.language}
        label={picking === 'end' ? t('batchForm.pickEnd') : t('batchForm.pickStart')}
        {...fromHHMM(picking === 'end' ? values.end : values.start)}
        onDismiss={() => setPicking(null)}
        onConfirm={({ hours, minutes }) => {
          if (picking) {
            set(picking, toHHMM(hours, minutes));
          }
          setPicking(null);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  times: { flexDirection: 'row', gap: 16, marginTop: 8 },
  time: { flex: 1, gap: 4 },
  buttonContent: { paddingVertical: 6 },
});
