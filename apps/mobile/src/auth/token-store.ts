/**
 * Where the REFRESH token is kept between app launches. Only the refresh token: the access
 * token lives in memory and is renewed on start (it expires in 15 minutes anyway).
 * An interface, so the Session can be unit-tested with an in-memory store.
 */
export interface TokenStore {
  load(): Promise<string | null>;
  save(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

/** Tests only. */
export class InMemoryTokenStore implements TokenStore {
  constructor(private token: string | null = null) {}

  async load(): Promise<string | null> {
    return this.token;
  }
  async save(refreshToken: string): Promise<void> {
    this.token = refreshToken;
  }
  async clear(): Promise<void> {
    this.token = null;
  }
}
