// "Edit student" (owner, staff): name, guardian, phone, joining date, notes. Sends only what
// changed. A NEW phone number has no WhatsApp consent yet, so the consent question comes back.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  HelperText,
  Text,
  TextInput,
} from 'react-native-paper';
import { DatePickerModal } from 'react-native-paper-dates';
import { errorMessage } from '@/api/error-message';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '@/lib/date-format';
import { formatIndianPhone } from '@/lib/phone-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import {
  type EditableStudent,
  isValidIndianPhone,
  samePhone,
  type StudentFormValues,
  toUpdateStudentRequest,
  validateStudentForm,
  valuesFromStudent,
} from '@/students/student-form-rules';
import { getStudent, recordConsent, studentKeys, updateStudent } from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';

export default function EditStudentScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  // Usually already cached from the profile screen: no spinner then.
  const detail = useQuery({
    queryKey: studentKeys.detail(instituteId, id),
    queryFn: ({ signal }) => getStudent(instituteId, id, signal),
    enabled: instituteId !== '',
  });

  if (current?.role !== 'owner' && current?.role !== 'staff') {
    return <Redirect href="/students" />;
  }
  // Saved data (also from the phone, when offline) wins over a failed refresh.
  if (!detail.data) {
    if (detail.isError) {
      return (
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.error }}>{errorMessage(t, detail.error)}</Text>
          <Button mode="contained" onPress={() => void detail.refetch()}>
            {t('common.retry')}
          </Button>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  // The form gets the student once loaded, and keeps its own copy while the user edits
  // (a background refresh never wipes what they typed).
  return <EditForm instituteId={instituteId} studentId={id} original={detail.data.student} />;
}

function EditForm({
  instituteId,
  studentId,
  original,
}: {
  instituteId: string;
  studentId: string;
  original: EditableStudent;
}) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<StudentFormValues>(() => ({
    ...valuesFromStudent(original),
    // Shown the way people write it; samePhone() still sees it as the same number.
    guardianPhone: formatIndianPhone(original.guardianPhone),
  }));
  const [triedToSubmit, setTriedToSubmit] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const set = <K extends keyof StudentFormValues>(field: K, value: StudentFormValues[K]) =>
    setValues((currentValues) => ({ ...currentValues, [field]: value }));

  // A different (valid) number than before: its consent has to be asked again.
  const newNumber =
    isValidIndianPhone(values.guardianPhone) &&
    !samePhone(values.guardianPhone, original.guardianPhone);

  const save = useMutation({
    mutationFn: async () => {
      const body = toUpdateStudentRequest(original, values);
      if (body !== null) {
        await updateStudent(instituteId, studentId, body);
      }
      // After the number is saved: record the parent's "yes" for the NEW number.
      if (newNumber && values.guardianConsent) {
        await recordConsent(instituteId, values.guardianPhone.trim());
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) });
      router.back();
    },
  });

  const errors = validateStudentForm(values);
  const shown = triedToSubmit ? errors : {};
  const submit = () => {
    setTriedToSubmit(true);
    if (Object.keys(errors).length === 0 && !save.isPending) {
      save.mutate();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
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
        error={shown.guardianPhone !== undefined}
      />
      <HelperText type="error" visible={shown.guardianPhone !== undefined}>
        {t('studentForm.phoneInvalid')}
      </HelperText>

      {/* Only when the number changed: consent belongs to a number (KB "Messaging"). */}
      {newNumber && (
        <>
          <Checkbox.Item
            label={t('studentEdit.newNumberConsent')}
            status={values.guardianConsent ? 'checked' : 'unchecked'}
            onPress={() => set('guardianConsent', !values.guardianConsent)}
            position="leading"
            labelVariant="bodyMedium"
            style={styles.checkbox}
          />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('studentEdit.newNumberHelp')}
          </Text>
        </>
      )}

      <View style={styles.row}>
        <Text variant="labelLarge">{t('studentForm.joinedOn')}</Text>
        <Button mode="outlined" icon="calendar" onPress={() => setPickingDate(true)}>
          {values.joinedOn ? formatLocalDate(values.joinedOn, months) : ''}
        </Button>
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

      {save.isError && (
        <Text style={{ color: theme.colors.error }}>{errorMessage(t, save.error)}</Text>
      )}

      <Button
        mode="contained"
        onPress={submit}
        loading={save.isPending}
        disabled={save.isPending}
        style={styles.submit}
        contentStyle={styles.buttonContent}
      >
        {t('studentEdit.save')}
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  form: { padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  notes: { minHeight: 80, marginTop: 16 },
  checkbox: { paddingHorizontal: 0 },
  submit: { marginTop: 16 },
  buttonContent: { paddingVertical: 6 },
});
