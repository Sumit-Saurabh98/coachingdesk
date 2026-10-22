// Institute settings (owner): name and city, when fees are billed and due, the institute's own
// UPI ID, and which automatic WhatsApp messages go out (absence alerts, reminder days, language).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  HelperText,
  List,
  SegmentedButtons,
  Snackbar,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { ME_KEY } from '@/auth/use-me';
import {
  getInstitute,
  type InstituteResponse,
  instituteKeys,
  updateInstitute,
} from '@/institutes/institutes-api';
import {
  canShowUpi,
  cleanUpiId,
  dueDayOfMonth,
  MAX_REMINDERS,
  offsetLabel,
  REMINDER_CHOICES,
  type SettingsValues,
  toggleOffset,
  toInstituteUpdate,
  validateSettings,
  valuesFromInstitute,
} from '@/institutes/settings-rules';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { useAppTheme } from '@/theme/theme';

export default function InstituteSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const isOwner = current?.role === 'owner';
  // Bumped after a save: the form starts again from what the server now has.
  const [version, setVersion] = useState(0);

  const detail = useQuery({
    queryKey: instituteKeys.detail(instituteId),
    queryFn: ({ signal }) => getInstitute(instituteId, signal),
    enabled: instituteId !== '' && isOwner,
  });

  if (!isOwner) {
    return <Redirect href="/" />;
  }
  if (!detail.data) {
    return (
      <View style={styles.centered}>
        {detail.isError ? (
          <>
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, detail.error)}</Text>
            <Button mode="contained" onPress={() => void detail.refetch()}>
              {t('common.retry')}
            </Button>
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }
  return <SettingsForm key={version} data={detail.data} onSaved={() => setVersion((v) => v + 1)} />;
}

