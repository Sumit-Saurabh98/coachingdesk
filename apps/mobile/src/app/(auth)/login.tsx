// Login, step 1: the mobile number, and agreeing to the Terms and Privacy Policy (KB #54). On
// "Send code" the API texts a 6-digit code (in local development there's no SMS: the code is
// printed in the API's terminal).
import { RequestOtpBody } from '@coachingdesk/shared';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Checkbox, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '@/api/error-message';
import { requestOtp } from '@/auth/auth-api';
import { AgreeTermsText } from '@/legal/agree-terms-text';
import { usePreferences } from '@/stores/preferences';
import { useAppTheme } from '@/theme/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  // Only the 10 digits; "+91" is shown as a fixed prefix in front of the field.
  // Starts with the number that last logged in on this phone (if any). The function form of
  // useState runs only on the first render: later changes to the store don't overwrite typing.
  const [digits, setDigits] = useState(() => usePreferences.getState().lastPhone ?? '');
  // Show "invalid number" only after the user tried to continue, not while still typing.
  const [triedToSubmit, setTriedToSubmit] = useState(false);
  // Unticked every time: the user isn't known yet, so we can't tell if they agreed before.
  const [agreed, setAgreed] = useState(false);

  // The SAME rule as the API (packages/shared): a number the app accepts, the server accepts.
  const isValid = RequestOtpBody.safeParse({ phone: digits }).success;

  // useMutation: for actions that CHANGE something (here: send an SMS). It tracks
  // isPending / error for us; we just call mutate().
  const sendCode = useMutation({
    mutationFn: () => requestOtp(digits),
    // The next screen needs the number: passed as a route parameter.
    onSuccess: () => router.push({ pathname: '/verify', params: { phone: digits } }),
  });

  const submit = () => {
    setTriedToSubmit(true);
    if (isValid && agreed && !sendCode.isPending) {
      sendCode.mutate();
    }
  };

  return (
    // SafeAreaView keeps content clear of the status bar and the phone's notch.
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* On iOS, push the content up when the keyboard opens (Android does this itself). */}
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text variant="displaySmall" style={{ color: theme.colors.primary }}>
              {t('common.appName')}
            </Text>
            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('auth.subtitle')}
            </Text>
          </View>

          <Text variant="headlineSmall">{t('auth.title')}</Text>
          <View>
            <TextInput
              mode="outlined"
              label={t('auth.phoneLabel')}
              value={digits}
              // Keep digits only: pasted "98765-43210" or spaces just disappear.
              onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 10))}
              left={<TextInput.Affix text="+91" />}
              keyboardType="number-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoFocus
              returnKeyType="next"
              onSubmitEditing={submit}
              error={triedToSubmit && !isValid}
            />
            <HelperText type="error" visible={triedToSubmit && !isValid}>
              {t('auth.phoneInvalid')}
            </HelperText>
          </View>

          <View style={styles.agreeRow}>
            <Checkbox.Android
              status={agreed ? 'checked' : 'unchecked'}
              onPress={() => setAgreed((on) => !on)}
            />
            <View style={styles.flex}>
              <AgreeTermsText />
            </View>
          </View>

          {sendCode.isError && (
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, sendCode.error)}</Text>
          )}

          <Button
            mode="contained"
            onPress={submit}
            loading={sendCode.isPending}
            disabled={sendCode.isPending || !agreed}
            contentStyle={styles.buttonContent}
          >
            {t('auth.sendCode')}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  header: { gap: 8, marginBottom: 24 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
  buttonContent: { paddingVertical: 6 },
});
