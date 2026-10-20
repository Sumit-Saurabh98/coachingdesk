// A THEME + LANGUAGE PREVIEW (Step 26d-f). The real screens replace this from Step 27 on.
import { LANGUAGE_NAMES } from '@coachingdesk/i18n';
import { Money, PhoneNumber } from '@coachingdesk/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Avatar,
  Button,
  Card,
  Chip,
  SegmentedButtons,
  Text,
} from 'react-native-paper';
import { api } from '@/api';
import { useSessionStatus } from '@/auth/use-session-status';
import { usePreferences } from '@/stores/preferences';
import { useAppTheme } from '@/theme/theme';

const fee = Money.ofPaise(150000).format();
const phone = PhoneNumber.parse('9876543210').masked();

export default function Index() {
  // Our theme (with success/warning). Colours come from ROLES, never hex values.
  const theme = useAppTheme();
  const themePreference = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);
  const languagePreference = usePreferences((state) => state.language);
  const setLanguage = usePreferences((state) => state.setLanguage);
  // t('key') returns the text in the current language; the component re-renders on a switch.
  const { t } = useTranslation();
  const sessionStatus = useSessionStatus((state) => state.status);

  // useQuery: loads, caches and retries. The key ['plans'] names this data in the cache;
  // `signal` lets TanStack Query cancel the request if the screen goes away.
  // GET /v1/plans is public (no login needed), so it proves the phone reaches the API.
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: ({ signal }) => api.get<{ plans: unknown[] }>('/v1/plans', { signal }),
  });

  return (
    <>
      {/* A screen sets its own header title like this. */}
      <Stack.Screen options={{ title: t('preview.title') }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Temporary: these two switches move to the Settings screen later. SegmentedButtons
            is generic: the value's type flows into onValueChange, so the setters fit directly. */}
        <SegmentedButtons
          value={themePreference}
          onValueChange={setTheme}
          buttons={[
            { value: 'system', label: t('settings.themeSystem'), icon: 'theme-light-dark' },
            { value: 'light', label: t('settings.themeLight'), icon: 'white-balance-sunny' },
            { value: 'dark', label: t('settings.themeDark'), icon: 'weather-night' },
          ]}
        />
        <SegmentedButtons
          value={languagePreference}
          onValueChange={setLanguage}
          buttons={[
            { value: 'system', label: t('settings.languageSystem'), icon: 'translate' },
            // Language names are NOT translated: each is written in its own language.
            { value: 'en', label: LANGUAGE_NAMES.en },
            { value: 'hi', label: LANGUAGE_NAMES.hi },
          ]}
        />
        {/* Paper's Text has Material type styles: headlineSmall, titleLarge, bodyMedium... */}
        <Text variant="headlineSmall">{t('preview.today')}</Text>
        <Card mode="elevated">
          <Card.Title
            title="Aarav Sharma"
            subtitle="Class 10 Maths"
            // `left` is a function: Card passes the right size for the avatar.
            left={(props) => <Avatar.Icon {...props} icon="account" />}
          />
          <Card.Content style={styles.row}>
            <Text variant="titleLarge">{fee}</Text>
            <Chip
              style={{ backgroundColor: theme.colors.successContainer }}
              textStyle={{ color: theme.colors.onSuccessContainer }}
              icon="check"
            >
              {t('preview.paid')}
            </Chip>
          </Card.Content>
          <Card.Content>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {/* Values go in as options; the translation decides where they appear. */}
              {t('preview.guardian', { phone })}
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button mode="outlined" icon="receipt">
              {t('preview.receipt')}
            </Button>
            <Button mode="contained" icon="whatsapp">
              {t('preview.remind')}
            </Button>
          </Card.Actions>
        </Card>
        {/* Temporary (27a): the login state. Login screens arrive in 27b. */}
        <Card mode="outlined">
          <Card.Title
            title={t('preview.session')}
            subtitle={
              sessionStatus === 'restoring'
                ? t('preview.sessionRestoring')
                : sessionStatus === 'signedIn'
                  ? t('preview.sessionSignedIn')
                  : t('preview.sessionSignedOut')
            }
          />
        </Card>
        {/* Temporary connection check (26g): the three states every screen will have. */}
        <Card mode="outlined">
          <Card.Title title={t('preview.server')} subtitle={api.baseUrl} />
          <Card.Content>
            {plans.isPending ? (
              <View style={styles.row}>
                <Text>{t('preview.serverChecking')}</Text>
                <ActivityIndicator />
              </View>
            ) : plans.isError ? (
              <Text style={{ color: theme.colors.error }}>{t('preview.serverDown')}</Text>
            ) : (
              <Text style={{ color: theme.colors.success }}>
                {t('preview.serverOk', { plans: plans.data.plans.length })}
              </Text>
            )}
          </Card.Content>
          {plans.isError && (
            <Card.Actions>
              {/* refetch() returns a Promise; `void` says we don't wait for it here. */}
              <Button onPress={() => void plans.refetch()}>{t('preview.retry')}</Button>
            </Card.Actions>
          )}
        </Card>
        <View style={[styles.banner, { backgroundColor: theme.colors.warningContainer }]}>
          {/* `count` picks the plural form: feesDue_one or feesDue_other. */}
          <Text style={{ color: theme.colors.onWarningContainer }}>
            {t('preview.feesDue', { count: 3 })}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

// Only LAYOUT here (spacing, direction, corners). Colours come from the theme above,
// because they differ between light and dark mode.
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  banner: { padding: 12, borderRadius: 12 },
});
