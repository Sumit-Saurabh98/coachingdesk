// A student's profile: who they are, how to reach the guardian, their batches (and fees, for
// owner/staff), the family's credit, and the actions: add to a batch, remove from one, and
// mark as left. Editing the details is the next step (30d).
import { Money } from '@coachingdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  Dialog,
  List,
  Portal,
  Text,
} from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { batchKeys, listBatches } from '@/batches/batches-api';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, toLocalDateString } from '@/lib/date-format';
import { formatIndianPhone } from '@/lib/phone-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import {
  type Enrollment,
  isOpenOn,
  joinableBatches,
  telLink,
  whatsAppLink,
} from '@/students/profile-rules';
import {
  endEnrollment,
  enrollInBatch,
  getStudent,
  markStudentLeft,
  studentKeys,
} from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';

export default function StudentScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canManage = current?.role === 'owner' || current?.role === 'staff';
  // The phone's date. In India the phone and the institute share a time zone.
  const today = toLocalDateString(new Date());

  // Which dialog is open: add to a batch, remove from one (which), or mark as left.
  const [dialog, setDialog] = useState<
    { kind: 'add' } | { kind: 'remove'; enrollment: Enrollment } | { kind: 'left' } | null
  >(null);

  const detail = useQuery({
    queryKey: studentKeys.detail(instituteId, id),
    queryFn: ({ signal }) => getStudent(instituteId, id, signal),
    enabled: instituteId !== '',
  });
  // All batches, archived too: an old enrollment may point to an archived batch.
  const batches = useQuery({
    queryKey: batchKeys.list(instituteId, true),
    queryFn: ({ signal }) => listBatches(instituteId, true, signal),
    enabled: instituteId !== '',
  });

  // After any change: this student, the student lists, and batch counts are out of date.
  const refreshAll = async () => {
    setDialog(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: studentKeys.all(instituteId) }),
      queryClient.invalidateQueries({ queryKey: batchKeys.all(instituteId) }),
    ]);
  };
  const addToBatch = useMutation({
    mutationFn: (batchId: string) => enrollInBatch(instituteId, id, batchId),
    onSuccess: refreshAll,
  });
  const removeFromBatch = useMutation({
    mutationFn: (enrollmentId: string) => endEnrollment(instituteId, enrollmentId, today),
    onSuccess: refreshAll,
  });
  const markLeft = useMutation({
    mutationFn: () => markStudentLeft(instituteId, id),
    onSuccess: refreshAll,
  });
  // Opening a dialog clears the previous attempt's error.
  const openDialog = (next: NonNullable<typeof dialog>) => {
    addToBatch.reset();
    removeFromBatch.reset();
    markLeft.reset();
    setDialog(next);
  };

  if (detail.isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (detail.isError) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: theme.colors.error }}>{errorMessage(t, detail.error)}</Text>
        <Button mode="contained" onPress={() => void detail.refetch()}>
          {t('common.retry')}
        </Button>
      </View>
    );
  }

  const { student, enrollments, guardianCreditPaise } = detail.data;
  const isLeft = student.status === 'left';
  // Changes are allowed for owner/staff, on an active student who isn't frozen by the plan.
  const canChange = canManage && !isLeft && student.readOnly !== true;
  const batchName = (batchId: string) =>
    batches.data?.find((batch) => batch.id === batchId)?.name ?? '…';
  const currentEnrollments = enrollments.filter((e) => isOpenOn(e, today));
  const joinable = joinableBatches(batches.data ?? [], enrollments, today);
  const phone = student.guardianPhone;

  const feeText = (enrollment: Enrollment): string | null => {
    // Teachers get no fee fields: nothing to show.
    if (enrollment.netFeePaise === undefined || enrollment.feeCycle === undefined) {
      return null;
    }
    if (enrollment.feeCycle === 'none') {
      return t('feeCycle.none');
    }
    const fee = `${Money.ofPaise(enrollment.netFeePaise).format()} ${t(`feeCycle.${enrollment.feeCycle}`)}`;
    return enrollment.discountPaise
      ? `${fee} · ${t('student.discount', { discount: Money.ofPaise(enrollment.discountPaise).format() })}`
      : fee;
  };

  const anyMutation = addToBatch.isPending || removeFromBatch.isPending || markLeft.isPending;
  const dialogError = addToBatch.error ?? removeFromBatch.error ?? markLeft.error;

  return (
    <>
      <Stack.Screen options={{ title: student.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.badges}>
          {isLeft && (
            <Chip compact icon="logout">
              {student.leftOn
                ? t('student.leftOn', { date: formatLocalDate(student.leftOn, months) })
                : t('student.leftBadge')}
            </Chip>
          )}
          <Chip compact icon="calendar-check-outline">
            {t('student.joinedOn', { date: formatLocalDate(student.joinedOn, months) })}
          </Chip>
        </View>

        {student.readOnly === true && (
          <Card mode="contained" style={{ backgroundColor: theme.colors.surfaceVariant }}>
            <Card.Content>
              <Text>{t('student.readOnly')}</Text>
            </Card.Content>
          </Card>
        )}

        {/* The guardian, with one-tap call and WhatsApp (every member calls parents). */}
        {phone !== null && (
          <Card mode="outlined">
            <Card.Title
              title={student.guardianName ?? t('student.guardian')}
              subtitle={formatIndianPhone(phone)}
              left={(props) => <List.Icon {...props} icon="account-child-outline" />}
            />
            <Card.Actions>
              <Button icon="phone" onPress={() => void Linking.openURL(telLink(phone))}>
                {t('student.call')}
              </Button>
              <Button icon="whatsapp" onPress={() => void Linking.openURL(whatsAppLink(phone))}>
                {t('student.whatsapp')}
              </Button>
            </Card.Actions>
          </Card>
        )}

        {/* Family credit: only sent to owner/staff, and only worth showing when there is some. */}
        {guardianCreditPaise !== undefined && guardianCreditPaise > 0 && (
          <List.Item
            title={`${t('student.credit')}: ${Money.ofPaise(guardianCreditPaise).format()}`}
            description={t('student.creditHelp')}
            descriptionNumberOfLines={2}
            left={(props) => <List.Icon {...props} icon="wallet-plus-outline" />}
          />
        )}

        <List.Section>
          <List.Subheader>{t('student.batches')}</List.Subheader>
          {currentEnrollments.length === 0 && <List.Item title={t('student.notInBatch')} />}
          {currentEnrollments.map((enrollment) => (
            <List.Item
              key={enrollment.id}
              title={batchName(enrollment.batchId)}
              description={[
                t('student.since', { date: formatLocalDate(enrollment.startDate, months) }),
                enrollment.endDate
                  ? t('student.until', { date: formatLocalDate(enrollment.endDate, months) })
                  : null,
                feeText(enrollment),
              ]
                .filter(Boolean)
                .join('\n')}
              descriptionNumberOfLines={3}
              left={(props) => <List.Icon {...props} icon="google-classroom" />}
              right={(props) =>
                canChange && enrollment.endDate === null ? (
                  <Button
                    {...props}
                    compact
                    onPress={() => openDialog({ kind: 'remove', enrollment })}
                  >
                    {t('student.removeFromBatch')}
                  </Button>
                ) : null
              }
            />
          ))}
        </List.Section>

        {student.notes !== null && (
          <List.Item
            title={student.notes}
            description={t('student.notes')}
            titleNumberOfLines={6}
            left={(props) => <List.Icon {...props} icon="note-text-outline" />}
          />
        )}

        {canChange && (
          <View style={styles.actions}>
            <Button
              mode="contained-tonal"
              icon="pencil"
              onPress={() => router.push({ pathname: '/students/[id]/edit', params: { id } })}
            >
              {t('student.edit')}
            </Button>
            <Button mode="contained" icon="plus" onPress={() => openDialog({ kind: 'add' })}>
              {t('student.addToBatch')}
            </Button>
            <Button mode="outlined" icon="logout" onPress={() => openDialog({ kind: 'left' })}>
              {t('student.markLeft')}
            </Button>
          </View>
        )}
      </ScrollView>

      <Portal>
        {/* Add to a batch: tap one of the batches the student can still join. */}
        <Dialog visible={dialog?.kind === 'add'} onDismiss={() => setDialog(null)}>
          <Dialog.Title>{t('student.addToBatch')}</Dialog.Title>
          <Dialog.Content>
            {joinable.length === 0 && <Text>{t('student.noBatchToJoin')}</Text>}
            {joinable.map((batch) => (
              <List.Item
                key={batch.id}
                title={batch.name}
                left={(props) => <List.Icon {...props} icon="google-classroom" />}
                onPress={anyMutation ? undefined : () => addToBatch.mutate(batch.id)}
              />
            ))}
            {addToBatch.isPending && <ActivityIndicator />}
            {dialogError !== null && (
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, dialogError)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>{t('common.cancel')}</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={dialog?.kind === 'remove'} onDismiss={() => setDialog(null)}>
          <Dialog.Title>
            {dialog?.kind === 'remove'
              ? t('student.removeTitle', { batch: batchName(dialog.enrollment.batchId) })
              : ''}
          </Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text>{t('student.removeBody')}</Text>
            {dialogError !== null && (
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, dialogError)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button
              loading={removeFromBatch.isPending}
              disabled={anyMutation}
              onPress={() => {
                if (dialog?.kind === 'remove') {
                  removeFromBatch.mutate(dialog.enrollment.id);
                }
              }}
            >
              {t('student.removeFromBatch')}
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={dialog?.kind === 'left'} onDismiss={() => setDialog(null)}>
          <Dialog.Title>{t('student.leftTitle', { name: student.name })}</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text>{t('student.leftBody')}</Text>
            {dialogError !== null && (
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, dialogError)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button
              textColor={theme.colors.error}
              loading={markLeft.isPending}
              disabled={anyMutation}
              onPress={() => markLeft.mutate()}
            >
              {t('student.markLeft')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  content: { padding: 16, gap: 12 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { gap: 12, marginTop: 8 },
  dialogContent: { gap: 8 },
});
