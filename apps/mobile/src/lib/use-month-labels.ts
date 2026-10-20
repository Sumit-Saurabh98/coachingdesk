import { useTranslation } from 'react-i18next';

/** Short month names in the current language, January first (for date-format.ts). */
export function useMonthLabels(): readonly string[] {
  const { t } = useTranslation();
  return [
    t('months.jan'),
    t('months.feb'),
    t('months.mar'),
    t('months.apr'),
    t('months.may'),
    t('months.jun'),
    t('months.jul'),
    t('months.aug'),
    t('months.sep'),
    t('months.oct'),
    t('months.nov'),
    t('months.dec'),
  ];
}
