// Owner only: waive what's left (scholarship, hardship) or cancel an invoice made by mistake.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { studentKeys } from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';
import { cancelInvoice, feeKeys, type Invoice, waiveInvoice } from './fees-api';
import { canCancel, canWaive } from './owner-actions-rules';
import { ReasonDialog } from './reason-dialog';
import { rupees } from './rupees';

type Action = 'waive' | 'cancel';

export function InvoiceOwnerActions({
  instituteId,
  invoice,
}: {
  instituteId: string;
  invoice: Invoice;
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);

  const run = useMutation({
    mutationFn: ({ kind, reason }: { kind: Action; reason: string }) =>
      kind === 'waive'
        ? waiveInvoice(instituteId, invoice.id, reason)
        : cancelInvoice(instituteId, invoice.id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: feeKeys.all(instituteId) }),
        queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) }),
      ]);
      setAction(null);
    },
  });

  if (!canWaive(invoice) && !canCancel(invoice)) {
    return null;
  }
  const failure = run.error
    ? // 409: it changed meanwhile (e.g. a payment arrived): reload and look again.
      run.error instanceof ApiError && run.error.status === 409
      ? t('ownerActions.conflict')
      : errorMessage(t, run.error)
    : null;

  return (
    <View style={styles.row}>
      {canWaive(invoice) && (
        <Button
          icon="hand-heart-outline"
          textColor={theme.colors.error}
          onPress={() => {
            run.reset();
            setAction('waive');
          }}
        >
          {t('ownerActions.waive')}
        </Button>
      )}
      {canCancel(invoice) && (
        <Button
          icon="file-cancel-outline"
          textColor={theme.colors.error}
          onPress={() => {
            run.reset();
            setAction('cancel');
          }}
        >
          {t('ownerActions.cancel')}
        </Button>
      )}
      {action !== null && (
        <ReasonDialog
          visible={action !== null}
          title={action === 'cancel' ? t('ownerActions.cancelTitle') : t('ownerActions.waiveTitle')}
          body={
            action === 'cancel'
              ? t('ownerActions.cancelBody')
              : t('ownerActions.waiveBody', { amount: rupees(invoice.remainingPaise) })
          }
          confirmLabel={action === 'cancel' ? t('ownerActions.cancel') : t('ownerActions.waive')}
          pending={run.isPending}
          error={failure}
          onConfirm={(reason) => action && run.mutate({ kind: action, reason })}
          onDismiss={() => setAction(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
