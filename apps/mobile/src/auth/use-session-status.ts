import { create } from 'zustand';
import { session } from '@/api';
import type { SessionStatus } from './session';

/**
 * The session's status as a React hook: components using it re-render when the user logs in
 * or out (or the session expires). Usage: const status = useSessionStatus((s) => s.status);
 * Not saved anywhere: the Session itself restores from the secure store at app start.
 */
export const useSessionStatus = create<{ status: SessionStatus }>(() => ({
  status: session.status,
}));

session.subscribe((status) => useSessionStatus.setState({ status }));
