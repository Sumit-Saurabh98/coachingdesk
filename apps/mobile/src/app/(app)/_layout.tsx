// Everything a LOGGED-IN user sees. The root layout only shows this group when the session
// is signed in (Stack.Protected), so screens in here can assume a logged-in user.
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function AppLayout() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Stack.Screen name="me" options={{ title: t('me.title') }} />
    </Stack>
  );
}
