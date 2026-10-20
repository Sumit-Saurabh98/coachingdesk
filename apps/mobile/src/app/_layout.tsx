// The ROOT layout: Expo Router renders every screen inside this component. Anything wrapped
// around <Stack /> here (providers) is available on every screen.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { darkTheme, lightTheme, navigationThemeFor } from '@/theme/theme';
import { usePreferences } from '@/stores/preferences';

// The names the icon font knows ("whatsapp", "check", ...). Paper hands us a plain string.
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export default function RootLayout() {
  // The phone's own setting, and what the user chose in the app.
  const systemScheme = useColorScheme();
  const preference = usePreferences((state) => state.theme);
  // 'system' follows the phone; 'light'/'dark' override it.
  const dark = preference === 'dark' || (preference === 'system' && systemScheme === 'dark');
  const theme = dark ? darkTheme : lightTheme;

  return (
    // PaperProvider gives every Paper component (Button, Card, Text...) our theme.
    // `settings.icon`: we tell Paper EXACTLY which icon set to draw with, instead of letting it
    // search for one (with pnpm's strict folders, that search can fail and show no icons).
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
        <Stack />
      </ThemeProvider>
    </PaperProvider>
  );
}
