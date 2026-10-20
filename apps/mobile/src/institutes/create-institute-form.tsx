// The "create institute" form. ONE component, used in two places: the welcome screen (first
// institute) and "create another institute". The parent decides what happens afterwards.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { ME_KEY, type MeData } from '@/auth/use-me';
import { usePreferences } from '@/stores/preferences';
import { useAppTheme } from '@/theme/theme';
import type { MyInstitute } from './current-institute';
import { createInstitute } from './institutes-api';

// The API's rules (Institute.create): name 2-80 characters, city at most 60.
const NAME_MIN = 2;
const NAME_MAX = 80;
const CITY_MAX = 60;

interface Props {
  /** Called once the institute exists and is the current one. */
  onCreated?: (institute: MyInstitute) => void;
}

export function CreateInstituteForm({ onCreated }: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const setCurrentInstitute = usePreferences((state) => state.setCurrentInstitute);

  const [name, setName] = useState('');
  const [type, setType] = useState<MyInstitute['type']>('tuition');
  const [city, setCity] = useState('');
  const [triedToSubmit, setTriedToSubmit] = useState(false);

  // Checked here for instant feedback; the API checks the same rules again (it decides).
  // Spaces are tidied the same way the API does it ("  Sharma   Classes " -> "Sharma Classes").
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const cleanCity = city.trim();
  const nameValid = cleanName.length >= NAME_MIN && cleanName.length <= NAME_MAX;
  const cityValid = cleanCity.length <= CITY_MAX;

  const create = useMutation({
    mutationFn: () =>
      createInstitute({ name: cleanName, type, city: cleanCity === '' ? null : cleanCity }),
    onSuccess: ({ institute, role }) => {
      const created: MyInstitute = { ...institute, role };
      // Add it to the cached "me" right away: the app can switch to it without waiting
      // for a reload. Then refetch in the background, so the cache matches the server.
      queryClient.setQueryData<MeData>(ME_KEY, (old) =>
        old ? { ...old, institutes: [...old.institutes, created] } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
      setCurrentInstitute(created.id);
      onCreated?.(created);
    },
  });

  const submit = () => {
    setTriedToSubmit(true);
    if (nameValid && cityValid && !create.isPending) {
      create.mutate();
    }
  };

  return (
    <View style={styles.form}>
      <View>
        <TextInput
          mode="outlined"
          label={t('institute.nameLabel')}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX + 20} // a little slack for spaces the cleaning removes
          autoCapitalize="words"
          error={triedToSubmit && !nameValid}
        />
        <HelperText type="error" visible={triedToSubmit && !nameValid}>
          {t('institute.nameInvalid')}
        </HelperText>
      </View>

      <Text variant="labelLarge">{t('institute.typeLabel')}</Text>
      <SegmentedButtons
        value={type}
        onValueChange={setType}
        buttons={[
          { value: 'tuition', label: t('institute.typeTuition') },
          { value: 'academy', label: t('institute.typeAcademy') },
          { value: 'home_tutor', label: t('institute.typeHomeTutor') },
        ]}
      />

      <View>
        <TextInput
          mode="outlined"
          label={t('institute.cityLabel')}
          value={city}
          onChangeText={setCity}
          autoCapitalize="words"
          error={!cityValid}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <HelperText type="error" visible={!cityValid}>
          {t('institute.cityInvalid')}
        </HelperText>
      </View>

      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('institute.trialNote')}
      </Text>

      {create.isError && (
        <Text style={{ color: theme.colors.error }}>{errorMessage(t, create.error)}</Text>
      )}

      <Button
        mode="contained"
        onPress={submit}
        loading={create.isPending}
        disabled={create.isPending}
        contentStyle={styles.buttonContent}
      >
        {t('institute.create')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  buttonContent: { paddingVertical: 6 },
});
