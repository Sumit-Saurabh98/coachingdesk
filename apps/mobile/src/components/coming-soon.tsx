// A placeholder for tabs whose real screen comes in a later step (Students: Step 30, Fees: 32).
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useAppTheme } from '@/theme/theme';

export function ComingSoon({ icon }: { icon: keyof typeof MaterialCommunityIcons.glyphMap }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  return (
    <View style={styles.centered}>
      <MaterialCommunityIcons name={icon} size={48} color={theme.colors.onSurfaceVariant} />
      <Text variant="titleMedium">{t('comingSoon.title')}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('comingSoon.body')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
});
