import { useTranslation } from 'react-i18next';
import type { ScheduleLabels } from './schedule-format';

/** The weekday names and AM/PM in the current language, for schedule-format.ts. */
export function useScheduleLabels(): ScheduleLabels {
  const { t } = useTranslation();
  return {
    weekdays: [
      t('schedule.mon'),
      t('schedule.tue'),
      t('schedule.wed'),
      t('schedule.thu'),
      t('schedule.fri'),
      t('schedule.sat'),
      t('schedule.sun'),
    ],
    everyDay: t('schedule.everyDay'),
    am: t('schedule.am'),
    pm: t('schedule.pm'),
  };
}
