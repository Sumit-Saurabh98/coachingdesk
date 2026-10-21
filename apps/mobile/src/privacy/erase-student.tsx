// "Delete this student's personal data" (owner, a parent's request under DPDP): name, parent,
// phones and notes go for good; invoices and payments keep their amounts. Can't be undone.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { studentKeys } from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';
import { eraseStudent } from './privacy-api';

export function EraseStudent({
  instituteId,
  studentId,
  name,
}: {
  instituteId: string;
  studentId: string;
  name: string;
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const erase = useMutation({
    mutationFn: () => eraseStudent(instituteId, studentId),
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) });
    },
  });

  return (
    <>
      <Button
        icon="account-remove-outline"
        textColor={theme.colors.error}
        onPress={() => {
          erase.reset();
          setConfirming(true);
        }}
      >
        {t('erase.button')}
      </Button>
      <Portal>
        <Dialog visible={confirming} onDismiss={() => setConfirming(false)}>
          <Dialog.Title>{t('erase.title', { name })}</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text variant="bodyMedium">{t('erase.body')}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.error }}>
              {t('erase.warning')}
            </Text>
            {erase.isError && (
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, erase.error)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button
              textColor={theme.colors.error}
              loading={erase.isPending}
              disabled={erase.isPending}
              onPress={() => erase.mutate()}
            >
              {t('erase.confirm')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}
