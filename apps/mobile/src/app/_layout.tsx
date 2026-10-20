// The ROOT layout: Expo Router renders every screen inside this component. Anything wrapped
// around <Stack /> here (providers) is available on every screen.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { darkTheme, lightTheme, navigationThemeFor } from '@/theme/theme';

// The names the icon font knows ("whatsapp", "check", ...). Paper hands us a plain string.
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export default function RootLayout() {
  // 'light' or 'dark', from the phone's setting. When the user switches it, this component
  // re-renders with the other theme: dark mode needs no other code.
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;
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
