// More tab (LLD §8): everything that isn't used every day: batches, notices, your account;
// later also tests, plan and help.
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';
import { List } from 'react-native-paper';
import { useMe } from '@/auth/use-me';
import { useCurrentInstitute } from '@/institutes/use-current-institute';

export default function MoreTab() {
  const { t } = useTranslation();
  const me = useMe();
  const { current } = useCurrentInstitute();
  const canSeeMessages = current?.role === 'owner' || current?.role === 'staff';
  return (
    <ScrollView>
      <List.Section>
        {current?.role === 'owner' && (
          <List.Item
            title={t('more.instituteSettings')}
            description={t('more.instituteSettingsDescription')}
            left={(props) => <List.Icon {...props} icon="cog-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push('/settings/institute')}
          />
        )}
        {current?.role === 'owner' && (
          <List.Item
            title={t('more.team')}
            description={t('more.teamDescription')}
            left={(props) => <List.Icon {...props} icon="account-multiple-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push('/settings/team')}
          />
        )}
        {current?.role === 'owner' && (
          <List.Item
            title={t('more.plan')}
            description={t('more.planDescription')}
            left={(props) => <List.Icon {...props} icon="card-account-details-star-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push('/settings/plan')}
          />
        )}
        <List.Item
          title={t('more.batches')}
          description={t('more.batchesDescription')}
          left={(props) => <List.Icon {...props} icon="google-classroom" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push('/batches')}
        />
        <List.Item
          title={t('more.notices')}
          description={t('more.noticesDescription')}
          left={(props) => <List.Icon {...props} icon="bullhorn-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push('/notices')}
        />
        {canSeeMessages && (
          <List.Item
            title={t('more.messages')}
            description={t('more.messagesDescription')}
            left={(props) => <List.Icon {...props} icon="message-text-clock-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push('/messages')}
          />
        )}
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
