// "Add student" (owner, staff): the student, their guardian's number, the batches they join,
// and the guardian's WhatsApp consent. One request: the API creates the student and the
// enrollments together (or nothing, e.g. when the plan's student limit is reached).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Chip, HelperText, Text, TextInput } from 'react-native-paper';
import { DatePickerModal } from 'react-native-paper-dates';
import { errorMessage } from '@/api/error-message';
import { batchKeys, listBatches } from '@/batches/batches-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import {
  isRollNumberTaken,
  NEW_STUDENT,
  type StudentFormValues,
  toCreateStudentRequest,
  validateStudentForm,
} from '@/students/student-form-rules';
import { createStudent, studentKeys } from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';

export default function NewStudentScreen() {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const queryClient = useQueryClient();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  const [values, setValues] = useState<StudentFormValues>(NEW_STUDENT);
  const [triedToSubmit, setTriedToSubmit] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const set = <K extends keyof StudentFormValues>(field: K, value: StudentFormValues[K]) =>
    setValues((currentValues) => ({ ...currentValues, [field]: value }));

  // The batches the student can join: active ones only (archived batches take no one new).
  const batches = useQuery({
    queryKey: batchKeys.list(instituteId, false),
    queryFn: ({ signal }) => listBatches(instituteId, false, signal),
    enabled: instituteId !== '',
  });

  const create = useMutation({
    mutationFn: () => createStudent(instituteId, toCreateStudentRequest(values)),
    onSuccess: async () => {
      // A new student changes the student lists AND each joined batch's "enrolled today".
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) }),
        queryClient.invalidateQueries({ queryKey: batchKeys.all(instituteId) }),
      ]);
      router.back();
    },
  });

  if (current?.role !== 'owner' && current?.role !== 'staff') {
    return <Redirect href="/students" />;
  }

  const errors = validateStudentForm(values);
  const shown = triedToSubmit ? errors : {};
  // 409: another active student already has this roll number (shown under the field).
  const rollTaken = create.isError && isRollNumberTaken(create.error);
  const submit = () => {
    setTriedToSubmit(true);
    if (Object.keys(errors).length === 0 && !create.isPending) {
      create.mutate();
    }
  };
  const toggleBatch = (batchId: string) =>
    set(
      'batchIds',
      values.batchIds.includes(batchId)
        ? values.batchIds.filter((id) => id !== batchId)
        : [...values.batchIds, batchId],
    );

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Button
        mode="text"
        icon="text-box-multiple-outline"
        style={styles.bulk}
        onPress={() => router.replace('/students/bulk')}
      >
        {t('bulkAdd.open')}
      </Button>
      <TextInput
        mode="outlined"
        label={t('studentForm.nameLabel')}
        value={values.name}
        onChangeText={(text) => set('name', text)}
        autoCapitalize="words"
        error={shown.name !== undefined}
      />
      <HelperText type="error" visible={shown.name !== undefined}>
        {t('studentForm.nameInvalid')}
      </HelperText>

      <TextInput
        mode="outlined"
        label={t('studentForm.rollLabel')}
        value={values.rollNumber}
        onChangeText={(text) => set('rollNumber', text)}
        autoCapitalize="characters"
        maxLength={20}
        error={shown.rollNumber !== undefined || rollTaken}
      />
      <HelperText type="error" visible={shown.rollNumber !== undefined || rollTaken}>
        {rollTaken ? t('studentForm.rollTaken') : t('studentForm.rollInvalid')}
      </HelperText>

      <TextInput
        mode="outlined"
        label={t('studentForm.guardianNameLabel')}
        value={values.guardianName}
        onChangeText={(text) => set('guardianName', text)}
        autoCapitalize="words"
        error={shown.guardianName !== undefined}
      />
      <HelperText type="error" visible={shown.guardianName !== undefined}>
        {t('studentForm.guardianNameInvalid')}
      </HelperText>

      <TextInput
        mode="outlined"
        label={t('studentForm.phoneLabel')}
        value={values.guardianPhone}
        onChangeText={(text) => set('guardianPhone', text)}
        keyboardType="phone-pad"
        autoComplete="tel"
        error={shown.guardianPhone !== undefined}
      />
      {/* Error when wrong; otherwise WHY we need this number. */}
      <HelperText type={shown.guardianPhone !== undefined ? 'error' : 'info'} visible>
        {shown.guardianPhone !== undefined
          ? t('studentForm.phoneInvalid')
          : t('studentForm.phoneHelp')}
      </HelperText>

      <View style={styles.row}>
        <Text variant="labelLarge">{t('studentForm.joinedOn')}</Text>
        <Button mode="outlined" icon="calendar" onPress={() => setPickingDate(true)}>
          {values.joinedOn ? formatLocalDate(values.joinedOn, months) : t('studentForm.today')}
        </Button>
      </View>

      <Text variant="labelLarge" style={styles.sectionLabel}>
        {t('studentForm.batches')}
      </Text>
      {batches.data && batches.data.length === 0 && (
        <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('studentForm.noBatches')}</Text>
      )}
      <View style={styles.chips}>
        {batches.data?.map((batch) => (
          <Chip
            key={batch.id}
            selected={values.batchIds.includes(batch.id)}
            showSelectedOverlay
            onPress={() => toggleBatch(batch.id)}
          >
            {batch.name}
          </Chip>
        ))}
      </View>

      <TextInput
        mode="outlined"
        label={t('studentForm.notesLabel')}
        value={values.notes}
        onChangeText={(text) => set('notes', text)}
        multiline
        style={styles.notes}
        error={shown.notes !== undefined}
      />
      <HelperText type="error" visible={shown.notes !== undefined}>
        {t('studentForm.notesInvalid')}
      </HelperText>

      {/* Consent (KB "Messaging"): the owner confirms the parent said yes. Never pre-ticked. */}
      <Checkbox.Item
        label={t('studentForm.consent')}
        status={values.guardianConsent ? 'checked' : 'unchecked'}
        onPress={() => set('guardianConsent', !values.guardianConsent)}
        position="leading"
        labelVariant="bodyMedium"
        style={styles.checkbox}
      />
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('studentForm.consentHelp')}
      </Text>

      {create.isError && !rollTaken && (
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
        {t('studentForm.create')}
      </Button>

      <DatePickerModal
        mode="single"
        locale={i18n.language}
        visible={pickingDate}
        label={t('studentForm.pickJoined')}
        date={values.joinedOn ? fromLocalDateString(values.joinedOn) : new Date()}
        onDismiss={() => setPickingDate(false)}
        onConfirm={({ date }) => {
          if (date) {
            set('joinedOn', toLocalDateString(date));
          }
          setPickingDate(false);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16 },
  bulk: { alignSelf: 'flex-start', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  notes: { minHeight: 80 },
  checkbox: { paddingHorizontal: 0 },
  error: { marginTop: 8 },
  submit: { marginTop: 16 },
  buttonContent: { paddingVertical: 6 },
});
