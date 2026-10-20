// "Me": who is logged in (name, number, institutes), this phone's settings (theme, language),
// and logging out.
import { LANGUAGE_NAMES } from '@coachingdesk/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Avatar,
  Button,
  Dialog,
  Divider,
  List,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { logout, updateName } from '@/auth/auth-api';
import { ME_KEY, type MeData, useMe } from '@/auth/use-me';
import type { MyInstitute } from '@/institutes/current-institute';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { usePreferences } from '@/stores/preferences';
import { useAppTheme } from '@/theme/theme';

export default function MeScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();

  const me = useMe();
  const { current } = useCurrentInstitute();
  const setCurrentInstitute = usePreferences((state) => state.setCurrentInstitute);

  const lastPhone = usePreferences((state) => state.lastPhone);
  const themePreference = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);
  const languagePreference = usePreferences((state) => state.language);
  const setLanguage = usePreferences((state) => state.setLanguage);

  // The two dialogs: which one is open, and the name being typed.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const saveName = useMutation({
    mutationFn: updateName,
    // Put the server's answer straight into the cache: the screen updates without a reload.
    onSuccess: (user) => {
      queryClient.setQueryData<MeData>(ME_KEY, (old) => (old ? { ...old, user } : old));
      setEditingName(false);
    },
  });

  // Logging out ends the session; the root layout's guard then shows the login screen.
  const logOut = useMutation({ mutationFn: logout });

  const roleLabel: Record<MyInstitute['role'], string> = {
    owner: t('me.roleOwner'),
    teacher: t('me.roleTeacher'),
    staff: t('me.roleStaff'),
  };

  const name = me.data?.user.name ?? null;
  const trimmedDraft = nameDraft.trim();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Who you are. Loading / error only affect this part: settings and logout always work,
          even offline. */}
      <View style={styles.profile}>
        <Avatar.Text size={64} label={initials(name)} />
        <View style={styles.profileText}>
          {me.isPending ? (
            <ActivityIndicator />
          ) : me.isError ? (
            <>
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, me.error)}</Text>
              <Button compact onPress={() => void me.refetch()}>
                {t('common.retry')}
              </Button>
            </>
          ) : (
            <Button
              mode="text"
              icon="pencil"
              compact
              contentStyle={styles.nameButton}
              onPress={() => {
                setNameDraft(name ?? '');
                saveName.reset();
                setEditingName(true);
              }}
            >
              {name ?? t('me.addName')}
            </Button>
          )}
          {lastPhone && (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              +91 {lastPhone.slice(0, 5)} {lastPhone.slice(5)}
            </Text>
          )}
        </View>
      </View>

      <Divider />

      <List.Section>
        <List.Subheader>{t('me.institutes')}</List.Subheader>
        {me.data?.institutes.length === 0 && (
          <List.Item
            title={t('me.noInstitutes')}
            left={(props) => <List.Icon {...props} icon="domain" />}
          />
        )}
        {me.data?.institutes.map((institute) => {
          const isCurrent = institute.id === current?.id;
          return (
            <List.Item
              key={institute.id}
              title={institute.name}
              description={roleLabel[institute.role]}
              left={(props) => <List.Icon {...props} icon="domain" />}
              // A check mark on the institute the app is working in now.
              right={(props) =>
                isCurrent ? (
                  <List.Icon {...props} icon="check" color={theme.colors.primary} />
                ) : null
              }
              // Tap another one to switch to it. The home screen follows the saved choice;
              // dismissTo('/') goes BACK to the home screen already open, instead of
              // stacking a second copy on top of this one.
              onPress={
                isCurrent
                  ? undefined
                  : () => {
                      setCurrentInstitute(institute.id);
                      router.dismissTo('/');
                    }
              }
            />
          );
        })}
        <List.Item
          title={t('welcome.createAnother')}
          left={(props) => <List.Icon {...props} icon="plus" />}
          onPress={() => router.push('/create-institute')}
        />
      </List.Section>

      <Divider />

      <List.Section>
        <List.Subheader>{t('me.appearance')}</List.Subheader>
        <View style={styles.settings}>
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
        </View>
      </List.Section>

      <Button
        mode="outlined"
        icon="logout"
        textColor={theme.colors.error}
        style={styles.logout}
        onPress={() => setConfirmingLogout(true)}
      >
        {t('me.logout')}
      </Button>

      {/* Portal draws dialogs ABOVE the whole screen (PaperProvider hosts them). */}
      <Portal>
        <Dialog visible={editingName} onDismiss={() => setEditingName(false)}>
          <Dialog.Title>{t('me.editName')}</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <TextInput
              mode="outlined"
              label={t('me.nameLabel')}
              value={nameDraft}
              onChangeText={setNameDraft}
              maxLength={60} // the API's limit (User name: 1-60 characters)
              autoFocus
              autoCapitalize="words"
              autoComplete="name"
            />
            {saveName.isError && (
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, saveName.error)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditingName(false)}>{t('common.cancel')}</Button>
            <Button
              onPress={() => saveName.mutate(trimmedDraft)}
              disabled={trimmedDraft === '' || saveName.isPending}
              loading={saveName.isPending}
            >
              {t('common.save')}
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={confirmingLogout} onDismiss={() => setConfirmingLogout(false)}>
          <Dialog.Title>{t('me.logoutTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text>{t('me.logoutBody')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmingLogout(false)}>{t('common.cancel')}</Button>
            <Button
              textColor={theme.colors.error}
              onPress={() => logOut.mutate()}
              loading={logOut.isPending}
              disabled={logOut.isPending}
            >
              {t('me.logout')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

/** "Neha Sharma" -> "NS"; no name yet -> "?". */
function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  profileText: { flex: 1, alignItems: 'flex-start', gap: 4 },
  // The name button looks like a title, aligned to the left edge.
  nameButton: { flexDirection: 'row-reverse' },
  settings: { paddingHorizontal: 16, gap: 12 },
  logout: { marginHorizontal: 16, marginTop: 24 },
  dialogContent: { gap: 8 },
});
