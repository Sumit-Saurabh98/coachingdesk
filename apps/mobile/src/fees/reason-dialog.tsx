// "Why?" before an owner action that changes money (waive, cancel, void): the reason is
// required and kept in the audit log.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, HelperText, Portal, Text, TextInput } from 'react-native-paper';
import { isValidReason } from './owner-actions-rules';

export function ReasonDialog({
  visible,
  title,
  body,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const invalid = !isValidReason(reason);

  const close = () => {
    setReason('');
    setTried(false);
    onDismiss();
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={close}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">{body}</Text>
          <TextInput
            mode="outlined"
            label={t('ownerActions.reason')}
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            error={tried && invalid}
            style={{ marginTop: 12 }}
          />
          <HelperText type="error" visible={(tried && invalid) || error !== null}>
            {tried && invalid ? t('ownerActions.reasonInvalid') : (error ?? '')}
          </HelperText>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button
            loading={pending}
            disabled={pending}
            onPress={() => {
              setTried(true);
              if (!invalid) {
                onConfirm(reason.trim());
              }
            }}
          >
            {confirmLabel}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
