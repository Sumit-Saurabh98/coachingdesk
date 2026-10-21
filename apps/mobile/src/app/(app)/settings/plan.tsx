// Plan and usage (owner): the plan that applies now, how much of it is used, and the plans to
// choose from. Paying for a plan in the app needs the payment provider (not set up yet).
import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, ProgressBar, Text } from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { rupees } from '@/fees/rupees';
import { getPlans, getSubscription, planKeys } from '@/institutes/institutes-api';
import { sortPlans, statusLine, usageBar } from '@/institutes/plan-rules';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import { useAppTheme } from '@/theme/theme';

const PLAN_NAMES = ['free', 'starter', 'pro', 'academy'] as const;
type PlanName = (typeof PLAN_NAMES)[number];
const isPlanName = (id: string): id is PlanName => (PLAN_NAMES as readonly string[]).includes(id);

export default function PlanScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const isOwner = current?.role === 'owner';

  const subscription = useQuery({
    queryKey: planKeys.subscription(instituteId),
    queryFn: ({ signal }) => getSubscription(instituteId, signal),
    enabled: instituteId !== '' && isOwner,
  });
  const plans = useQuery({
    queryKey: planKeys.plans,
    queryFn: ({ signal }) => getPlans(signal),
    staleTime: 60 * 60 * 1000, // prices rarely change
  });

  if (!isOwner) {
    return <Redirect href="/" />;
  }
  if (!subscription.data) {
    return (
      <View style={styles.centered}>
        {subscription.isError ? (
          <>
            <Text style={{ color: theme.colors.error }}>{errorMessage(t, subscription.error)}</Text>
            <Button mode="contained" onPress={() => void subscription.refetch()}>
              {t('common.retry')}
            </Button>
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }

  const sub = subscription.data;
  const name = (id: string) => (isPlanName(id) ? t(`plan.name.${id}`) : id);
  const line = statusLine(sub);
  const date = (iso: string) => formatLocalDate(toLocalDateString(new Date(iso)), months);
  const limitText = (limit: number | null) =>
    limit === null ? t('plan.unlimited') : String(limit);

  const usage = (label: string, used: number, limit: number | null) => {
    const bar = usageBar(used, limit);
    return (
      <View style={styles.usage}>
        <View style={styles.row}>
          <Text variant="bodyMedium">{label}</Text>
          <Text variant="bodyMedium">
            {limit === null ? t('plan.usedUnlimited', { used }) : t('plan.usedOf', { used, limit })}
          </Text>
        </View>
        {bar.share !== null && (
          <ProgressBar
            progress={bar.share}
            color={bar.near ? theme.colors.error : theme.colors.primary}
          />
        )}
      </View>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={subscription.isRefetching}
          onRefresh={() => void subscription.refetch()}
        />
      }
    >
      <Card mode="contained" style={{ backgroundColor: theme.colors.primaryContainer }}>
        <Card.Content style={styles.gap}>
          <Text variant="labelLarge" style={{ color: theme.colors.onPrimaryContainer }}>
            {t('plan.current')}
          </Text>
          <Text variant="headlineSmall" style={{ color: theme.colors.onPrimaryContainer }}>
            {name(sub.plan)}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onPrimaryContainer }}>
            {t(line.key, { date: line.date ? date(line.date) : '' })}
          </Text>
        </Card.Content>
      </Card>

      <Card mode="outlined">
        <Card.Content style={styles.gap}>
          {usage(t('plan.students'), sub.usage.activeStudents, sub.limits.maxActiveStudents)}
          {usage(t('plan.team'), sub.usage.members, sub.limits.maxMembers)}
          {usage(t('plan.messages'), sub.usage.messages, sub.limits.monthlyMessages)}
        </Card.Content>
      </Card>

      <Text variant="titleMedium" style={styles.section}>
        {t('plan.choose')}
      </Text>
      {sortPlans(plans.data ?? []).map((p) => {
        const isCurrent = p.id === sub.plan;
        return (
          <Card
            key={p.id}
            mode={isCurrent ? 'contained' : 'outlined'}
            style={isCurrent ? { backgroundColor: theme.colors.secondaryContainer } : undefined}
          >
            <Card.Content style={styles.gap}>
              <View style={styles.row}>
                <Text variant="titleMedium">{name(p.id)}</Text>
                {isCurrent && <Chip compact>{t('plan.yours')}</Chip>}
              </View>
              <Text variant="titleLarge">
                {p.monthlyPricePaise === 0
                  ? t('plan.freePrice')
                  : t('plan.price', {
                      monthly: rupees(p.monthlyPricePaise),
                      yearly: rupees(p.yearlyPricePaise),
                    })}
              </Text>
              <Text variant="bodyMedium">
                {t('plan.limits', {
                  students: limitText(p.maxActiveStudents),
                  team: limitText(p.maxMembers),
                  messages: p.monthlyMessages,
                })}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {[
                  p.features.includes('automatic_messages')
                    ? t('plan.featureMessages')
                    : t('plan.featureManual'),
                  p.features.includes('result_cards') ? t('plan.featureResults') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Card.Content>
          </Card>
        );
      })}

      <Button mode="contained" icon="arrow-up-bold-circle-outline" disabled>
        {t('plan.upgrade')}
      </Button>
      <Text variant="bodySmall" style={[styles.center, { color: theme.colors.onSurfaceVariant }]}>
        {t('plan.upgradeSoon')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  gap: { gap: 6 },
  usage: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { marginTop: 8 },
  center: { textAlign: 'center' },
});
