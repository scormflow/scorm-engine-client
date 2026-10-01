import {
  ScormAbortError,
  ScormHttpError,
  ScormNetworkError,
  ScormTimeoutError,
  isRetryableStatus,
  type ScormErrorBody,
} from '../errors.js';
import { computeBackoff, parseRetryAfter, sleep } from './retry.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type TokenProvider = string | (() => string | Promise<string>);

export interface HttpClientOptions {
  baseUrl: string;
  /** Long-lived tenant API key sent as `X-API-Key`. */
  apiKey?: string;
  /** Short-lived attempt JWT sent as `Authorization: Bearer ...`. */
  token?: TokenProvider;
  /** Custom fetch (defaults to globalThis.fetch). Useful for tests + Node < 18. */
  fetch?: FetchLike;
  /** Extra headers applied to every request. */
  headers?: Record<string, string>;
  /** Max retry attempts on transient failures (network / 5xx / 408 / 429). Default 2. */
  retries?: number;
  /** Base backoff in ms (exponential). Default 200. */
  retryBaseMs?: number;
  /** Max backoff in ms. Default 5000. */
  retryMaxMs?: number;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Mutate the outgoing request just before it is sent. */
  onRequest?: (req: { url: string; init: RequestInit }) => void | Promise<void>;
  /** Inspect the raw response (before body is consumed). */
  onResponse?: (res: Response) => void | Promise<void>;
}

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Override the client default. */
  retries?: number;
  /** Override the client default. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 200;
const DEFAULT_RETRY_MAX_MS = 5_000;

export class HttpClient {
  /** Normalized base URL (no trailing slash). Read by clients that bypass `fetch` (e.g. XHR uploads). */
  readonly baseUrl: string;
  /** Tenant API key, when configured. Read by clients that build their own requests. */
  readonly apiKey: string | undefined;
  private readonly token: TokenProvider | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly timeoutMs: number;
  private readonly onRequest: HttpClientOptions['onRequest'];
  private readonly onResponse: HttpClientOptions['onResponse'];

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.token = opts.token;
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) {
      throw new Error(
        'No fetch implementation found. Pass `fetch` in HttpClientOptions or run on Node 20+.',
      );
    }
    this.fetchImpl = f;
    this.headers = { ...(opts.headers ?? {}) };
    this.retries = opts.retries ?? DEFAULT_RETRIES;
    this.retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = opts.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onRequest = opts.onRequest;
    this.onResponse = opts.onResponse;
  }

  async request<T>(req: HttpRequest): Promise<T> {
    const url = this.buildUrl(req.path, req.query);
    const headers = await this.buildHeaders(req);
    const init: RequestInit = {
      method: req.method ?? (req.json !== undefined || req.body !== undefined ? 'POST' : 'GET'),
      headers,
    };
    if (req.json !== undefined) init.body = JSON.stringify(req.json);
    else if (req.body !== undefined) init.body = req.body;

    const retries = req.retries ?? this.retries;
    const timeoutMs = req.timeoutMs ?? this.timeoutMs;

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= retries) {
      attempt += 1;
      const attemptInit: RequestInit = { ...init };
      const { signal, cleanup } = this.combineSignals(req.signal, timeoutMs);
      attemptInit.signal = signal;

      try {
        if (this.onRequest) await this.onRequest({ url, init: attemptInit });
        const res = await this.fetchImpl(url, attemptInit);
        cleanup();
        if (this.onResponse) await this.onResponse(res);

        if (res.ok) return await parseBody<T>(res);

        const errBody = await safeJson(res);
        if (isRetryableStatus(res.status) && attempt <= retries) {
          const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
          const delay =
            retryAfterMs ??
            computeBackoff({ baseMs: this.retryBaseMs, maxMs: this.retryMaxMs, attempt });
          await sleep(delay, req.signal);
          continue;
        }
        throw new ScormHttpError(
          res.status,
          (errBody ?? undefined) as ScormErrorBody | undefined,
          `${init.method} ${url} → ${res.status}`,
          errBody,
        );
      } catch (err) {
        cleanup();
        if (err instanceof ScormHttpError) throw err;
        if (isAbort(err)) {
          if (req.signal?.aborted) throw new ScormAbortError();
          // Otherwise it was the timeout signal.
          lastError = new ScormTimeoutError(timeoutMs);
        } else {
          lastError = new ScormNetworkError(
            err instanceof Error ? err.message : 'Network error',
            err,
          );
        }
        if (attempt > retries) throw lastError;
        const delay = computeBackoff({
          baseMs: this.retryBaseMs,
          maxMs: this.retryMaxMs,
          attempt,
        });
        await sleep(delay, req.signal);
      }
    }
    throw lastError ?? new ScormNetworkError('Request failed');
  }

  get<T>(path: string, req: Omit<HttpRequest, 'path' | 'method' | 'json' | 'body'> = {}): Promise<T> {
    return this.request<T>({ ...req, path, method: 'GET' });
  }

  post<T>(path: string, json?: unknown, req: Omit<HttpRequest, 'path' | 'method' | 'json'> = {}): Promise<T> {
    return this.request<T>({ ...req, path, method: 'POST', json });
  }

  delete<T>(path: string, req: Omit<HttpRequest, 'path' | 'method'> = {}): Promise<T> {
    return this.request<T>({ ...req, path, method: 'DELETE' });
  }

  private buildUrl(path: string, query?: HttpRequest['query']): string {
    const joined = path.startsWith('http') ? path : `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
    if (!query) return joined;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    if (!qs) return joined;
    return `${joined}${joined.includes('?') ? '&' : '?'}${qs}`;
  }

  private async buildHeaders(req: HttpRequest): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.headers,
      ...(req.headers ?? {}),
    };
    if (req.json !== undefined && !headers['content-type'] && !headers['Content-Type']) {
      headers['content-type'] = 'application/json';
    }
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (this.token) {
      const tok = typeof this.token === 'function' ? await this.token() : this.token;
      if (tok) headers['Authorization'] = `Bearer ${tok}`;
    }
    return headers;
  }

  private combineSignals(
    external: AbortSignal | undefined,
    timeoutMs: number,
  ): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(external?.reason);
    if (external) {
      if (external.aborted) controller.abort(external.reason);
      else external.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        external?.removeEventListener('abort', onExternalAbort);
      },
    };
  }
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  } catch {
    return null;
  }
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}
