// A THEME PREVIEW (Step 26d): Paper components with our colours, in light and dark mode.
// The real screens replace this from Step 27 on.
import { Money, PhoneNumber } from '@coachingdesk/shared';
import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Button, Card, Chip, Text } from 'react-native-paper';
import { useAppTheme } from '@/theme/theme';

const fee = Money.ofPaise(150000).format();
const phone = PhoneNumber.parse('9876543210').masked();

export default function Index() {
  // Our theme (with success/warning). Colours come from ROLES, never hex values.
  const theme = useAppTheme();
  return (
    <>
      {/* A screen sets its own header title like this. */}
      <Stack.Screen options={{ title: 'Sharma Classes' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Paper's Text has Material type styles: headlineSmall, titleLarge, bodyMedium... */}
        <Text variant="headlineSmall">Today</Text>
        <Card mode="elevated">
          <Card.Title
            title="Aarav Sharma"
            subtitle="Class 10 Maths"
            // `left` is a function: Card passes the right size for the avatar.
            left={(props) => <Avatar.Icon {...props} icon="account" />}
          />
          <Card.Content style={styles.row}>
            <Text variant="titleLarge">{fee}</Text>
            <Chip
              style={{ backgroundColor: theme.colors.successContainer }}
              textStyle={{ color: theme.colors.onSuccessContainer }}
              icon="check"
            >
              Paid
            </Chip>
          </Card.Content>
          <Card.Content>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Guardian {phone}
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button mode="outlined" icon="receipt">
              Receipt
            </Button>
            <Button mode="contained" icon="whatsapp">
              Remind
            </Button>
          </Card.Actions>
        </Card>
        <View style={[styles.banner, { backgroundColor: theme.colors.warningContainer }]}>
          <Text style={{ color: theme.colors.onWarningContainer }}>3 fees due this week</Text>
        </View>
      </ScrollView>
    </>
  );
}

// Only LAYOUT here (spacing, direction, corners). Colours come from the theme above,
// because they differ between light and dark mode.
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  banner: { padding: 12, borderRadius: 12 },
});
