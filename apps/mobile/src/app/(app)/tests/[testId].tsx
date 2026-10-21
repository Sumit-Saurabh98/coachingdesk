// The marks sheet (every member reads; owner and teacher write): students in roll-number
// order, marks or absent for each, saved together. Class stats come from the server.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  HelperText,
  Text,
  TextInput,
} from 'react-native-paper';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import {
  type Entries,
  entryError,
  hasErrors,
  initialEntries,
  scoresToSend,
} from '@/class-tests/marks-sheet-rules';
import { formatMarks } from '@/class-tests/test-rules';
import { getSheet, type MarksSheet, saveScores, testKeys } from '@/class-tests/tests-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';

export default function MarksSheetScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { testId } = useLocalSearchParams<{ testId: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canWrite = current?.role === 'owner' || current?.role === 'teacher';
  // Bumped after a save: the form starts again from what the server now has.
  const [version, setVersion] = useState(0);

  const sheet = useQuery({
    queryKey: testKeys.sheet(instituteId, testId),
    queryFn: ({ signal }) => getSheet(instituteId, testId, signal),
    enabled: instituteId !== '',
  });

  if (!sheet.data) {
    return (
      <View style={styles.centered}>
        {sheet.isError ? (
          <>
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, sheet.error)}</Text>
            <Button mode="contained" onPress={() => void sheet.refetch()}>
              {t('common.retry')}
            </Button>
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }
  return (
    <SheetForm
      key={version}
      instituteId={instituteId}
      sheet={sheet.data}
      canWrite={canWrite}
      onSaved={() => setVersion((v) => v + 1)}
    />
  );
}

function SheetForm({
  instituteId,
  sheet,
  canWrite,
  onSaved,
}: {
  instituteId: string;
  sheet: MarksSheet;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const queryClient = useQueryClient();
  const { test, students: rows, stats } = sheet;
  const [entries, setEntries] = useState<Entries>(() => initialEntries(rows));
  const [tried, setTried] = useState(false);

  const setEntry = (studentId: string, change: Partial<Entries[string]>) =>
    setEntries((current) => ({
      ...current,
      [studentId]: { ...(current[studentId] ?? { text: '', absent: false }), ...change },
    }));

  const changes = scoresToSend(rows, entries);
  const save = useMutation({
    mutationFn: () => saveScores(instituteId, test.id, changes),
    onSuccess: async (saved) => {
      queryClient.setQueryData(testKeys.sheet(instituteId, test.id), saved);
      await queryClient.invalidateQueries({ queryKey: testKeys.batch(instituteId, test.batchId) });
      onSaved();
    },
  });
  const submit = () => {
    setTried(true);
    if (!hasErrors(rows, entries, test.maxMarks) && changes.length > 0 && !save.isPending) {
      save.mutate();
    }
  };
  const failure = (error: unknown) =>
    error instanceof ApiError && error.code === 'FEATURE_NOT_IN_PLAN'
      ? t('tests.notInPlan')
      : errorMessage(t, error);

  const stat = (label: string, value: number | null) => (
    <View style={styles.stat}>
      <Text variant="titleMedium">{value === null ? '–' : formatMarks(value)}</Text>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: test.name }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('tests.dateOutOf', {
            date: formatLocalDate(test.date, months),
            max: formatMarks(test.maxMarks),
          })}
        </Text>

        <Card mode="outlined">
          <Card.Content style={styles.stats}>
            {stat(t('marks.scored'), stats.scored)}
            {stat(t('marks.absent'), stats.absent)}
            {stat(t('marks.average'), stats.average)}
            {stat(t('marks.highest'), stats.highest)}
            {stat(t('marks.lowest'), stats.lowest)}
          </Card.Content>
        </Card>

        {rows.length === 0 && <Text style={styles.empty}>{t('marks.noStudents')}</Text>}

        {rows.map((row) => {
          const entry = entries[row.studentId] ?? { text: '', absent: false };
          const error = tried ? entryError(entry, row, test.maxMarks) : null;
          return (
            <View key={row.studentId} style={styles.row}>
              <Text variant="bodyLarge" style={styles.name} numberOfLines={2}>
                {row.rollNumber ? `${row.rollNumber} · ${row.name}` : row.name}
              </Text>
              {canWrite ? (
                <View style={styles.inputs}>
                  <TextInput
                    mode="outlined"
                    dense
                    value={entry.absent ? '' : entry.text}
                    onChangeText={(text) => setEntry(row.studentId, { text, absent: false })}
                    keyboardType="decimal-pad"
                    placeholder="–"
                    disabled={entry.absent}
                    error={error !== null}
                    style={styles.input}
                    accessibilityLabel={t('marks.marksFor', { name: row.name })}
                  />
                  <Chip
                    compact
                    selected={entry.absent}
                    showSelectedCheck={false}
                    onPress={() => setEntry(row.studentId, { absent: !entry.absent })}
                    style={entry.absent ? { backgroundColor: theme.colors.errorContainer } : null}
                  >
                    {t('marks.absentShort')}
                  </Chip>
                </View>
              ) : (
                <Text variant="titleMedium">
                  {row.isAbsent
                    ? t('marks.absent')
                    : row.marks === null
                      ? '–'
                      : formatMarks(row.marks)}
                </Text>
              )}
              {error && (
                <HelperText type="error" visible style={styles.rowError}>
                  {t(error, { max: formatMarks(test.maxMarks) })}
                </HelperText>
              )}
            </View>
          );
        })}
      </ScrollView>

      {canWrite && rows.length > 0 && (
        <View style={[styles.footer, { borderTopColor: theme.colors.outlineVariant }]}>
          {save.isError && (
            <Text style={[styles.saveError, { color: theme.colors.error }]}>
              {failure(save.error)}
            </Text>
          )}
          <Button
            mode="contained"
            icon="content-save"
            onPress={submit}
            loading={save.isPending}
            disabled={save.isPending || changes.length === 0}
            contentStyle={styles.buttonContent}
          >
            {changes.length === 0 ? t('marks.saved') : t('marks.save', { count: changes.length })}
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 16, gap: 8, paddingBottom: 24 },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center' },
  empty: { textAlign: 'center', padding: 24 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  name: { flex: 1 },
  inputs: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { width: 80, textAlign: 'center' },
  rowError: { width: '100%', textAlign: 'right' },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  saveError: { marginBottom: 8 },
  buttonContent: { paddingVertical: 6 },
});
