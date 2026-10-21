// "Edit batch" (owner, staff). Sends ONLY the fields that changed (the API's PATCH style).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { BatchForm } from '@/batches/batch-form';
import { type BatchFormValues, toUpdateBody, valuesFromBatch } from '@/batches/batch-form-rules';
import { batchKeys, getBatch, updateBatch } from '@/batches/batches-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { useAppTheme } from '@/theme/theme';

export default function EditBatchScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';

  // Usually already in the cache from the details screen: no loading spinner then.
  const detail = useQuery({
    queryKey: batchKeys.detail(instituteId, id),
    queryFn: ({ signal }) => getBatch(instituteId, id, signal),
    enabled: instituteId !== '',
  });

  const save = useMutation({
    mutationFn: async (values: BatchFormValues) => {
      if (!detail.data) {
        return;
      }
      const body = toUpdateBody(detail.data.batch, values);
      if (body !== null) {
        await updateBatch(instituteId, id, body); // nothing changed: no request at all
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: batchKeys.all(instituteId) });
      router.back();
    },
  });

  if (current?.role !== 'owner' && current?.role !== 'staff') {
    return <Redirect href="/batches" />;
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

  return (
    <BatchForm
      // The form copies `initial` ONCE (its own state). A background refresh of the batch
      // (e.g. coming back to the app) doesn't wipe what the user is typing.
      initial={valuesFromBatch(detail.data.batch)}
      submitLabel={t('batchForm.save')}
      pending={save.isPending}
      error={save.error}
      onSubmit={(values) => save.mutate(values)}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
});
