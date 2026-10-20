import { describe, expect, it } from 'vitest';
import { ApiClient } from '../../api/api-client';
import { Session, type SessionStatus } from '../session';
import { InMemoryTokenStore } from '../token-store';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake server for /auth/refresh: answers with `respond`, counts calls, remembers bodies. */
function fakeServer(respond: (body: { refreshToken: string }) => Response | Promise<Response>) {
  const calls: Array<{ path: string; body: { refreshToken: string } }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      refreshToken: string;
    };
    calls.push({ path: new URL(url).pathname, body });
    return respond(body);
  }) as typeof fetch;
  return { api: new ApiClient({ baseUrl: 'http://api', fetch: fetchFn }), calls };
}

const newPair = (n: number) =>
  json(200, { accessToken: `access-${n}`, refreshToken: `refresh-${n}` });

describe('Session.restore', () => {
  it('nothing saved: signed out, no server call', async () => {
    const server = fakeServer(() => newPair(1));
    const session = new Session(server.api, new InMemoryTokenStore());
    await session.restore();
    expect(session.status).toBe('signedOut');
    expect(server.calls).toEqual([]);
  });

  it('saved refresh token: signed in, with a fresh access token; the new refresh token is saved', async () => {
    const store = new InMemoryTokenStore('refresh-0');
    const session = new Session(fakeServer(() => newPair(1)).api, store);

    await session.restore();

    expect(session.status).toBe('signedIn');
    expect(session.accessToken).toBe('access-1');
    expect(await store.load()).toBe('refresh-1');
  });

  it('OFFLINE at start: still signed in (refresh token kept), no access token yet', async () => {
    const store = new InMemoryTokenStore('refresh-0');
    const server = fakeServer(() => Promise.reject(new TypeError('Network request failed')));
    const session = new Session(server.api, store);

    await session.restore();

    expect(session.status).toBe('signedIn');
    expect(session.accessToken).toBeNull();
    expect(await store.load()).toBe('refresh-0');
  });

  it('an unreadable store at start: signed out (log in again), no crash', async () => {
    const store = new InMemoryTokenStore();
    store.load = () => Promise.reject(new Error('keystore reset'));
    const session = new Session(fakeServer(() => newPair(1)).api, store);
    await session.restore();
    expect(session.status).toBe('signedOut');
  });

  it('the server rejects the saved token (revoked / expired): signed out, token wiped', async () => {
    const store = new InMemoryTokenStore('refresh-0');
    const server = fakeServer(() =>
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please log in.' } }),
    );
    const session = new Session(server.api, store);

    await session.restore();

    expect(session.status).toBe('signedOut');
    expect(await store.load()).toBeNull();
  });
});

describe('Session.refresh', () => {
  it('SINGLE-FLIGHT: three callers at once -> ONE call to the server (a 2nd would be token reuse)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = fakeServer(async () => {
      await gate; // hold the first refresh open while the others ask
      return newPair(1);
    });
    const session = new Session(server.api, new InMemoryTokenStore());
    await session.start({ accessToken: 'access-0', refreshToken: 'refresh-0' });

    const results = [session.refresh(), session.refresh(), session.refresh()];
    release();

    expect(await Promise.all(results)).toEqual([true, true, true]);
    expect(server.calls).toHaveLength(1);
    expect(session.accessToken).toBe('access-1');
  });

  it('after one finishes, the next refresh uses the NEW refresh token', async () => {
    let n = 0;
    const server = fakeServer(() => newPair(++n));
    const session = new Session(server.api, new InMemoryTokenStore());
    await session.start({ accessToken: 'access-0', refreshToken: 'refresh-0' });

    await session.refresh();
    await session.refresh();

    expect(server.calls.map((c) => c.body.refreshToken)).toEqual(['refresh-0', 'refresh-1']);
  });
});

describe('Session start / end and listeners', () => {
  it('start -> signedIn; end -> signedOut, token wiped, server told (even if offline)', async () => {
    const store = new InMemoryTokenStore();
    const server = fakeServer(() => Promise.reject(new TypeError('offline')));
    const session = new Session(server.api, store);
    const seen: SessionStatus[] = [];
    session.subscribe((status) => seen.push(status));

    await session.start({ accessToken: 'a', refreshToken: 'r' });
    expect(await store.load()).toBe('r');
    await session.end();

    expect(seen).toEqual(['signedIn', 'signedOut']);
    expect(session.accessToken).toBeNull();
    expect(await store.load()).toBeNull();
    expect(server.calls.map((c) => c.path)).toEqual(['/v1/auth/logout']);
  });
});
