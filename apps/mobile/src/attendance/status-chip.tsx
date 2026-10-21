// One attendance status as a coloured chip: the same colours everywhere (register, history).
import type { AttendanceStatus } from '@coachingdesk/shared';
import { useTranslation } from 'react-i18next';
import { Chip } from 'react-native-paper';
import { useAppTheme } from '@/theme/theme';

export function AttendanceStatusChip({ status }: { status: AttendanceStatus }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const colours: Record<AttendanceStatus, { bg: string; fg: string }> = {
    present: { bg: theme.colors.successContainer, fg: theme.colors.onSuccessContainer },
    absent: { bg: theme.colors.errorContainer, fg: theme.colors.onErrorContainer },
    late: { bg: theme.colors.warningContainer, fg: theme.colors.onWarningContainer },
    leave: { bg: theme.colors.surfaceVariant, fg: theme.colors.onSurfaceVariant },
  };
  return (
    <Chip
      compact
      style={{ backgroundColor: colours[status].bg }}
      textStyle={{ color: colours[status].fg }}
    >
      {t(`register.${status}`)}
    </Chip>
  );
}
