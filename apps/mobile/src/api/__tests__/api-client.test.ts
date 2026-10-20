import { describe, expect, it } from 'vitest';
import { ApiClient } from '../api-client';
import { ApiError } from '../api-error';

/** A fake fetch that records the request and answers with what the test says. */
function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ApiClient', () => {
  it('GET: base URL + path + query; JSON back', async () => {
    const fake = fakeFetch(() => json(200, { plans: [1, 2] }));
    const api = new ApiClient({ baseUrl: 'http://10.0.0.2:3001/', fetch: fake.fn });

    const result = await api.get<{ plans: number[] }>('/v1/plans', {
      query: { limit: 20, q: 'a b', skip: undefined },
    });

    expect(result).toEqual({ plans: [1, 2] });
    expect(fake.calls[0]?.url).toBe('http://10.0.0.2:3001/v1/plans?limit=20&q=a%20b');
    expect(fake.calls[0]?.init.method).toBe('GET');
  });

  it('POST: JSON body and content-type; the token when there is one', async () => {
    const fake = fakeFetch(() => json(201, { ok: true }));
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fake.fn,
      getAccessToken: () => 'tok',
    });

    await api.post('/v1/things', { name: 'Maths' });

    const init = fake.calls[0]?.init;
    expect(init?.body).toBe('{"name":"Maths"}');
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer tok',
    });
  });

  it('no token: no Authorization header', async () => {
    const fake = fakeFetch(() => json(200, {}));
    await new ApiClient({ baseUrl: 'http://api', fetch: fake.fn, getAccessToken: () => null }).get(
      '/x',
    );
    expect(fake.calls[0]?.init.headers).not.toHaveProperty('authorization');
  });

  it('204: resolves with undefined', async () => {
    const fake = fakeFetch(() => new Response(null, { status: 204 }));
    expect(
      await new ApiClient({ baseUrl: 'http://api', fetch: fake.fn }).delete('/x'),
    ).toBeUndefined();
  });

  it("server error: ApiError with the server's code, message, details and requestId", async () => {
    const fake = fakeFetch(() =>
      json(400, {
        error: {
          code: 'OTP_INVALID',
          message: 'That code is not correct.',
          details: { attemptsLeft: 4 },
        },
        requestId: 'req-1',
      }),
    );
    const error = await new ApiClient({ baseUrl: 'http://api', fetch: fake.fn })
      .post('/v1/auth/otp/verify', {})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: 'http',
      status: 400,
      code: 'OTP_INVALID',
      message: 'That code is not correct.',
      details: { attemptsLeft: 4 },
      requestId: 'req-1',
      isClientError: true,
    });
  });

  it('a non-JSON error page (e.g. a proxy) still becomes an ApiError', async () => {
    const fake = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await new ApiClient({ baseUrl: 'http://api', fetch: fake.fn })
      .get('/x')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'http', status: 502, code: null, isClientError: false });
  });

  it('no connection: kind network', async () => {
    const fake = fakeFetch(() => Promise.reject(new TypeError('Network request failed')));
    const error = await new ApiClient({ baseUrl: 'http://api', fetch: fake.fn })
      .get('/x')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'network', status: null });
  });

  it('too slow: kind timeout', async () => {
    // A fetch that only ends when it's aborted, like a server that never answers.
    const fake = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const error = await new ApiClient({ baseUrl: 'http://api', fetch: fake.fn, timeoutMs: 20 })
      .get('/x')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'timeout' });
  });

  it('cancelled by the caller (screen left): the abort is passed through, not a network error', async () => {
    const fake = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const controller = new AbortController();
    const pending = new ApiClient({ baseUrl: 'http://api', fetch: fake.fn })
      .get('/x', { signal: controller.signal })
      .catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe('ApiClient: expired access token (401)', () => {
  const unauthorized = () =>
    json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please log in.' } });

  it('renews the token once and retries the request with the NEW token', async () => {
    let token = 'old';
    const fake = fakeFetch((_url, init) =>
      (init.headers as Record<string, string>).authorization === 'Bearer new'
        ? json(200, { ok: true })
        : unauthorized(),
    );
    let renewals = 0;
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fake.fn,
      getAccessToken: () => token,
      onUnauthorized: async () => {
        renewals += 1;
        token = 'new';
        return true;
      },
    });

    expect(await api.get('/v1/me')).toEqual({ ok: true });
    expect(renewals).toBe(1);
    expect(fake.calls).toHaveLength(2);
  });

  it('renewal fails: the original 401 reaches the caller (no loop)', async () => {
    const fake = fakeFetch(() => unauthorized());
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fake.fn,
      getAccessToken: () => 'old',
      onUnauthorized: async () => false,
    });

    const error = await api.get('/v1/me').catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: 'http', status: 401 });
    expect(fake.calls).toHaveLength(1);
  });

  it('still 401 after renewing: retried only ONCE, then the error', async () => {
    const fake = fakeFetch(() => unauthorized());
    let renewals = 0;
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fake.fn,
      getAccessToken: () => 'x',
      onUnauthorized: async () => {
        renewals += 1;
        return true;
      },
    });

    await expect(api.get('/v1/me')).rejects.toMatchObject({ status: 401 });
    expect(renewals).toBe(1);
    expect(fake.calls).toHaveLength(2);
  });

  it('other errors (e.g. 403) never trigger a renewal', async () => {
    const fake = fakeFetch(() => json(403, { error: { code: 'FORBIDDEN', message: 'No' } }));
    let renewals = 0;
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fake.fn,
      onUnauthorized: async () => {
        renewals += 1;
        return true;
      },
    });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 403 });
    expect(renewals).toBe(0);
  });
});
