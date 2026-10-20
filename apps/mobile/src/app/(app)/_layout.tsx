// Everything a LOGGED-IN user sees. The root layout only shows this group when the session
// is signed in (Stack.Protected), so screens in here can assume a logged-in user.
import { Stack } from 'expo-router';

export default function AppLayout() {
  return <Stack />;
}
