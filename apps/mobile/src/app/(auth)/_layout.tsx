// The login screens. Only for a logged-out user: once logged in (here, or a restored login),
// this group sends them to the app's home.
import { Redirect, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSessionStatus } from '@/auth/use-session-status';

export default function AuthLayout() {
  const { t } = useTranslation();
  const status = useSessionStatus((state) => state.status);
  if (status === 'signedIn') {
    return <Redirect href="/" />;
  }
  return (
    <Stack>
      {/* The first screen has its own big title, no header bar. */}
      <Stack.Screen name="login" options={{ headerShown: false }} />
      {/* The code screen gets a header with a back arrow ("change number"). */}
      <Stack.Screen name="verify" options={{ title: t('auth.verifyTitle') }} />
    </Stack>
  );
}
