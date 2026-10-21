// A parent's WhatsApp consent on the profile (owner, staff). Turning it on records the
// parent's spoken "yes" (source: verbal); off means no automatic messages to this number.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Switch, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { useAppTheme } from '@/theme/theme';
import { consentView } from './consent-rules';
import { getConsent, recordConsent, recordOptOut, studentKeys } from './students-api';

export function GuardianConsent({
  instituteId,
  phone,
  title,
}: {
  instituteId: string;
  phone: string;
  title?: string; // default: "WhatsApp updates" (the parent's number)
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [confirmOn, setConfirmOn] = useState(false);

  const consent = useQuery({
    queryKey: studentKeys.consent(instituteId, phone),
    queryFn: ({ signal }) => getConsent(instituteId, phone, signal),
  });
  const change = useMutation({
    mutationFn: (on: boolean) =>
      on ? recordConsent(instituteId, phone) : recordOptOut(instituteId, phone),
    onSuccess: async () => {
      setConfirmOn(false);
      await queryClient.invalidateQueries({ queryKey: studentKeys.consent(instituteId, phone) });
    },
  });

  if (!consent.data) {
    return null; // loading or offline with nothing saved: the rest of the card still works
  }
  const view = consentView(consent.data.status, consent.data.stoppedEverywhere);

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Text variant="bodyLarge">{title ?? t('consent.title')}</Text>
        <Switch
          value={view.on}
          disabled={change.isPending}
          // On: ask first (it must be a real "yes" from the parent). Off: at once.
          onValueChange={(on) => (on ? setConfirmOn(true) : change.mutate(false))}
        />
      </View>
      <Text
        variant="bodySmall"
        style={{
          color:
            view.note === 'consent.stoppedEverywhere'
              ? theme.colors.error
              : theme.colors.onSurfaceVariant,
        }}
      >
        {t(view.note)}
      </Text>
      {change.isError && (
        <Text variant="bodySmall" style={{ color: theme.colors.error }}>
          {errorMessage(t, change.error)}
        </Text>
      )}

      <Portal>
        <Dialog visible={confirmOn} onDismiss={() => setConfirmOn(false)}>
          <Dialog.Title>{t('consent.confirmTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('consent.confirmBody')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmOn(false)}>{t('common.cancel')}</Button>
            <Button loading={change.isPending} onPress={() => change.mutate(true)}>
              {t('consent.confirmYes')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: 16, paddingBottom: 8, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
