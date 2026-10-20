// The login screens. Only reachable while logged out (Stack.Protected in the root layout):
// after a successful login this whole group disappears and the app shows (app) instead.
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function AuthLayout() {
  const { t } = useTranslation();
  return (
    <Stack>
      {/* The first screen has its own big title, no header bar. */}
      <Stack.Screen name="login" options={{ headerShown: false }} />
      {/* The code screen gets a header with a back arrow ("change number"). */}
      <Stack.Screen name="verify" options={{ title: t('auth.verifyTitle') }} />
    </Stack>
  );
}
