// "I agree to the Terms of Service and Privacy Policy" with both names as links. The sentence
// is split into pieces because the word order differs in Hindi ("मैं … से सहमत हूँ").
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { useAppTheme } from '@/theme/theme';
import { openLegalPage } from './open-legal-page';

export function AgreeTermsText() {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const link = { color: theme.colors.primary, textDecorationLine: 'underline' } as const;
  return (
    <Text variant="bodyMedium">
      {t('legal.agreeStart')}
      <Text style={link} onPress={() => openLegalPage('terms', i18n.language)}>
        {t('legal.terms')}
      </Text>
      {t('legal.agreeMiddle')}
      <Text style={link} onPress={() => openLegalPage('privacy', i18n.language)}>
        {t('legal.privacy')}
      </Text>
      {t('legal.agreeEnd')}
    </Text>
  );
}
