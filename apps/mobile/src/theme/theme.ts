// The app's colours, light and dark (KB #47: React Native Paper, Material 3).
//
// Generated ONCE from one brand colour (#1565C0, "trust blue") with Google's Material colour
// tools (scheme "fidelity", which keeps the brand colour recognisable), then written out here.
// Material 3 needs ~30 colour ROLES (primary, its container, text on each, surfaces, outline...)
// that are designed to have enough contrast with each other in both light and dark mode.
// Use the ROLE in screens (theme.colors.primary), never a hex value: then dark mode, and any
// future brand colour, change in this file only.
import {
  DarkTheme as NavigationDark,
  DefaultTheme as NavigationLight,
  type Theme as NavigationTheme,
} from 'expo-router';
import { MD3DarkTheme, MD3LightTheme, useTheme } from 'react-native-paper';

const lightColors = {
  primary: '#004d99',
  onPrimary: '#ffffff',
  primaryContainer: '#1565c0',
  onPrimaryContainer: '#dae5ff',
  secondary: '#4a5f83',
  onSecondary: '#ffffff',
  secondaryContainer: '#c0d5ff',
  onSecondaryContainer: '#475c80',
  tertiary: '#813900',
  onTertiary: '#ffffff',
  tertiaryContainer: '#a64c00',
  onTertiaryContainer: '#ffdece',
  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',
  background: '#f9f9ff',
  onBackground: '#191c21',
  surface: '#f9f9ff',
  onSurface: '#191c21',
  surfaceVariant: '#dee2f0',
  onSurfaceVariant: '#424752',
  outline: '#727783',
  outlineVariant: '#c2c6d4',
  shadow: '#000000',
  scrim: '#000000',
  inverseSurface: '#2e3037',
  inverseOnSurface: '#eff0f9',
  inversePrimary: '#a9c7ff',
  surfaceDisabled: 'rgba(27, 27, 31, 0.12)',
  onSurfaceDisabled: 'rgba(27, 27, 31, 0.38)',
  backdrop: 'rgba(46, 48, 56, 0.4)',
  elevation: {
    level0: 'transparent',
    level1: '#f2f3fb',
    level2: '#ecedf6',
    level3: '#e7e8f0',
    level4: '#e7e8f0',
    level5: '#e1e2ea',
  },
  // Not Material roles: for fee and attendance states (paid, due).
  success: '#1b6d24',
  onSuccess: '#ffffff',
  successContainer: '#a3f69c',
  onSuccessContainer: '#002204',
  warning: '#8a5100',
  onWarning: '#ffffff',
  warningContainer: '#ffdcbd',
  onWarningContainer: '#2c1600',
};

const darkColors = {
  primary: '#a9c7ff',
  onPrimary: '#003063',
  primaryContainer: '#1565c0',
  onPrimaryContainer: '#dae5ff',
  secondary: '#b2c7f1',
  onSecondary: '#1b3052',
  secondaryContainer: '#32476a',
  onSecondaryContainer: '#a1b6de',
  tertiary: '#ffb68c',
  onTertiary: '#532200',
  tertiaryContainer: '#a64c00',
  onTertiaryContainer: '#ffdece',
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',
  background: '#111319',
  onBackground: '#e1e2ea',
  surface: '#111319',
  onSurface: '#e1e2ea',
  surfaceVariant: '#424752',
  onSurfaceVariant: '#c2c6d4',
  outline: '#8c919d',
  outlineVariant: '#424752',
  shadow: '#000000',
  scrim: '#000000',
  inverseSurface: '#e1e2ea',
  inverseOnSurface: '#2e3037',
  inversePrimary: '#005db7',
  surfaceDisabled: 'rgba(227, 226, 230, 0.12)',
  onSurfaceDisabled: 'rgba(227, 226, 230, 0.38)',
  backdrop: 'rgba(46, 48, 56, 0.4)',
  elevation: {
    level0: 'transparent',
    level1: '#191c21',
    level2: '#1d2025',
    level3: '#272a30',
    level4: '#272a30',
    level5: '#32353b',
  },
  // Not Material roles: for fee and attendance states (paid, due).
  success: '#88d982',
  onSuccess: '#003909',
  successContainer: '#005312',
  onSuccessContainer: '#a3f69c',
  warning: '#ffb86e',
  onWarning: '#492900',
  warningContainer: '#693c00',
  onWarningContainer: '#ffdcbd',
};

// `...MD3LightTheme` keeps Paper's fonts, animation settings etc.; we replace only the colours.
export const lightTheme = {
  ...MD3LightTheme,
  colors: { ...MD3LightTheme.colors, ...lightColors },
};

export const darkTheme: AppTheme = {
  ...MD3DarkTheme,
  colors: { ...MD3DarkTheme.colors, ...darkColors },
};

// Our theme TYPE: Paper's, plus success/warning. Screens call useAppTheme() instead of
// Paper's useTheme() so that theme.colors.success is known to TypeScript.
export type AppTheme = typeof lightTheme;
export const useAppTheme = () => useTheme<AppTheme>();

/**
 * Expo Router draws the header and the screen background itself (not Paper). This gives it
 * the same colours, so a screen never flashes white in dark mode.
 */
export function navigationThemeFor(theme: AppTheme): NavigationTheme {
  const base = theme.dark ? NavigationDark : NavigationLight;
  return {
    ...base,
    dark: theme.dark,
    colors: {
      ...base.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.elevation.level2, // the header bar
      text: theme.colors.onSurface,
      border: theme.colors.outlineVariant,
      notification: theme.colors.error,
    },
  };
}
