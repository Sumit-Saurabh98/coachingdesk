// What owner and staff can do about an OPEN invoice besides recording a payment: remind the
// parent on WhatsApp (sent by the server), message them by hand, or pay from family credit.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Snackbar, Text } from 'react-native-paper';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { formatTime } from '@/batches/schedule-format';
import { useScheduleLabels } from '@/batches/use-schedule-labels';
import { nowHHMM } from '@/attendance/today-rules';
import { formatLocalDate } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { getStudent, studentKeys } from '@/students/students-api';
import { applyCredit, feeKeys, type Invoice, sendReminder } from './fees-api';
import { reminderTiming, remindRefusal, whatsAppMessageLink } from './reminder-rules';
import { rupees } from './rupees';

export function InvoiceActions({
  instituteId,
  instituteName,
  isOwner,
  invoice,
}: {
  instituteId: string;
  instituteName: string;
  isOwner: boolean;
  invoice: Invoice;
}) {
  const { t } = useTranslation();
  const labels = useScheduleLabels();
  const months = useMonthLabels();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [askForce, setAskForce] = useState(false);

  // The parent's number and the family credit (usually cached from the profile).
  const student = useQuery({
    queryKey: studentKeys.detail(instituteId, invoice.studentId),
    queryFn: ({ signal }) => getStudent(instituteId, invoice.studentId, signal),
  });
  const credit = student.data?.guardianCreditPaise ?? 0;
  const phone = student.data?.student.guardianPhone ?? null;

  const remind = useMutation({
    mutationFn: (force: boolean) => sendReminder(instituteId, invoice.id, force),
    onSuccess: ({ scheduledFor }) => {
      setNotice(
        reminderTiming(scheduledFor, new Date()) === 'now'
          ? t('invoiceActions.reminded')
          : t('invoiceActions.remindLater', {
              time: formatTime(nowHHMM(new Date(scheduledFor)), labels),
            }),
      );
    },
    onError: (error) => {
      const refusal = error instanceof ApiError ? remindRefusal(error) : null;
      if (refusal === 'alreadyToday' && isOwner) {
        setAskForce(true); // the owner may send one extra today
        return;
      }
      setNotice(refusal ? t(`invoiceActions.${refusal}`) : errorMessage(t, error));
    },
  });

  const payFromCredit = useMutation({
    mutationFn: () => applyCredit(instituteId, invoice.id),
    onSuccess: async ({ appliedPaise }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: feeKeys.all(instituteId) }),
        queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) }),
      ]);
      setNotice(t('invoiceActions.creditApplied', { amount: rupees(appliedPaise) }));
    },
    onError: (error) => setNotice(errorMessage(t, error)),
  });

  const messageParent = () => {
    if (!phone) {
      return;
    }
    const text = t('invoiceActions.parentMessage', {
      student: invoice.studentName ?? '',
      description: invoice.description,
      amount: rupees(invoice.remainingPaise),
      date: formatLocalDate(invoice.dueDate, months),
      institute: instituteName,
    });
    void Linking.openURL(whatsAppMessageLink(phone, text));
  };

  return (
    <View style={styles.actions}>
      {credit > 0 && (
        <Button
          mode="contained-tonal"
          icon="wallet-outline"
          loading={payFromCredit.isPending}
          disabled={payFromCredit.isPending}
          onPress={() => payFromCredit.mutate()}
        >
          {t('invoiceActions.payFromCredit', { amount: rupees(credit) })}
        </Button>
      )}
      <View style={styles.row}>
        <Button
          mode="outlined"
          icon="bell-ring-outline"
          style={styles.half}
          loading={remind.isPending}
          disabled={remind.isPending}
          onPress={() => remind.mutate(false)}
        >
          {t('invoiceActions.remind')}
        </Button>
        <Button
          mode="outlined"
          icon="whatsapp"
          style={styles.half}
          disabled={!phone}
          onPress={messageParent}
        >
          {t('invoiceActions.messageParent')}
        </Button>
      </View>
      <Text variant="bodySmall" style={styles.help}>
        {t('invoiceActions.help')}
      </Text>

      <Portal>
        <Dialog visible={askForce} onDismiss={() => setAskForce(false)}>
          <Dialog.Title>{t('invoiceActions.forceTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('invoiceActions.forceBody')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAskForce(false)}>{t('common.cancel')}</Button>
            <Button
              onPress={() => {
                setAskForce(false);
                remind.mutate(true);
              }}
            >
              {t('invoiceActions.forceSend')}
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Snackbar visible={notice !== null} onDismiss={() => setNotice(null)} duration={5000}>
          {notice ?? ''}
        </Snackbar>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  help: { opacity: 0.7 },
});
