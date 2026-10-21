// The team (owner): who can open this institute in the app, and as what. Teachers take
// attendance and marks; staff run the front desk (students, fees); neither sees settings.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  FAB,
  HelperText,
  IconButton,
  List,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { ApiError } from '@/api';
import { errorMessage } from '@/api/error-message';
import { addMember, listMembers, memberKeys, removeMember } from '@/institutes/institutes-api';
import {
  type Member,
  type NewMemberValues,
  sortTeam,
  toAddMemberRequest,
  validateNewMember,
} from '@/institutes/team-rules';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatIndianPhone } from '@/lib/phone-format';
import { useAppTheme } from '@/theme/theme';

const EMPTY: NewMemberValues = { phone: '', name: '', role: 'teacher' };

export default function TeamScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const isOwner = current?.role === 'owner';

  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState<NewMemberValues>(EMPTY);
  const [tried, setTried] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);

  const members = useQuery({
    queryKey: memberKeys.all(instituteId),
    queryFn: ({ signal }) => listMembers(instituteId, signal),
    enabled: instituteId !== '' && isOwner,
  });
  const add = useMutation({
    mutationFn: () => addMember(instituteId, toAddMemberRequest(values)),
    onSuccess: async () => {
      setAdding(false);
      setValues(EMPTY);
      setTried(false);
      await queryClient.invalidateQueries({ queryKey: memberKeys.all(instituteId) });
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(instituteId, userId),
    onSuccess: async () => {
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: memberKeys.all(instituteId) });
    },
  });

  if (!isOwner) {
    return <Redirect href="/" />;
  }

  const errors = validateNewMember(values);
  const shown = tried ? errors : {};
  const addFailure = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'PLAN_LIMIT_REACHED') {
      const limit = error.details.limit;
      return typeof limit === 'number' && limit > 0
        ? t('team.limit', { limit })
        : t('team.notInPlan');
    }
    if (error instanceof ApiError && error.status === 409) {
      return t('team.already');
    }
    return errorMessage(t, error);
  };

  return (
    <View style={styles.screen}>
      {!members.data ? (
        <View style={styles.centered}>
          {members.isError ? (
            <>
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, members.error)}</Text>
              <Button mode="contained" onPress={() => void members.refetch()}>
                {t('common.retry')}
              </Button>
            </>
          ) : (
            <ActivityIndicator size="large" />
          )}
        </View>
      ) : (
        <FlatList
          data={sortTeam(members.data)}
          keyExtractor={(m) => m.userId}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text
              variant="bodyMedium"
              style={[styles.help, { color: theme.colors.onSurfaceVariant }]}
            >
              {t('team.help')}
            </Text>
          }
          renderItem={({ item }) => (
            <List.Item
              title={item.name ?? formatIndianPhone(item.phone)}
              description={`${t(`team.role.${item.role}`)} · ${formatIndianPhone(item.phone)}`}
              left={(props) => (
                <List.Icon
                  {...props}
                  icon={
                    item.role === 'owner'
                      ? 'crown-outline'
                      : item.role === 'teacher'
                        ? 'human-male-board'
                        : 'account-tie-outline'
                  }
                />
              )}
              right={() =>
                item.role === 'owner' ? null : (
                  <IconButton
                    icon="account-remove-outline"
                    accessibilityLabel={t('team.remove')}
                    onPress={() => {
                      remove.reset();
                      setRemoving(item);
                    }}
                  />
                )
              }
            />
          )}
        />
      )}

      <FAB
        icon="account-plus"
        label={t('team.add')}
        style={styles.fab}
        onPress={() => {
          add.reset();
          setAdding(true);
        }}
      />

      <Portal>
        <Dialog visible={adding} onDismiss={() => setAdding(false)}>
          <Dialog.Title>{t('team.add')}</Dialog.Title>
          <Dialog.Content>
            <SegmentedButtons
              value={values.role}
              onValueChange={(role) =>
                setValues((v) => ({ ...v, role: role === 'staff' ? 'staff' : 'teacher' }))
              }
              buttons={[
                { value: 'teacher', label: t('team.role.teacher') },
                { value: 'staff', label: t('team.role.staff') },
              ]}
            />
            <Text
              variant="bodySmall"
              style={[styles.roleHelp, { color: theme.colors.onSurfaceVariant }]}
            >
              {values.role === 'teacher' ? t('team.teacherHelp') : t('team.staffHelp')}
            </Text>
            <TextInput
              mode="outlined"
              label={t('team.name')}
              value={values.name}
              onChangeText={(name) => setValues((v) => ({ ...v, name }))}
              autoCapitalize="words"
              error={shown.name !== undefined}
            />
            <HelperText type="error" visible={shown.name !== undefined}>
              {shown.name ? t(shown.name) : ''}
            </HelperText>
            <TextInput
              mode="outlined"
              label={t('team.phone')}
              value={values.phone}
              onChangeText={(phone) => setValues((v) => ({ ...v, phone }))}
              keyboardType="phone-pad"
              error={shown.phone !== undefined}
            />
            <HelperText type={shown.phone ? 'error' : 'info'} visible>
              {shown.phone ? t(shown.phone) : t('team.phoneHelp')}
            </HelperText>
            {add.isError && (
              <Text style={{ color: theme.colors.error }}>{addFailure(add.error)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAdding(false)}>{t('common.cancel')}</Button>
            <Button
              loading={add.isPending}
              disabled={add.isPending}
              onPress={() => {
                setTried(true);
                if (Object.keys(errors).length === 0) {
                  add.mutate();
                }
              }}
            >
              {t('team.addButton')}
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={removing !== null} onDismiss={() => setRemoving(null)}>
          <Dialog.Title>
            {t('team.removeTitle', { name: removing?.name ?? removing?.phone ?? '' })}
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('team.removeBody')}</Text>
            {remove.isError && (
              <Text style={{ color: theme.colors.error }}>{errorMessage(t, remove.error)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRemoving(null)}>{t('common.cancel')}</Button>
            <Button
              textColor={theme.colors.error}
              loading={remove.isPending}
              onPress={() => removing && remove.mutate(removing.userId)}
            >
              {t('team.remove')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  list: { paddingBottom: 96 },
  help: { padding: 16 },
  roleHelp: { marginTop: 8, marginBottom: 12 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
