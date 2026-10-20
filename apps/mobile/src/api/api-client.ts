import { ApiError } from './api-error';

// Pure TypeScript on purpose (no React Native imports): unit-tested in Node with a fake fetch.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown; // sent as JSON
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal; // TanStack Query passes one: leaving a screen cancels its request
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch; // injected in tests
  timeoutMs?: number;
  /** Returns the current access token, or null when logged out. */
  getAccessToken?: () => string | null;
  /**
   * Called when the server answers 401 (the access token expired, ~every 15 min). Resolves
   * true if a fresh token is now available: the request is then sent ONE more time.
   */
  onUnauthorized?: () => Promise<boolean>;
}

// The server's error body (apps/api error-handler): { error: { code, message, details }, requestId }
interface ErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
  requestId?: string;
}

/**
 * Talks to our API. One place for: the base URL, JSON in/out, the login token, a timeout,
 * and turning every failure into an ApiError. Screens never call fetch() themselves.
 */
export class ApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiClientOptions) {
    // Bound: calling a detached `fetch` (this = undefined) throws on some platforms.
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    try {
      return await this.send<T>(method, path, options);
    } catch (error) {
      // An expired access token is normal: renew it and try ONCE more. Only once, so a
      // server that keeps saying 401 can't put us in a loop.
      const expired = error instanceof ApiError && error.status === 401;
      if (expired && this.options.onUnauthorized && (await this.options.onUnauthorized())) {
        return this.send<T>(method, path, options);
      }
      throw error;
    }
  }

  private async send<T>(method: HttpMethod, path: string, options: RequestOptions): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const token = this.options.getAccessToken?.();
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    // Our own timer, plus the caller's signal (screen left): whichever comes first aborts.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = options.signal ? anySignal([options.signal, timeout.signal]) : timeout.signal;

    let response: Response;
    try {
      response = await this.fetchFn(this.urlFor(path, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw error; // the caller cancelled: not an error to show, let TanStack Query handle it
      }
      throw new ApiError(
        timeout.signal.aborted
          ? { kind: 'timeout', message: 'The server took too long to answer' }
          : { kind: 'network', message: 'Could not reach the server' },
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) {
      return undefined as T; // "done, nothing to return" (e.g. a delete)
    }
    const body = await readJson(response);
    if (!response.ok) {
      const parsed = (body ?? {}) as ErrorBody;
      throw new ApiError({
        kind: 'http',
        status: response.status,
        code: parsed.error?.code ?? null,
        message: parsed.error?.message ?? `Request failed (${response.status})`,
        details: parsed.error?.details,
        requestId: parsed.requestId ?? null,
      });
    }
    return body as T;
  }

  private urlFor(path: string, query?: RequestOptions['query']): string {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}${path}`;
    const params = Object.entries(query ?? {}).filter(([, value]) => value !== undefined);
    if (params.length === 0) {
      return url;
    }
    const search = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
    return `${url}?${search}`;
  }
}

/** The body as JSON, or null if empty / not JSON (e.g. a proxy's HTML error page). */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A signal that aborts when ANY of the given signals aborts. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
