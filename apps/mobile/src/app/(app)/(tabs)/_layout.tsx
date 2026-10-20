// The bottom tabs (LLD §8): Today, Students, Fees, More. Each tab keeps its own screen alive
// when you switch away, so coming back is instant and keeps your scroll position.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { useAppTheme } from '@/theme/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/** A tab's icon: filled when selected, outlined when not (Material 3 style). */
function tabIcon(selected: IconName, unselected: IconName) {
  // Named, so React DevTools shows "TabIcon" instead of an anonymous function.
  return function TabIcon({
    focused,
    color,
    size,
  }: {
    focused: boolean;
    color: ColorValue;
    size: number;
  }) {
    return (
      // The tab bar passes the tint colours we set in screenOptions: theme strings like
      // '#004d99'. React Native's ColorValue type also allows numbers and null, which the icon's
      // prop doesn't, so anything that isn't a string falls back to the icon's default.
      <MaterialCommunityIcons
        name={focused ? selected : unselected}
        color={typeof color === 'string' ? color : undefined}
        size={size}
      />
    );
  };
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.today'),
          tabBarIcon: tabIcon('calendar-today', 'calendar-today-outline'),
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: t('tabs.students'),
          tabBarIcon: tabIcon('account-group', 'account-group-outline'),
        }}
      />
      <Tabs.Screen
        name="fees"
        options={{
          title: t('tabs.fees'),
          tabBarIcon: tabIcon('wallet', 'wallet-outline'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('tabs.more'),
          tabBarIcon: tabIcon('dots-horizontal-circle', 'dots-horizontal-circle-outline'),
        }}
      />
    </Tabs>
  );
}
