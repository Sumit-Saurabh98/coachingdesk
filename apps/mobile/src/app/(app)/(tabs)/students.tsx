// Students tab: everyone at the institute, searchable, sorted by name, loaded page by page.
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  List,
  Searchbar,
  SegmentedButtons,
  Text,
} from 'react-native-paper';
import { errorMessage } from '@/api/error-message';
import { useCurrentInstitute } from '@/institutes/use-current-institute';
import { formatIndianPhone } from '@/lib/phone-format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { listStudents, type StudentFilter, studentKeys } from '@/students/students-api';
import { useAppTheme } from '@/theme/theme';

export default function StudentsTab() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { current } = useCurrentInstitute();
  const instituteId = current?.id ?? '';
  const canManage = current?.role === 'owner' || current?.role === 'staff';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StudentFilter>('active');
  // Ask the server only once the user paused typing (300 ms), not on every letter.
  const q = useDebouncedValue(search.trim());

  // useInfiniteQuery: like useQuery, but for data that comes in PAGES. Each page tells us
  // where the next one starts (nextCursor); fetchNextPage() loads it and appends it.
  const students = useInfiniteQuery({
    queryKey: studentKeys.list(instituteId, { q, status }),
    queryFn: ({ pageParam, signal }) =>
      listStudents(instituteId, { q, status, cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: instituteId !== '',
  });
  const rows = students.data?.pages.flatMap((page) => page.students) ?? [];

  const emptyText = () => {
    if (q !== '') {
      return t('students.noResults', { q });
    }
    if (status === 'left') {
      return t('students.noLeft');
    }
    return canManage ? t('students.emptyOwner') : t('students.emptyMember');
  };

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        <Searchbar
          placeholder={t('students.search')}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        <SegmentedButtons
          value={status}
          onValueChange={setStatus}
          buttons={[
            { value: 'active', label: t('students.active') },
            { value: 'left', label: t('students.left') },
            { value: 'all', label: t('students.all') },
          ]}
        />
      </View>

      {students.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      ) : students.isError ? (
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.error }}>{errorMessage(t, students.error)}</Text>
          <Button mode="contained" onPress={() => void students.refetch()}>
            {t('common.retry')}
          </Button>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(student) => student.id}
          contentContainerStyle={rows.length === 0 ? styles.emptyContainer : undefined}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={students.isRefetching && !students.isFetchingNextPage}
              onRefresh={() => void students.refetch()}
            />
          }
          // Near the end of the list: load the next page (if there is one).
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (students.hasNextPage && !students.isFetchingNextPage) {
              void students.fetchNextPage();
            }
          }}
          ListFooterComponent={
            students.isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : undefined
          }
          ItemSeparatorComponent={Divider}
          renderItem={({ item: student }) => (
            <List.Item
              title={student.name}
              description={[student.guardianName, formatIndianPhone(student.guardianPhone)]
                .filter(Boolean)
                .join(' · ')}
              left={(props) => <List.Icon {...props} icon="account-outline" />}
              right={() => (
                <View style={styles.badges}>
                  {student.status === 'left' && <Chip compact>{t('students.leftBadge')}</Chip>}
                  {student.readOnly === true && (
                    <Chip compact icon="lock-outline">
                      {t('students.readOnly')}
                    </Chip>
                  )}
                </View>
              )}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              {q === '' && status !== 'left' && (
                <Text variant="titleMedium">{t('students.emptyTitle')}</Text>
              )}
              <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
                {emptyText()}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { padding: 16, paddingBottom: 8, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  badges: { justifyContent: 'center', gap: 4 },
  footer: { padding: 16 },
  emptyContainer: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyText: { textAlign: 'center' },
});
