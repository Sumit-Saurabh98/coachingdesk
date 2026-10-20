// Everything a LOGGED-IN user sees. The root layout only shows this group when the session
// is signed in (Stack.Protected), so screens in here can assume a logged-in user.
//
// This layout is also the INSTITUTE gate: almost every screen works inside one institute, so
// until one is chosen (or created) only the welcome screen is open.
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { logout } from '@/auth/auth-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { useAppTheme } from '@/theme/theme';

export default function AppLayout() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { me, current } = useCurrentInstitute();

  // We need the user's institutes before deciding which screens exist.
  if (!me.data) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        {me.isError ? (
          <>
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, me.error)}</Text>
            <Button mode="contained" onPress={() => void me.refetch()}>
              {t('common.retry')}
            </Button>
            {/* Never a dead end: even if loading keeps failing, the user can log out. */}
            <Button onPress={() => void logout()}>{t('me.logout')}</Button>
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }

  const hasInstitute = current !== null;
  return (
    <Stack>
      {/* The institute's screens: only with a current institute. The tabs draw their own
          headers (each tab its own title), so this Stack's header is hidden for them. */}
      <Stack.Protected guard={hasInstitute} redirectTo="/welcome">
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="batches/index" options={{ title: t('more.batches') }} />
        <Stack.Screen name="batches/new" options={{ title: t('batch.newTitle') }} />
        {/* The details screen sets its own title: the batch's name. */}
        <Stack.Screen name="batches/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="batches/[id]/edit" options={{ title: t('batch.editTitle') }} />
        <Stack.Screen name="students/new" options={{ title: t('studentForm.title') }} />
      </Stack.Protected>
      {/* Create / choose: only while there is none. Once one is chosen, go home. */}
      <Stack.Protected guard={!hasInstitute} redirectTo="/">
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      {/* Always open: "create another" and Me (logout must always be reachable). */}
      <Stack.Screen name="create-institute" options={{ title: t('welcome.newInstitute') }} />
      <Stack.Screen name="me" options={{ title: t('me.title') }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
});
