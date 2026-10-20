// The ROOT layout: Expo Router renders every screen inside this component. Anything wrapped
// around <Stack /> here (providers) is available on every screen.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { queryClient, session } from '@/api';
// Importing it runs the i18next setup, before any screen renders.
import i18n, { resolveLanguage } from '@/i18n';
import { useSessionStatus } from '@/auth/use-session-status';
import { usePreferences } from '@/stores/preferences';
import { darkTheme, lightTheme, navigationThemeFor } from '@/theme/theme';

// Keep the splash screen up until we know whether someone is logged in: otherwise a
// logged-in user would see the login screen flash for a moment on every start.
void SplashScreen.preventAutoHideAsync();

// The names the icon font knows ("whatsapp", "check", ...). Paper hands us a plain string.
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export default function RootLayout() {
  // The phone's own setting, and what the user chose in the app.
  const systemScheme = useColorScheme();
  const preference = usePreferences((state) => state.theme);
  // 'system' follows the phone; 'light'/'dark' override it.
  const dark = preference === 'dark' || (preference === 'system' && systemScheme === 'dark');
  const theme = dark ? darkTheme : lightTheme;

  // Once, at app start: read the saved login (secure store) and renew the access token.
  useEffect(() => {
    void session.restore();
  }, []);

  // 'restoring' -> 'signedIn' / 'signedOut'. Hide the splash as soon as we know.
  const status = useSessionStatus((state) => state.status);
  useEffect(() => {
    if (status !== 'restoring') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  // When the user picks another language, tell i18next. Every screen using
  // useTranslation() then re-renders in the new language by itself.
  const language = usePreferences((state) => state.language);
  useEffect(() => {
    void i18n.changeLanguage(resolveLanguage(language));
  }, [language]);

  return (
    // TanStack Query's cache, for every screen: useQuery/useMutation work anywhere below.
    <QueryClientProvider client={queryClient}>
      {/* PaperProvider gives every Paper component (Button, Card, Text...) our theme.
          `settings.icon`: we tell Paper EXACTLY which icon set to draw with, instead of letting
          it search for one (with pnpm's strict folders, that search can fail and show no icons). */}
      <PaperProvider
        theme={theme}
        settings={{
          icon: ({ name, color, size }) => (
            <MaterialCommunityIcons name={name as IconName} color={color} size={size} />
          ),
        }}
      >
        {/* The same colours for the parts Expo Router draws: header bar, screen background. */}
        <ThemeProvider value={navigationThemeFor(theme)}>
          {/* Status bar text: light on a dark app, dark on a light one. */}
          <StatusBar style={theme.dark ? 'light' : 'dark'} />
          {/* Which screens exist depends on the login: Stack.Protected hides a group when
              its guard is false, and the app moves to the other group by itself. Logging in
              or out anywhere (or the session expiring) switches screens with no navigate code.
              While 'restoring', the login group is behind the splash screen. */}
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={status === 'signedIn'}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            <Stack.Protected guard={status !== 'signedIn'}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
          </Stack>
        </ThemeProvider>
      </PaperProvider>
    </QueryClientProvider>
  );
}
