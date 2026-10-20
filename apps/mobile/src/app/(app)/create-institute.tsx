// "Create another institute" (someone who already has one). The first institute is created
// on the welcome screen instead; both use the same form.
import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { CreateInstituteForm } from '@/institutes/create-institute-form';

export default function CreateInstituteScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* The new institute is now the current one: go to its home screen. dismissTo('/')
          returns to the home screen already open (from Me: closes this form and Me) or opens
          it; "back" never returns to a form that was already submitted. */}
      <CreateInstituteForm onCreated={() => router.dismissTo('/')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24 },
});
