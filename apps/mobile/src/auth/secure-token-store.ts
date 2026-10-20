import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './token-store';

const KEY = 'session.refreshToken';

/**
 * The refresh token in the phone's ENCRYPTED storage (Android Keystore). Not MMKV: the
 * refresh token logs you in for weeks, so it gets the strongest storage the phone has.
 */
export class SecureTokenStore implements TokenStore {
  load(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY);
  }
  save(refreshToken: string): Promise<void> {
    return SecureStore.setItemAsync(KEY, refreshToken);
  }
  clear(): Promise<void> {
    return SecureStore.deleteItemAsync(KEY);
  }
}
