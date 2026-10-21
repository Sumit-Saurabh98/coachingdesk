// A batch's tests (any member reads): newest first, with how far marking has got.
// Owner and teacher create them; marks and results come in the next screens.
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Button, Chip, List, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { formatLocalDate } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';
import { formatMarks } from './test-rules';
import { listBatchTests, testKeys } from './tests-api';

export function BatchTests({
  instituteId,
  batchId,
  canCreate,
}: {
  instituteId: string;
  batchId: string;
  canCreate: boolean; // owner or teacher, and the batch isn't archived
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const tests = useQuery({
    queryKey: testKeys.batch(instituteId, batchId),
    queryFn: ({ signal }) => listBatchTests(instituteId, batchId, signal),
    enabled: instituteId !== '',
  });

  return (
    <List.Section>
      <List.Subheader>{t('tests.title')}</List.Subheader>
      {!tests.data ? (
        tests.isError ? (
          <>
            <Text style={{ color: theme.colors.error, paddingHorizontal: 16 }}>
              {errorMessage(t, tests.error)}
            </Text>
            <Button onPress={() => void tests.refetch()}>{t('common.retry')}</Button>
          </>
        ) : (
          <ActivityIndicator />
        )
      ) : (
        <>
          {tests.data.length === 0 && <List.Item title={t('tests.empty')} />}
          {tests.data.map((test) => (
            <List.Item
              key={test.id}
              title={test.name}
              description={[
                t('tests.dateOutOf', {
                  date: formatLocalDate(test.date, months),
                  max: formatMarks(test.maxMarks),
                }),
                t('tests.progress', { scored: test.scored, absent: test.absent }),
              ].join('\n')}
              descriptionNumberOfLines={2}
              left={(props) => <List.Icon {...props} icon="clipboard-text-outline" />}
              onPress={() =>
                router.push({ pathname: '/tests/[testId]', params: { testId: test.id } })
              }
              right={() =>
                test.resultsSentAt ? (
                  <Chip
                    compact
                    icon="send-check"
                    style={{ alignSelf: 'center', backgroundColor: theme.colors.successContainer }}
                    textStyle={{ color: theme.colors.onSuccessContainer }}
                  >
                    {t('tests.sent')}
                  </Chip>
                ) : null
              }
            />
          ))}
        </>
      )}
      {canCreate && (
        <Button
          icon="plus"
          onPress={() =>
            router.push({ pathname: '/batches/[id]/tests/new', params: { id: batchId } })
          }
        >
          {t('tests.new')}
        </Button>
      )}
    </List.Section>
  );
}
