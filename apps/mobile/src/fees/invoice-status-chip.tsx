// An invoice's status as a coloured chip, the same on every fees screen.
import { useTranslation } from 'react-i18next';
import { Chip } from 'react-native-paper';
import { useAppTheme } from '@/theme/theme';
import type { InvoiceTone } from './invoice-rules';

export function InvoiceStatusChip({ tone }: { tone: InvoiceTone }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const colours: Record<InvoiceTone, { bg: string; fg: string }> = {
    overdue: { bg: theme.colors.errorContainer, fg: theme.colors.onErrorContainer },
    due: { bg: theme.colors.secondaryContainer, fg: theme.colors.onSecondaryContainer },
    partially_paid: { bg: theme.colors.warningContainer, fg: theme.colors.onWarningContainer },
    paid: { bg: theme.colors.successContainer, fg: theme.colors.onSuccessContainer },
    waived: { bg: theme.colors.surfaceVariant, fg: theme.colors.onSurfaceVariant },
    cancelled: { bg: theme.colors.surfaceVariant, fg: theme.colors.onSurfaceVariant },
  };
  return (
    <Chip
      compact
      style={{ backgroundColor: colours[tone].bg }}
      textStyle={{ color: colours[tone].fg }}
    >
      {t(`invoice.status.${tone}`)}
    </Chip>
  );
}
