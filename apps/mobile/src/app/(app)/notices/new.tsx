// "New notice" (any member): a holiday, a timing change, or a short message to the parents of
// chosen batches. The structured kinds come first: WhatsApp approves those templates more
// easily than free text. Before sending, the app shows how many parents it will reach (FR-6.3).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  Dialog,
  HelperText,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { DatePickerModal, TimePickerModal } from 'react-native-paper-dates';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { batchKeys, listBatches } from '@/batches/batches-api';
import { fromHHMM, toHHMM } from '@/batches/batch-form-rules';
import { formatTime } from '@/batches/schedule-format';
import { useScheduleLabels } from '@/batches/use-schedule-labels';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '@/lib/date-format';
import { useMonthLabels } from '@/lib/use-month-labels';
import {
  type NoticeFormValues,
  nextDay,
  toggleBatch,
  toNoticeRequest,
  validateNotice,
  withKind,
} from '@/notices/notice-rules';
import { noticeKeys, previewNotice, sendNotice } from '@/notices/notices-api';
import { useAppTheme } from '@/theme/theme';

type Picking = 'date' | 'resumeDate' | 'time' | null;

export default function NewNoticeScreen() {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const months = useMonthLabels();
  const labels = useScheduleLabels();
  const queryClient = useQueryClient();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const today = toLocalDateString(new Date());

  const [values, setValues] = useState<NoticeFormValues>({
    kind: 'holiday',
    batchIds: [],
    text: '',
    date: today,
    resumeDate: nextDay(today),
    reason: '',
    time: '17:00',
  });
  const [tried, setTried] = useState(false);
  const [picking, setPicking] = useState<Picking>(null);
  const set = <K extends keyof NoticeFormValues>(field: K, value: NoticeFormValues[K]) =>
    setValues((v) => ({ ...v, [field]: value }));

  const batches = useQuery({
    queryKey: batchKeys.list(instituteId, false),
    queryFn: ({ signal }) => listBatches(instituteId, false, signal),
    enabled: instituteId !== '',
  });

  const preview = useMutation({
    mutationFn: () => previewNotice(instituteId, toNoticeRequest(values)),
  });
  const send = useMutation({
    mutationFn: () => sendNotice(instituteId, toNoticeRequest(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: noticeKeys.all(instituteId) });
      router.back();
    },
  });

  const errors = validateNotice(values, today);
  const shown = tried ? errors : {};
  const review = () => {
    setTried(true);
    if (Object.keys(errors).length === 0) {
      send.reset();
      preview.mutate();
    }
  };

  /** The refusals worth explaining in our own words. */
  const failure = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'FEATURE_NOT_IN_PLAN') {
      return t('notices.notInPlan');
    }
    if (error instanceof ApiError && error.code === 'DAILY_LIMIT_REACHED') {
      const limit = error.details.limit;
      return t('notices.dailyLimit', { limit: typeof limit === 'number' ? limit : '' });
    }
    return errorMessage(t, error);
  };

  const dateButton = (field: 'date' | 'resumeDate', label: string) => (
    <View style={styles.row}>
      <Text variant="labelLarge">{label}</Text>
      <Button mode="outlined" icon="calendar" onPress={() => setPicking(field)}>
        {formatLocalDate(values[field], months)}
      </Button>
    </View>
  );

  const counts = preview.data;
  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <SegmentedButtons
        value={values.kind}
        onValueChange={(kind) => setValues((v) => withKind(v, kind))}
        buttons={[
          { value: 'holiday', label: t('notices.kindHoliday'), icon: 'beach' },
          { value: 'schedule_change', label: t('notices.kindChange'), icon: 'clock-edit-outline' },
          { value: 'general', label: t('notices.kindGeneral'), icon: 'bullhorn-outline' },
        ]}
      />

      <Text variant="labelLarge" style={styles.label}>
        {values.kind === 'schedule_change' ? t('notices.whichBatch') : t('notices.whichBatches')}
      </Text>
      <View style={styles.chips}>
        {(batches.data ?? []).map((batch) => (
          <Chip
            key={batch.id}
            selected={values.batchIds.includes(batch.id)}
            showSelectedCheck
            onPress={() => set('batchIds', toggleBatch(values, batch.id))}
          >
            {batch.name}
          </Chip>
        ))}
      </View>
      <HelperText type="error" visible={shown.batchIds !== undefined}>
        {shown.batchIds ? t(shown.batchIds) : ''}
      </HelperText>

      {values.kind === 'holiday' && (
        <>
          {dateButton('date', t('notices.holidayFrom'))}
          <HelperText type="error" visible={shown.date !== undefined}>
            {t('notices.datePast')}
          </HelperText>
          {dateButton('resumeDate', t('notices.resumeOn'))}
          <HelperText type="error" visible={shown.resumeDate !== undefined}>
            {t('notices.resumeAfter')}
          </HelperText>
          <TextInput
            mode="outlined"
            label={t('notices.reason')}
            placeholder={t('notices.reasonExample')}
            value={values.reason}
            onChangeText={(text) => set('reason', text)}
            maxLength={80}
            error={shown.reason !== undefined}
          />
          <HelperText type="error" visible={shown.reason !== undefined}>
            {shown.reason ? t(shown.reason) : ''}
          </HelperText>
        </>
      )}

      {values.kind === 'schedule_change' && (
        <>
          {dateButton('date', t('notices.onDate'))}
          <HelperText type="error" visible={shown.date !== undefined}>
            {t('notices.datePast')}
          </HelperText>
          <View style={styles.row}>
            <Text variant="labelLarge">{t('notices.newTime')}</Text>
            <Button mode="outlined" icon="clock-outline" onPress={() => setPicking('time')}>
              {formatTime(values.time, labels)}
            </Button>
          </View>
        </>
      )}

      {values.kind === 'general' && (
        <>
          <TextInput
            mode="outlined"
            label={t('notices.message')}
            value={values.text}
            onChangeText={(text) => set('text', text)}
            multiline
            maxLength={500}
            style={styles.message}
            error={shown.text !== undefined}
          />
          <HelperText type={shown.text ? 'error' : 'info'} visible>
            {shown.text ? t(shown.text) : t('notices.messageHelp', { count: values.text.length })}
          </HelperText>
        </>
      )}

      {preview.isError && (
        <Text style={[styles.error, { color: theme.colors.error }]}>{failure(preview.error)}</Text>
      )}

      <Button
        mode="contained"
        icon="account-group-outline"
        onPress={review}
        loading={preview.isPending}
        disabled={preview.isPending}
        style={styles.submit}
        contentStyle={styles.buttonContent}
      >
        {t('notices.review')}
      </Button>

      <Portal>
        <Dialog visible={counts !== undefined} onDismiss={() => preview.reset()}>
          <Dialog.Title>{t('notices.confirmTitle')}</Dialog.Title>
          <Dialog.Content style={styles.dialog}>
            {counts && counts.recipients === 0 ? (
              <Text variant="bodyMedium">{t('notices.noRecipients')}</Text>
            ) : (
              counts && (
                <>
                  <Text variant="bodyLarge">
                    {t('notices.goesTo', { count: counts.recipients })}
                  </Text>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('notices.quotaLeft', { count: counts.quotaRemaining })}
                  </Text>
                  {counts.messagesNeeded > counts.quotaRemaining && (
                    <Text variant="bodyMedium" style={{ color: theme.colors.error }}>
                      {t('notices.overQuota', { count: counts.quotaRemaining })}
                    </Text>
                  )}
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('notices.consentNote')}
                  </Text>
                </>
              )
            )}
            {send.isError && (
              <Text style={{ color: theme.colors.error }}>{failure(send.error)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => preview.reset()}>{t('common.cancel')}</Button>
            <Button
              loading={send.isPending}
              disabled={send.isPending || (counts?.recipients ?? 0) === 0}
              onPress={() => send.mutate()}
            >
              {t('notices.send')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <DatePickerModal
        mode="single"
        locale={i18n.language}
        visible={picking === 'date' || picking === 'resumeDate'}
        label={picking === 'resumeDate' ? t('notices.resumeOn') : t('notices.onDate')}
        date={fromLocalDateString(picking === 'resumeDate' ? values.resumeDate : values.date)}
        validRange={{ startDate: fromLocalDateString(today) }}
        onDismiss={() => setPicking(null)}
        onConfirm={({ date }) => {
          if (date && (picking === 'date' || picking === 'resumeDate')) {
            set(picking, toLocalDateString(date));
          }
          setPicking(null);
        }}
      />
      <TimePickerModal
        visible={picking === 'time'}
        locale={i18n.language}
        label={t('notices.newTime')}
        {...fromHHMM(values.time)}
        onDismiss={() => setPicking(null)}
        onConfirm={({ hours, minutes }) => {
          set('time', toHHMM(hours, minutes));
          setPicking(null);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16 },
  label: { marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  message: { minHeight: 120 },
  error: { marginTop: 8 },
  submit: { marginTop: 16 },
  buttonContent: { paddingVertical: 6 },
  dialog: { gap: 8 },
});
