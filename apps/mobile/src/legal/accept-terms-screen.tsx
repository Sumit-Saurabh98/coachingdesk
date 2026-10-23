// Shown instead of the app to a logged-in user who hasn't accepted the CURRENT terms (KB #54):
// the terms changed since they agreed, or they logged in before the tick box existed.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '@/api/error-message';
import { logout } from '@/auth/auth-api';
import { ME_KEY } from '@/auth/use-me';
import { useAppTheme } from '@/theme/theme';
import { AgreeTermsText } from './agree-terms-text';
import { acceptTerms } from './legal-api';

export function AcceptTermsScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);

  const accept = useMutation({
    mutationFn: acceptTerms,
    // /me now says termsAccepted: the layout shows the app.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
  });

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="headlineSmall">{t('legal.updatedTitle')}</Text>
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('legal.updatedBody')}
        </Text>
        <View style={styles.agreeRow}>
          <Checkbox.Android
            status={agreed ? 'checked' : 'unchecked'}
            onPress={() => setAgreed((on) => !on)}
          />
          <View style={styles.flex}>
            <AgreeTermsText />
          </View>
        </View>
        {accept.isError && (
          <Text style={{ color: theme.colors.error }}>{errorMessage(t, accept.error)}</Text>
        )}
        <Button
          mode="contained"
          onPress={() => accept.mutate()}
          loading={accept.isPending}
          disabled={!agreed || accept.isPending}
          contentStyle={styles.buttonContent}
        >
          {t('legal.continue')}
        </Button>
        {/* Never a dead end: someone who doesn't agree can still log out. */}
        <Button onPress={() => void logout()}>{t('me.logout')}</Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
  buttonContent: { paddingVertical: 6 },
});
