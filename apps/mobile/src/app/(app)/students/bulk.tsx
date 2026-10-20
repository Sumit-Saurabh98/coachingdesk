// "Add many students" (owner, staff): paste "Name, Phone" lines (FR-2.2). One request; the API
// creates the good rows and reports the bad ones, which can be fixed and sent again. No
// contacts permission is ever asked for: the owner pastes what they already have.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, HelperText, Text, TextInput } from 'react-native-paper';
import { DatePickerModal } from 'react-native-paper-dates';
import { errorMessage } from '@/api/error-message';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import {
  BULK_STUDENTS_MAX,
  failedRowsText,
  failureMessageKey,
  lineOf,
  type PastedRow,
  parsePastedList,
  toLine,
} from '@/students/bulk-paste-rules';
import { type BulkCreateResult, bulkCreateStudents, studentKeys } from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';

export default function BulkAddStudentsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const queryClient = useQueryClient();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  const [text, setText] = useState('');
  const [joinedOn, setJoinedOn] = useState<string | null>(null); // null = today (API default)
  const [consent, setConsent] = useState(false); // never pre-ticked (KB "Messaging")
  const [pickingDate, setPickingDate] = useState(false);
  const [triedToSubmit, setTriedToSubmit] = useState(false);
  // The last answer, with the rows it was for (its row numbers point into THOSE rows).
  const [outcome, setOutcome] = useState<{ result: BulkCreateResult; rows: PastedRow[] } | null>(
    null,
  );

  const rows = parsePastedList(text);
  const problem =
    rows.length === 0
      ? t('bulkAdd.empty')
      : rows.length > BULK_STUDENTS_MAX
        ? t('bulkAdd.tooMany', { max: BULK_STUDENTS_MAX })
        : null;

  const add = useMutation({
    mutationFn: (sent: PastedRow[]) =>
      bulkCreateStudents(instituteId, {
        rows: sent.map(({ line: _line, ...row }) => row),
        ...(joinedOn ? { joinedOn } : {}),
        guardianConsent: consent,
      }),
    onSuccess: async (result, sent) => {
      await queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) });
      if (result.failed.length === 0) {
        router.back();
      } else {
        setOutcome({ result, rows: sent });
      }
    },
  });

  if (current?.role !== 'owner' && current?.role !== 'staff') {
    return <Redirect href="/students" />;
  }

  const submit = () => {
    setTriedToSubmit(true);
    if (problem === null && !add.isPending) {
      add.mutate(rows);
    }
  };

  if (outcome) {
    const { result, rows: sent } = outcome;
    return (
      <ScrollView contentContainerStyle={styles.form}>
        <Text variant="titleMedium" style={{ color: theme.colors.success }}>
          {t('bulkAdd.added', { count: result.created })}
        </Text>
        <Text variant="bodyLarge" style={[styles.failedTitle, { color: theme.colors.error }]}>
          {t('bulkAdd.failedTitle', { count: result.failed.length })}
        </Text>
        {result.failed.map((failure) => (
          <Card key={failure.row} mode="outlined" style={styles.failure}>
            <Card.Content>
              <Text variant="bodyMedium">
                {t('bulkAdd.line', { line: lineOf(failure, sent), text: toLine(failure.input) })}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.error }}>
                {t(failureMessageKey(failure.field))}
              </Text>
            </Card.Content>
          </Card>
        ))}
        <Button
          mode="contained"
          icon="pencil"
          style={styles.submit}
          contentStyle={styles.buttonContent}
          onPress={() => {
            // Only the failed lines go back into the box; the added students stay added.
            setText(failedRowsText(result.failed));
            setTriedToSubmit(false);
            setOutcome(null);
          }}
        >
          {t('bulkAdd.fixFailed')}
        </Button>
        <Button mode="text" style={styles.submit} onPress={() => router.back()}>
          {t('bulkAdd.done')}
        </Button>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('bulkAdd.help')}
      </Text>
      <TextInput
        mode="outlined"
        label={t('bulkAdd.label')}
        placeholder={t('bulkAdd.example')}
        value={text}
        onChangeText={setText}
        multiline
        autoCapitalize="words"
        autoCorrect={false}
        style={styles.list}
        error={triedToSubmit && problem !== null}
      />
      <HelperText type={triedToSubmit && problem !== null ? 'error' : 'info'} visible>
        {triedToSubmit && problem !== null ? problem : t('bulkAdd.found', { count: rows.length })}
      </HelperText>

      <View style={styles.row}>
        <Text variant="labelLarge">{t('studentForm.joinedOn')}</Text>
        <Button mode="outlined" icon="calendar" onPress={() => setPickingDate(true)}>
          {joinedOn ? formatLocalDate(joinedOn, months) : t('studentForm.today')}
        </Button>
      </View>

      <Checkbox.Item
        label={t('bulkAdd.consent')}
        status={consent ? 'checked' : 'unchecked'}
        onPress={() => setConsent(!consent)}
        position="leading"
        labelVariant="bodyMedium"
        style={styles.checkbox}
      />
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('studentForm.consentHelp')}
      </Text>

      {add.isError && (
        <Text style={[styles.error, { color: theme.colors.error }]}>
          {errorMessage(t, add.error)}
        </Text>
      )}

      <Button
        mode="contained"
        onPress={submit}
        loading={add.isPending}
        disabled={add.isPending}
        style={styles.submit}
        contentStyle={styles.buttonContent}
      >
        {t('bulkAdd.submit')}
      </Button>

      <DatePickerModal
        mode="single"
        locale={i18n.language}
        visible={pickingDate}
        label={t('studentForm.pickJoined')}
        date={joinedOn ? fromLocalDateString(joinedOn) : new Date()}
        onDismiss={() => setPickingDate(false)}
        onConfirm={({ date }) => {
          if (date) {
            setJoinedOn(toLocalDateString(date));
          }
          setPickingDate(false);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, gap: 4 },
  list: { minHeight: 180, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkbox: { paddingHorizontal: 0, marginTop: 8 },
  failedTitle: { marginTop: 16, marginBottom: 8 },
  failure: { marginBottom: 8 },
  error: { marginTop: 8 },
  submit: { marginTop: 16 },
  buttonContent: { paddingVertical: 6 },
});
