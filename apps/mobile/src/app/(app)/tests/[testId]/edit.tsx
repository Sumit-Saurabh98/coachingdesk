// "Edit test" (owner, teacher): name, date or maximum. The maximum can't go below a mark
// already given (the API says which: details.highestMarks).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { TestForm } from '@/class-tests/test-form';
import {
  formatMarks,
  type TestFormValues,
  toTestUpdate,
  valuesFromTest,
} from '@/class-tests/test-rules';
import { getSheet, testKeys, updateTest } from '@/class-tests/tests-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';

export default function EditTestScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { testId } = useLocalSearchParams<{ testId: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  // Usually cached from the marks sheet.
  const sheet = useQuery({
    queryKey: testKeys.sheet(instituteId, testId),
    queryFn: ({ signal }) => getSheet(instituteId, testId, signal),
    enabled: instituteId !== '',
  });
  const save = useMutation({
    mutationFn: async (values: TestFormValues) => {
      const original = sheet.data?.test;
      const body = original ? toTestUpdate(original, values) : null;
      if (body) {
        await updateTest(instituteId, testId, body);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testKeys.all(instituteId) });
      router.back();
    },
  });

  if (current?.role !== 'owner' && current?.role !== 'teacher') {
    return <Redirect href="/" />;
  }
  if (!sheet.data) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  const failure = (error: unknown) => {
    const highest = error instanceof ApiError ? error.details.highestMarks : undefined;
    return typeof highest === 'number'
      ? t('testForm.maxBelowHighest', { highest: formatMarks(highest) })
      : errorMessage(t, error);
  };

  return (
    <TestForm
      initial={valuesFromTest(sheet.data.test)}
      submitLabel={t('testForm.save')}
      pending={save.isPending}
      error={save.isError ? failure(save.error) : null}
      onSubmit={(values) => save.mutate(values)}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
