// Everything a LOGGED-IN user sees. This layout is the LOGIN gate (logged out -> /login), and
// the INSTITUTE gate: almost every screen works inside one institute, so until one is chosen
// (or created) only welcome, "create institute" and Me are open.
import { Redirect, router, Stack, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { useAttendanceSync } from '@/attendance/sync';
import { logout } from '@/auth/auth-api';
import { useSessionStatus } from '@/auth/use-session-status';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { useAppTheme } from '@/theme/theme';

/** The screens open without an institute (segments[1] under "(app)"). */
const OPEN_WITHOUT_INSTITUTE = new Set(['welcome', 'create-institute', 'me']);

export default function AppLayout() {
  const status = useSessionStatus((state) => state.status);
  if (status === 'restoring') {
    return null; // the splash screen is still showing
  }
  if (status !== 'signedIn') {
    return <Redirect href="/login" />;
  }
  return <SignedInLayout />;
}

function SignedInLayout() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { me, current } = useCurrentInstitute();
  // Attendance saved offline goes out by itself while someone is logged in.
  useAttendanceSync();

  // No institute chosen (new user, several to pick from, or just removed from one): only the
  // open screens are allowed; anything else goes to welcome. ("replace": back can't return.)
  const segments = useSegments();
  const hasInstitute = current !== null;
  const onOpenScreen = OPEN_WITHOUT_INSTITUTE.has(segments[1] ?? '');
  useEffect(() => {
    if (me.data && !hasInstitute && !onOpenScreen) {
      router.replace('/welcome');
    }
  }, [me.data, hasInstitute, onOpenScreen]);

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

  return (
    <Stack>
      {/* The institute's screens (sent to welcome above while there's no institute). The tabs
          draw their own headers (each tab its own title), so this Stack's header is hidden. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="batches/index" options={{ title: t('more.batches') }} />
      <Stack.Screen name="batches/new" options={{ title: t('batch.newTitle') }} />
      {/* The details screen sets its own title: the batch's name. */}
      <Stack.Screen name="batches/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="batches/[id]/edit" options={{ title: t('batch.editTitle') }} />
      <Stack.Screen name="students/new" options={{ title: t('studentForm.title') }} />
      <Stack.Screen name="students/bulk" options={{ title: t('bulkAdd.title') }} />
      <Stack.Screen name="attendance/[batchId]" options={{ title: t('register.title') }} />
      <Stack.Screen name="batches/[id]/tests/new" options={{ title: t('tests.new') }} />
      <Stack.Screen name="tests/[testId]/index" options={{ title: '' }} />
      <Stack.Screen name="tests/[testId]/edit" options={{ title: t('results.edit') }} />
      <Stack.Screen name="fees/invoices" options={{ title: t('invoices.title') }} />
      <Stack.Screen name="notices/index" options={{ title: t('more.notices') }} />
      <Stack.Screen name="notices/new" options={{ title: t('notices.new') }} />
      <Stack.Screen name="messages/index" options={{ title: t('more.messages') }} />
      <Stack.Screen name="settings/institute" options={{ title: t('more.instituteSettings') }} />
      <Stack.Screen name="settings/team" options={{ title: t('more.team') }} />
      <Stack.Screen name="settings/plan" options={{ title: t('more.plan') }} />
      <Stack.Screen name="settings/data" options={{ title: t('more.data') }} />
      <Stack.Screen name="fees/new" options={{ title: t('manualInvoice.title') }} />
      <Stack.Screen name="fees/[invoiceId]/index" options={{ title: '' }} />
      <Stack.Screen name="fees/[invoiceId]/pay" options={{ title: t('payment.title') }} />
      <Stack.Screen name="fees/receipt/[paymentId]" options={{ title: t('receipt.title') }} />
      {/* The profile sets its own title: the student's name. */}
      <Stack.Screen name="students/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="students/[id]/edit" options={{ title: t('studentEdit.title') }} />
      {/* Create / choose an institute. Always registered, and it redirects home itself once one
          is chosen. (Inside a Stack.Protected, every time an institute became current the
          router tried to remove a welcome screen that was never open: "REMOVE_ROUTES ... was
          not handled by any navigator".) */}
      <Stack.Screen name="welcome" />
      {/* Always open: "create another" and Me (logout must always be reachable). */}
      <Stack.Screen name="create-institute" options={{ title: t('welcome.newInstitute') }} />
      <Stack.Screen name="me" options={{ title: t('me.title') }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
});
