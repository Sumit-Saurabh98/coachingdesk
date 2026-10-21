// A student's test results on their profile (any member): newest first.
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Button, List, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { formatLocalDate } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';
import { formatMarks } from './test-rules';
import { listStudentResults, testKeys } from './tests-api';

export function StudentResults({
  instituteId,
  studentId,
  batchName,
}: {
  instituteId: string;
  studentId: string;
  batchName: (batchId: string) => string;
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const results = useQuery({
    queryKey: testKeys.student(instituteId, studentId),
    queryFn: ({ signal }) => listStudentResults(instituteId, studentId, signal),
    enabled: instituteId !== '',
  });

  return (
    <List.Section>
      <List.Subheader>{t('results.title')}</List.Subheader>
      {!results.data ? (
        results.isError ? (
          <>
            <Text style={{ color: theme.colors.error, paddingHorizontal: 16 }}>
              {errorMessage(t, results.error)}
            </Text>
            <Button onPress={() => void results.refetch()}>{t('common.retry')}</Button>
          </>
        ) : (
          <ActivityIndicator />
        )
      ) : (
        <>
          {results.data.length === 0 && <List.Item title={t('results.none')} />}
          {results.data.map(({ test, marks, isAbsent }) => (
            <List.Item
              key={test.id}
              title={test.name}
              description={`${formatLocalDate(test.date, months)} · ${batchName(test.batchId)}`}
              left={(props) => <List.Icon {...props} icon="clipboard-check-outline" />}
              right={() => (
                <Text
                  variant="titleMedium"
                  style={{
                    alignSelf: 'center',
                    color: isAbsent ? theme.colors.onSurfaceVariant : theme.colors.onSurface,
                  }}
                >
                  {isAbsent
                    ? t('marks.absent')
                    : marks === null
                      ? '–'
                      : `${formatMarks(marks)} / ${formatMarks(test.maxMarks)}`}
                </Text>
              )}
              onPress={() =>
                router.push({ pathname: '/tests/[testId]', params: { testId: test.id } })
              }
            />
          ))}
        </>
      )}
    </List.Section>
  );
}
