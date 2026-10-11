import { describe, expect, it, vi } from 'vitest';
import { HttpClient, type FetchLike } from './http-client.js';
import { ScormHttpError, ScormNetworkError, ScormRateLimitError, ScormTimeoutError } from '../errors.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function errorResponse(status: number, body: unknown = { code: 'oops', message: 'boom' }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function abortError(): Error {
  const e = new Error('aborted');
  (e as Error & { name: string }).name = 'AbortError';
  return e;
}

const hangingFetch: FetchLike = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    if (init.signal?.aborted) {
      reject(abortError());
      return;
    }
    init.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });

describe('HttpClient', () => {
  it('sends GET with API key + json accept header', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ ok: true }));
    const c = new HttpClient({ baseUrl: 'https://api.example.com/api/v1', apiKey: 'k', fetch: fetchMock });
    const res = await c.get<{ ok: boolean }>('courses');
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/api/v1/courses');
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('k');
    expect(headers['accept']).toBe('application/json');
  });

  it('encodes query parameters', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({}));
    const c = new HttpClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    await c.get('courses', { query: { limit: 10, q: 'safety', skip: undefined } });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/courses?limit=10&q=safety');
  });

  it('attaches Authorization header from a token provider', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({}));
    const c = new HttpClient({
      baseUrl: 'https://x/v1',
      fetch: fetchMock,
      token: () => Promise.resolve('jwt-1'),
    });
    await c.get('runtime/a/initialize');
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-1');
  });

  it('serializes JSON body and sets content-type', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({}));
    const c = new HttpClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    await c.post('runtime/a/commit', { values: { x: 1 } });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"values":{"x":1}}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('retries on 5xx and eventually succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn<FetchLike>(async () => {
      calls += 1;
      return calls < 3 ? errorResponse(503) : jsonResponse({ ok: true });
    });
    const c = new HttpClient({
      baseUrl: 'https://x/v1',
      fetch: fetchMock,
      retries: 3,
      retryBaseMs: 1,
      retryMaxMs: 2,
    });
    const res = await c.get<{ ok: boolean }>('thing');
    expect(res).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('throws ScormHttpError after retries exhausted', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => errorResponse(500));
    const c = new HttpClient({
      baseUrl: 'https://x/v1',
      fetch: fetchMock,
      retries: 1,
      retryBaseMs: 1,
      retryMaxMs: 1,
    });
    const err = await c.get('thing').catch((e) => e);
    expect(err).toBeInstanceOf(ScormHttpError);
    expect((err as ScormHttpError).status).toBe(500);
    expect((err as ScormHttpError).code).toBe('oops');
  });

  it('does not retry non-retryable status codes', async () => {
    let calls = 0;
    const fetchMock = vi.fn<FetchLike>(async () => {
      calls += 1;
      return errorResponse(404, { code: 'not_found', message: 'gone' });
    });
    const c = new HttpClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 3, retryBaseMs: 1 });
    const err = await c.get('thing').catch((e) => e);
    expect(calls).toBe(1);
    expect(err).toBeInstanceOf(ScormHttpError);
    expect((err as ScormHttpError).status).toBe(404);
  });

  it('retries on network errors and wraps as ScormNetworkError when exhausted', async () => {
    let calls = 0;
    const fetchMock = vi.fn<FetchLike>(async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    });
    const c = new HttpClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 2, retryBaseMs: 1 });
    const err = await c.get('thing').catch((e) => e);
    expect(calls).toBe(3);
    expect(err).toBeInstanceOf(ScormNetworkError);
  });

  it('respects Retry-After in seconds on 429', async () => {
    let calls = 0;
    const fetchMock = vi.fn<FetchLike>(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('{"code":"rate","message":"slow down"}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        });
      }
      return jsonResponse({ ok: true });
    });
    const c = new HttpClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 2, retryBaseMs: 1 });
    await c.get('thing');
    expect(calls).toBe(2);
  });

  it('throws a ScormRateLimitError carrying the budget once 429 retries run out', async () => {
    const fetchMock = vi.fn<FetchLike>(
      async () =>
        new Response('{"code":"rate_limited","message":"slow down"}', {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '0',
            'x-ratelimit-limit': '100',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '0',
          },
        }),
    );
    const c = new HttpClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 1 });
    const err = await c.get('thing').catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(ScormRateLimitError);
    expect(err).toBeInstanceOf(ScormHttpError);
    expect(err).toMatchObject({
      name: 'ScormRateLimitError',
      status: 429,
      code: 'rate_limited',
      retryAfterMs: 0,
      rateLimit: { limit: 100, remaining: 0, resetSeconds: 0 },
    });
  });

  it('fails fast instead of sleeping through a Retry-After above maxRetryAfterMs', async () => {
    const fetchMock = vi.fn<FetchLike>(
      async () =>
        new Response('{"code":"rate_limited"}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '45' },
        }),
    );
    const c = new HttpClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 3, maxRetryAfterMs: 10_000 });
    const err = await c.get('thing').catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(err).toBeInstanceOf(ScormRateLimitError);
    expect(err).toMatchObject({ retryAfterMs: 45_000, rateLimit: null });
  });

  it('honors an external AbortSignal', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<FetchLike>(hangingFetch);
    const c = new HttpClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    const p = c.get('thing', { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'ScormAbortError' });
  });

  it('reports a ScormTimeoutError when the per-request timeout fires', async () => {
    const fetchMock = vi.fn<FetchLike>(hangingFetch);
    const c = new HttpClient({
      baseUrl: 'https://x/v1',
      fetch: fetchMock,
      retries: 0,
      timeoutMs: 10,
    });
    await expect(c.get('thing')).rejects.toBeInstanceOf(ScormTimeoutError);
  });

  it('runs onRequest/onResponse hooks', async () => {
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ ok: true }));
    const c = new HttpClient({
      baseUrl: 'https://x/v1',
      fetch: fetchMock,
      onRequest,
      onResponse,
      retries: 0,
    });
    await c.get('thing');
    expect(onRequest).toHaveBeenCalledOnce();
    expect(onResponse).toHaveBeenCalledOnce();
  });
});
