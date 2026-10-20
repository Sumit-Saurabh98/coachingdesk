// "New batch" (owner, staff).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BatchForm } from '@/batches/batch-form';
import { NEW_BATCH, toCreateBody } from '@/batches/batch-form-rules';
import { batchKeys, createBatch } from '@/batches/batches-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';

export default function NewBatchScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  const create = useMutation({
    mutationFn: (body: ReturnType<typeof toCreateBody>) => createBatch(instituteId, body),
    onSuccess: async (batch) => {
      // Every batch list of this institute is now out of date: refetch them.
      await queryClient.invalidateQueries({ queryKey: batchKeys.all(instituteId) });
      // Open the new batch. replace(): "back" from it goes to the list, not to this form.
      router.replace({ pathname: '/batches/[id]', params: { id: batch.id } });
    },
  });

  // Teachers can't create batches (the API would say 403): don't even show the form.
  if (current?.role !== 'owner' && current?.role !== 'staff') {
    return <Redirect href="/batches" />;
  }

  return (
    <BatchForm
      initial={NEW_BATCH}
      submitLabel={t('batchForm.create')}
      pending={create.isPending}
      error={create.error}
      onSubmit={(values) => create.mutate(toCreateBody(values))}
    />
  );
}
