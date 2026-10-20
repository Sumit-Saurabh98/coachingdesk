// The SAME code the API uses, imported from packages/shared:
//  - Money: paise in, "₹1,500" out (never floats, AGENTS rule 2)
//  - PhoneNumber: Indian numbers only; masked() hides the middle digits (AGENTS rule 9)
//  - RequestOtpBody: the Zod schema the API checks the login request with.
// One rule, one place: a phone the app accepts is a phone the API accepts.
import { Money, PhoneNumber, RequestOtpBody } from '@coachingdesk/shared';
import { StyleSheet, Text, View } from 'react-native';

// Computed once, when the file loads. Nothing here changes, so it doesn't need to be state.
const fee = Money.ofPaise(150000).format();
const masked = PhoneNumber.parse('9876543210').masked();
// safeParse never throws: it returns { success: true, data } or { success: false, error }.
const badPhone = RequestOtpBody.safeParse({ phone: '12345' });

export default function Index() {
  return (
    <View style={styles.container}>
      <Text>Fee: {fee}</Text>
      <Text>Phone: {masked}</Text>
      <Text>Phone "12345": {badPhone.success ? 'accepted' : 'rejected, same rule as the API'}</Text>
    </View>
  );
}

// StyleSheet.create checks the style names and lets React Native optimise them.
// `gap` puts 8 points of space between the lines.
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
