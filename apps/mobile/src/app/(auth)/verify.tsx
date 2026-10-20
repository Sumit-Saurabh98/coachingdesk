// Login, step 2: the 6-digit code. A correct code starts the session; the root layout's guard
// then swaps the login screens for the app by itself (no navigate call here).
import { useMutation } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { login, requestOtp } from '@/auth/auth-api';
import { useAppTheme } from '@/theme/theme';

const CODE_LENGTH = 6;
// The API allows 3 code requests per 15 minutes; a short wait stops accidental double taps.
const RESEND_AFTER_SECONDS = 30;

export default function VerifyScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  // The number from the login screen (route parameter).
  const { phone } = useLocalSearchParams<{ phone?: string }>();
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_AFTER_SECONDS);

  // Count down once per second. Each tick schedules the next; the cleanup cancels the timer
  // if the screen closes first (otherwise it would fire on a screen that's gone).
  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const verify = useMutation({
    mutationFn: (otp: string) => login(phone ?? '', otp),
    // A wrong code: clear the field so the next attempt starts empty.
    onError: () => setCode(''),
  });

  const resend = useMutation({
    mutationFn: () => requestOtp(phone ?? ''),
    onSuccess: () => {
      setSecondsLeft(RESEND_AFTER_SECONDS);
      verify.reset(); // hide the old "wrong code" message
    },
  });

  // Opened without a number (e.g. an old link): go back to the start.
  if (!phone) {
    return <Redirect href="/login" />;
  }

  const onChangeCode = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    // All 6 digits in: verify straight away, no extra tap (also when Android autofills it).
    if (digits.length === CODE_LENGTH && !verify.isPending) {
      verify.mutate(digits);
    }
  };

  const error = verify.error ?? resend.error;
  // "98765 43210": easier to check at a glance than 10 digits in a row.
  const shownPhone = `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="bodyLarge">{t('auth.verifySubtitle', { phone: shownPhone })}</Text>

      <TextInput
        mode="outlined"
        label={t('auth.codeLabel')}
        value={code}
        onChangeText={onChangeCode}
        keyboardType="number-pad"
        maxLength={CODE_LENGTH}
        // Lets Android/iOS offer the code from the SMS with one tap.
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        autoFocus
        disabled={verify.isPending}
        style={styles.codeInput}
      />

      {error && <Text style={{ color: theme.colors.error }}>{errorMessage(t, error)}</Text>}
      {resend.isSuccess && !error && (
        <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('auth.codeSent')}</Text>
      )}

      <Button
        mode="contained"
        onPress={() => verify.mutate(code)}
        loading={verify.isPending}
        disabled={code.length !== CODE_LENGTH || verify.isPending}
        contentStyle={styles.buttonContent}
      >
        {t('auth.verify')}
      </Button>

      <Button
        mode="text"
        onPress={() => resend.mutate()}
        loading={resend.isPending}
        disabled={secondsLeft > 0 || resend.isPending}
      >
        {secondsLeft > 0 ? t('auth.resendIn', { seconds: secondsLeft }) : t('auth.resend')}
      </Button>
      <Button mode="text" onPress={() => router.back()}>
        {t('auth.changeNumber')}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 },
  // Big, spaced digits: easy to read back against the SMS.
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center' },
  buttonContent: { paddingVertical: 6 },
});
