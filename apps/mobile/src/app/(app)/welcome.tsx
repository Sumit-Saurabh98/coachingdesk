// First stop after login when no institute is chosen yet:
//  - no institutes at all  -> "Set up your institute" (the owner's first minute in the app)
//  - several institutes    -> "Choose an institute"
// Choosing or creating one makes the (app) layout's guard switch to the home screen by itself.
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, IconButton, List, Text } from 'react-native-paper';
import { CreateInstituteForm } from '@/institutes/create-institute-form';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { usePreferences } from '@/stores/preferences';
import { useAppTheme } from '@/theme/theme';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { institutes } = useCurrentInstitute();
  const setCurrentInstitute = usePreferences((state) => state.setCurrentInstitute);

  const roleLabel = {
    owner: t('me.roleOwner'),
    teacher: t('me.roleTeacher'),
    staff: t('me.roleStaff'),
  } as const;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('welcome.title'),
          // Me (and logout) must be reachable even before there's an institute.
          headerRight: () => (
            <IconButton
              icon="account-circle"
              accessibilityLabel={t('me.title')}
              onPress={() => router.push('/me')}
            />
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {institutes.length === 0 ? (
          <>
            <Text variant="headlineSmall">{t('welcome.createTitle')}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('welcome.createSubtitle')}
            </Text>
            <CreateInstituteForm />
          </>
        ) : (
          <>
            <Text variant="headlineSmall">{t('welcome.chooseTitle')}</Text>
            {institutes.map((institute) => (
              <List.Item
                key={institute.id}
                title={institute.name}
                description={roleLabel[institute.role]}
                left={(props) => <List.Icon {...props} icon="domain" />}
                right={(props) => <List.Icon {...props} icon="chevron-right" />}
                onPress={() => setCurrentInstitute(institute.id)}
              />
            ))}
            <Button mode="outlined" icon="plus" onPress={() => router.push('/create-institute')}>
              {t('welcome.createAnother')}
            </Button>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 12 },
});