function SettingsForm({ data, onSaved }: { data: InstituteResponse; onSaved: () => void }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const original = data.institute;
  const [values, setValues] = useState<SettingsValues>(() => valuesFromInstitute(original));
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof SettingsValues>(field: K, value: SettingsValues[K]) =>
    setValues((v) => ({ ...v, [field]: value }));

  const errors = validateSettings(values);
  const shown = tried ? errors : {};
  const changes = Object.keys(errors).length === 0 ? toInstituteUpdate(original, values) : null;

  const save = useMutation({
    mutationFn: () => updateInstitute(original.id, changes ?? {}),
    onSuccess: async () => {
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: instituteKeys.detail(original.id) }),
        queryClient.invalidateQueries({ queryKey: ME_KEY }), // the name in lists and headers
      ]);
      onSaved();
    },
  });
  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length === 0 && changes !== null && !save.isPending) {
      save.mutate();
    }
  };

  const billingDay = Number(values.billingDayText);
  const dueAfter = Number(values.dueAfterText);
  const dueDay = errors.billingDay || errors.dueAfter ? null : dueDayOfMonth(billingDay, dueAfter);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <List.Subheader style={styles.subheader}>{t('instituteSettings.institute')}</List.Subheader>
        <TextInput
          mode="outlined"
          label={t('institute.nameLabel')}
          value={values.name}
          onChangeText={(text) => set('name', text)}
          error={shown.name !== undefined}
        />
        <HelperText type="error" visible={shown.name !== undefined}>
          {t('institute.nameInvalid')}
        </HelperText>
        <TextInput
          mode="outlined"
          label={t('institute.cityLabel')}
          value={values.city}
          onChangeText={(text) => set('city', text)}
          error={shown.city !== undefined}
        />
        <HelperText type="error" visible={shown.city !== undefined}>
          {t('institute.cityInvalid')}
        </HelperText>

        <List.Subheader style={styles.subheader}>{t('instituteSettings.fees')}</List.Subheader>
        <View style={styles.pair}>
          <TextInput
            mode="outlined"
            label={t('instituteSettings.billingDay')}
            value={values.billingDayText}
            onChangeText={(text) => set('billingDayText', text)}
            keyboardType="number-pad"
            maxLength={2}
            error={shown.billingDay !== undefined}
            style={styles.half}
          />
          <TextInput
            mode="outlined"
            label={t('instituteSettings.dueAfter')}
            value={values.dueAfterText}
            onChangeText={(text) => set('dueAfterText', text)}
            keyboardType="number-pad"
            maxLength={2}
            error={shown.dueAfter !== undefined}
            style={styles.half}
          />
        </View>
        <HelperText type={shown.billingDay || shown.dueAfter ? 'error' : 'info'} visible>
          {shown.billingDay
            ? t(shown.billingDay)
            : shown.dueAfter
              ? t(shown.dueAfter)
              : dueDay !== null
                ? t('instituteSettings.dueExample', { billing: billingDay, due: dueDay })
                : t('instituteSettings.dueExampleDays', { billing: billingDay, days: dueAfter })}
        </HelperText>

        <List.Subheader style={styles.subheader}>{t('instituteSettings.upi')}</List.Subheader>
        <TextInput
          mode="outlined"
          label={t('instituteSettings.upiId')}
          placeholder="sharmaclasses@okaxis"
          value={values.upiId}
          onChangeText={(text) => set('upiId', text)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          error={shown.upiId !== undefined}
        />
        <HelperText type={shown.upiId ? 'error' : 'info'} visible>
          {shown.upiId ? t(shown.upiId) : t('instituteSettings.upiHelp')}
        </HelperText>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text variant="bodyLarge">{t('instituteSettings.upiInReminders')}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {canShowUpi(values) && values.showUpiInReminders
                ? t('instituteSettings.upiPreview', { upiId: cleanUpiId(values.upiId) })
                : canShowUpi(values)
                  ? t('instituteSettings.upiInRemindersHelp')
                  : t('instituteSettings.upiNeeded')}
            </Text>
          </View>
          <Switch
            value={canShowUpi(values) && values.showUpiInReminders}
            disabled={!canShowUpi(values)}
            onValueChange={(on) => set('showUpiInReminders', on)}
          />
        </View>

        <List.Subheader style={styles.subheader}>{t('instituteSettings.messages')}</List.Subheader>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text variant="bodyLarge">{t('instituteSettings.absenceAlerts')}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('instituteSettings.absenceAlertsHelp')}
            </Text>
          </View>
          <Switch value={values.absenceAlerts} onValueChange={(on) => set('absenceAlerts', on)} />
        </View>

        <Text variant="labelLarge" style={styles.label}>
          {t('instituteSettings.reminders')}
        </Text>
        <View style={styles.chips}>
          {REMINDER_CHOICES.map((offset) => {
            const { key, count } = offsetLabel(offset);
            return (
              <Chip
                key={offset}
                selected={values.reminderOffsets.includes(offset)}
                showSelectedCheck
                onPress={() => set('reminderOffsets', toggleOffset(values.reminderOffsets, offset))}
              >
                {t(key, { count })}
              </Chip>
            );
          })}
        </View>
        <Text variant="bodySmall" style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {values.reminderOffsets.length === 0
            ? t('instituteSettings.remindersOff')
            : t('instituteSettings.remindersHelp', { max: MAX_REMINDERS })}
        </Text>

        <Text variant="labelLarge" style={styles.label}>
          {t('instituteSettings.language')}
        </Text>
        <SegmentedButtons
          value={values.messageLanguage}
          onValueChange={(language) => set('messageLanguage', language === 'hi' ? 'hi' : 'en')}
          buttons={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिंदी' },
          ]}
        />
        <Text variant="bodySmall" style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('instituteSettings.languageHelp')}
        </Text>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.colors.outlineVariant }]}>
        {save.isError && (
          <Text style={[styles.error, { color: theme.colors.error }]}>
            {errorMessage(t, save.error)}
          </Text>
        )}
        <Button
          mode="contained"
          icon="content-save"
          onPress={submit}
          loading={save.isPending}
          disabled={save.isPending || (changes === null && Object.keys(errors).length === 0)}
          contentStyle={styles.buttonContent}
        >
          {changes === null && Object.keys(errors).length === 0
            ? t('marks.saved')
            : t('instituteSettings.save')}
        </Button>
      </View>
      <Snackbar visible={saved} onDismiss={() => setSaved(false)} duration={3000}>
        {t('instituteSettings.savedNote')}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 16, paddingBottom: 32 },
  subheader: { paddingHorizontal: 0 },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  label: { marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { marginTop: 6 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  error: { marginBottom: 8 },
  buttonContent: { paddingVertical: 6 },
});
