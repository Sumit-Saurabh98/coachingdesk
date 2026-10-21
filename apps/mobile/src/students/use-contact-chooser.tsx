// "Parent or Student?": when a student has their own number, Call / WhatsApp ask which one.
// With one number there's nothing to ask: the action runs straight away.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, List, Portal } from 'react-native-paper';
import { formatIndianPhone } from '@/lib/phone-format';
import type { Contact } from './profile-rules';

export function useContactChooser(contacts: Contact[]) {
  const { t } = useTranslation();
  // The action waiting for a number (a function in state: wrapped, or React would call it).
  const [pending, setPending] = useState<{ run: (phone: string) => void } | null>(null);

  const choose = (run: (phone: string) => void) => {
    const [only] = contacts;
    if (contacts.length === 1 && only) {
      run(only.phone);
    } else if (contacts.length > 1) {
      setPending({ run });
    }
  };

  const dialog = (
    <Portal>
      <Dialog visible={pending !== null} onDismiss={() => setPending(null)}>
        <Dialog.Title>{t('contact.which')}</Dialog.Title>
        <Dialog.Content>
          {contacts.map((contact) => (
            <List.Item
              key={contact.who}
              title={t(`contact.${contact.who}`)}
              description={formatIndianPhone(contact.phone)}
              left={(props) => (
                <List.Icon
                  {...props}
                  icon={contact.who === 'parent' ? 'account-child-outline' : 'school-outline'}
                />
              )}
              onPress={() => {
                pending?.run(contact.phone);
                setPending(null);
              }}
            />
          ))}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => setPending(null)}>{t('common.cancel')}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );

  return { choose, dialog };
}
