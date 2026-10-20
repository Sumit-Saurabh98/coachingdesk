// A PREVIEW of the theme and the API connection (Step 26). The real home screen replaces it
// (Step 28 on). The theme and language switches now live on the Me screen.
import { Money, PhoneNumber } from '@coachingdesk/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Avatar, Button, Card, Chip, Text } from 'react-native-paper';
import { api } from '@/api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { useAppTheme } from '@/theme/theme';

const fee = Money.ofPaise(150000).format();
const phone = PhoneNumber.parse('9876543210').masked();

export default function Index() {
  // Our theme (with success/warning). Colours come from ROLES, never hex values.
  const theme = useAppTheme();
  // t('key') returns the text in the current language; the component re-renders on a switch.
  const { t } = useTranslation();
  // Always set here: the (app) layout only opens this screen when an institute is chosen.
  const { current } = useCurrentInstitute();

  // useQuery: loads, caches and retries. The key ['plans'] names this data in the cache;
  // `signal` lets TanStack Query cancel the request if the screen goes away.
  // GET /v1/plans is public (no login needed), so it proves the phone reaches the API.
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: ({ signal }) => api.get<{ plans: unknown[] }>('/v1/plans', { signal }),
  });

  return (
    <>
      {/* The tab's header shows the institute's name (the tab bar already says "Today"). */}
      <Stack.Screen options={{ title: current?.name ?? '' }} />
      <ScrollView contentContainerStyle={styles.content}>
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
              <Button onPress={() => void plans.refetch()}>{t('common.retry')}</Button>
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
