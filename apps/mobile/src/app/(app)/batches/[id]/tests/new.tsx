// "New test" (owner, teacher): a name, the date it was written, and the maximum marks.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { TestForm } from '@/class-tests/test-form';
import { type TestFormValues, toTestRequest } from '@/class-tests/test-rules';
import { createTest, testKeys } from '@/class-tests/tests-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { toLocalDateString } from '@/lib/date-format';

export default function NewTestScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { id: batchId } = useLocalSearchParams<{ id: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const [initial] = useState<TestFormValues>(() => ({
    name: '',
    date: toLocalDateString(new Date()),
    maxMarksText: '',
  }));

  const create = useMutation({
    mutationFn: (values: TestFormValues) => createTest(instituteId, batchId, toTestRequest(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testKeys.all(instituteId) });
      router.back();
    },
  });

  // Staff manage batches but don't set tests (API_DOCS roles: owner and teacher write).
  if (current?.role !== 'owner' && current?.role !== 'teacher') {
    return <Redirect href="/" />;
  }
  const failure = (error: unknown) =>
    error instanceof ApiError && error.code === 'FEATURE_NOT_IN_PLAN'
      ? t('tests.notInPlan')
      : errorMessage(t, error);

  return (
    <TestForm
      initial={initial}
      submitLabel={t('testForm.create')}
      pending={create.isPending}
      error={create.isError ? failure(create.error) : null}
      onSubmit={(values) => create.mutate(values)}
    />
  );
}
