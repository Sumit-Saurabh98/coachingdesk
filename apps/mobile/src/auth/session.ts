import type { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import type { TokenStore } from './token-store';

// Pure TypeScript (no React Native imports): unit-tested in Node.

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** 'restoring' = reading the saved session at app start (show the splash, not the login). */
export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn';

/**
 * The login session on this phone (API_DOCS "Auth"):
 *  - access token: in memory only, sent with every request, expires after 15 minutes;
 *  - refresh token: in the encrypted store, swapped for a new pair when the access token expires.
 *
 * The server ROTATES refresh tokens and treats reuse of an old one as theft: it ends the whole
 * session. So two refreshes must never run at once with the same token. refresh() is
 * "single-flight": while one is running, every other caller waits for THAT one.
 */
export class Session {
  private accessTokenValue: string | null = null;
  private refreshTokenValue: string | null = null;
  private statusValue: SessionStatus = 'restoring';
  private inFlight: Promise<boolean> | null = null;
  private readonly listeners = new Set<(status: SessionStatus) => void>();

  /** `api`: a client WITHOUT the session hooks (refresh must not trigger itself). */
  constructor(
    private readonly api: ApiClient,
    private readonly store: TokenStore,
  ) {}

  get accessToken(): string | null {
    return this.accessTokenValue;
  }

  get status(): SessionStatus {
    return this.statusValue;
  }

  /** Re-renders the app when the status changes (the auth store subscribes). */
  subscribe(listener: (status: SessionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * At app start: is there a saved session? Offline is fine: with a saved refresh token we
   * count as signed in, and the first request renews the access token once there's a network.
   */
  async restore(): Promise<void> {
    const saved = await this.store.load();
    if (!saved) {
      this.setStatus('signedOut');
      return;
    }
    this.refreshTokenValue = saved;
    this.setStatus('signedIn');
    // Get an access token now if we can; a network error just means "later".
    await this.refresh();
  }

  /** After a successful OTP login. */
  async start(tokens: Tokens): Promise<void> {
    await this.store.save(tokens.refreshToken);
    this.accessTokenValue = tokens.accessToken;
    this.refreshTokenValue = tokens.refreshToken;
    this.setStatus('signedIn');
  }

  /**
   * Swap the refresh token for a new pair. Resolves true when a fresh access token is ready.
   * A definite "no" from the server (401: revoked, expired, reused) ends the session;
   * a network problem doesn't (we keep the refresh token and try again later).
   */
  refresh(): Promise<boolean> {
    this.inFlight ??= this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Logout: tell the server (best effort: works offline too), then forget everything here. */
  async end(): Promise<void> {
    const refreshToken = this.refreshTokenValue;
    await this.clear();
    if (refreshToken) {
      await this.api.post('/v1/auth/logout', { refreshToken }).catch(() => undefined);
    }
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.refreshTokenValue;
    if (!refreshToken) {
      return false;
    }
    try {
      const tokens = await this.api.post<Tokens>('/v1/auth/refresh', { refreshToken });
      await this.store.save(tokens.refreshToken);
      this.accessTokenValue = tokens.accessToken;
      this.refreshTokenValue = tokens.refreshToken;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.isClientError) {
        await this.clear(); // the server said no: this login is over
      }
      return false;
    }
  }

  private async clear(): Promise<void> {
    this.accessTokenValue = null;
    this.refreshTokenValue = null;
    await this.store.clear();
    this.setStatus('signedOut');
  }

  private setStatus(status: SessionStatus): void {
    if (this.statusValue === status) {
      return;
    }
    this.statusValue = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
