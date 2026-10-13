import { describe, expect, it, vi } from 'vitest';

import { ScormClient } from './client.js';
import { EventsClient, parseSse, type EngineEventStreamStatus, type SseMessage } from './events.js';
import type { FetchLike } from './http/http-client.js';
import type { WebhookPayload } from './webhooks.js';

const enc = new TextEncoder();

/** A body that emits each chunk in turn, then either ends or stays open until cancelled. */
function body(chunks: string[], { hang = false } = {}) {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = chunks.shift();
      if (next !== undefined) controller.enqueue(enc.encode(next));
      else if (!hang) controller.close();
      else await new Promise(() => undefined);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

async function collect(chunks: string[]): Promise<SseMessage[]> {
  const out: SseMessage[] = [];
  for await (const m of parseSse(body(chunks).stream)) out.push(m);
  return out;
}

const payload = (n: number): WebhookPayload => ({
  id: `evt_${n}`,
  type: 'course.completed',
  createdAt: '2026-10-13T09:00:00.000Z',
  data: { n },
});
const message = (n: number) => `id: evt_${n}\nevent: course.completed\ndata: ${JSON.stringify(payload(n))}\n\n`;

function sseResponse(chunks: string[], opts: { hang?: boolean } = {}) {
  const b = body(chunks, opts);
  return {
    response: new Response(b.stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    cancelled: b.cancelled,
  };
}

async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe('parseSse', () => {
  it('parses fields, joins multi-line data, and skips comments', async () => {
    expect(
      await collect([': connected\n\n', 'id: 1\nevent: a\ndata: x\ndata: y\n\n', 'data:no-space\n\n']),
    ).toEqual([
      { id: '1', event: 'a', data: 'x\ny' },
      { event: 'message', data: 'no-space' },
    ]);
  });

  it('handles messages split across chunks and every line ending', async () => {
    expect(await collect(['da', 'ta: one\r', '\n\r\ndata: two\r\rdata: thr', 'ee\n', '\n'])).toEqual([
      { event: 'message', data: 'one' },
      { event: 'message', data: 'two' },
      { event: 'message', data: 'three' },
    ]);
  });

  it('reports retry hints, ignores bad ones, and drops data-less messages', async () => {
    expect(await collect(['retry: 2500\n\n', 'retry: soon\nevent: x\n\n', 'data: y\nretry: 10\n\n'])).toEqual([
      { event: 'message', data: '', retry: 2500 },
      { event: 'message', data: 'y', retry: 10 },
    ]);
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = enc.encode('data: café\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 10));
        c.enqueue(bytes.slice(10));
        c.close();
      },
    });
    const out: SseMessage[] = [];
    for await (const m of parseSse(stream)) out.push(m);
    expect(out).toEqual([{ event: 'message', data: 'café' }]);
  });
});

describe('EventsClient.stream', () => {
  it('requests the stream with the API key and type filter and delivers each payload', async () => {
    const first = sseResponse([`retry: 3000\n: connected\n\n`, message(1), message(2)], { hang: true });
    const fetchMock = vi.fn<FetchLike>(async () => first.response);
    const events = new EventsClient({ baseUrl: 'https://engine.test/api/v1', apiKey: 'sk_test', fetch: fetchMock });
    const seen: WebhookPayload[] = [];
    const statuses: EngineEventStreamStatus[] = [];

    const stream = events.stream({
      types: ['course.completed', 'certificate.issued'],
      onEvent: (e) => seen.push(e),
      onStatus: (s) => statuses.push(s),
    });
    await until(() => seen.length === 2);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://engine.test/api/v1/events/stream?types=course.completed%2Ccertificate.issued');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key'] ?? headers['x-api-key']).toBe('sk_test');
    expect(headers.accept).toBe('text/event-stream');
    expect(seen).toEqual([payload(1), payload(2)]);
    expect(stream.status).toBe('open');

    stream.close();
    await stream.done;
    expect(first.cancelled()).toBe(true);
    expect(statuses).toEqual(['open', 'closed']);
  });

  it('reconnects with backoff after the server ends the stream or the network fails', async () => {
    const responses = [
      () => sseResponse([message(1)]).response,
      () => {
        throw new TypeError('fetch failed');
      },
      () => sseResponse([message(2)], { hang: true }).response,
    ];
    const fetchMock = vi.fn<FetchLike>(async () => responses.shift()!());
    const errors: unknown[] = [];
    const seen: string[] = [];
    const statuses: EngineEventStreamStatus[] = [];
    const stream = new EventsClient({ baseUrl: 'https://engine.test', apiKey: 'k', fetch: fetchMock }).stream({
      onEvent: (e) => seen.push(e.id),
      onError: (e) => errors.push(e),
      onStatus: (s) => statuses.push(s),
      retryBaseMs: 1,
    });
    await until(() => seen.length === 2);
    expect(seen).toEqual(['evt_1', 'evt_2']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(1);
    expect(statuses).toEqual(['open', 'reconnecting', 'open']);
    stream.close();
    await stream.done;
  });

  it('gives up on a non-retryable status', async () => {
    const fetchMock = vi.fn<FetchLike>(
      async () => new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }),
    );
    const errors: unknown[] = [];
    const stream = new EventsClient({ baseUrl: 'https://engine.test', apiKey: 'bad', fetch: fetchMock }).stream({
      onEvent: () => undefined,
      onError: (e) => errors.push(e),
      retryBaseMs: 1,
    });
    await stream.done;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect((errors[0] as { status: number }).status).toBe(401);
    expect(stream.status).toBe('closed');
  });

  it('stops after one connection with reconnect: false, and honours an abort signal', async () => {
    const once = vi.fn<FetchLike>(async () => sseResponse([message(1)]).response);
    const s1 = new EventsClient({ baseUrl: 'https://engine.test', fetch: once }).stream({
      onEvent: () => undefined,
      reconnect: false,
    });
    await s1.done;
    expect(once).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const open = sseResponse([], { hang: true });
    const s2 = new EventsClient({ baseUrl: 'https://engine.test', fetch: async () => open.response }).stream({
      onEvent: () => undefined,
      signal: controller.signal,
    });
    await until(() => s2.status === 'open');
    controller.abort();
    await s2.done;
    expect(open.cancelled()).toBe(true);
  });

  it('skips messages whose data is not JSON', async () => {
    const seen: string[] = [];
    const s = new EventsClient({
      baseUrl: 'https://engine.test',
      fetch: async () => sseResponse(['data: {oops\n\n', message(3)]).response,
    }).stream({ onEvent: (e) => seen.push(e.id), reconnect: false });
    await s.done;
    expect(seen).toEqual(['evt_3']);
  });

  it('is available on ScormClient', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test', apiKey: 'k' });
    expect(client.events).toBeInstanceOf(EventsClient);
    expect(client.events.http).toBe(client.http);
  });
});
