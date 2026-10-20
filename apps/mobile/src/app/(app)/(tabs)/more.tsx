// More tab (LLD §8): everything that isn't used every day. Today: batches and your account;
// later also notices, tests, plan and help.
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';
import { List } from 'react-native-paper';
import { useMe } from '@/auth/use-me';

export default function MoreTab() {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <ScrollView>
      <List.Section>
        <List.Item
          title={t('more.batches')}
          description={t('more.batchesDescription')}
          left={(props) => <List.Icon {...props} icon="google-classroom" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push('/batches')}
        />
        <List.Item
          // Your name when it's set, so you can see at a glance which account this is.
          title={me.data?.user.name ?? t('me.title')}
          description={t('more.account')}
          left={(props) => <List.Icon {...props} icon="account-circle-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push('/me')}
        />
      </List.Section>
    </ScrollView>
  );
}
