/**
 * The engine's live event stream (`GET /events/stream`, Server-Sent Events).
 *
 * Every message is the same {@link WebhookPayload} a webhook delivery carries,
 * so code written for webhooks works on the stream unchanged. The stream needs
 * a tenant API key: run it server-side, or behind your own backend.
 *
 * `EventSource` can't send an `X-API-Key` header, so this reads the stream
 * with `fetch` and parses SSE itself — which also makes it work in Node ≥ 20,
 * Deno, Bun and edge runtimes. Dropped connections are re-opened with backoff;
 * events published while disconnected are not replayed (webhooks are the
 * durable channel).
 */
import { ScormAbortError, ScormHttpError, isRetryableStatus } from './errors.js';
import { HttpClient, type HttpClientOptions } from './http/http-client.js';
import { computeBackoff } from './http/retry.js';
import type { WebhookEventType, WebhookPayload } from './webhooks.js';

/** One parsed Server-Sent Events message. */
export interface SseMessage {
  /** `event:` field; `message` when absent. */
  event: string;
  data: string;
  /** `id:` field, when the message set one. */
  id?: string;
  /** `retry:` field, in ms, when the message set one. */
  retry?: number;
}

/**
 * Parse an SSE byte stream per the HTML spec: `\n`, `\r\n` or `\r` line ends,
 * multi-line `data:` joined with `\n`, comment lines (`:`) skipped, messages
 * without data dropped (a lone `retry:` is still reported). Aborting
 * `signal` cancels the body and ends the generator.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const cancel = () => void reader.cancel().catch(() => undefined);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  let buf = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buf);
        if (!match) break;
        // A lone `\r` at the end of the buffer may be the first half of `\r\n`.
        if (match[0] === '\r' && match.index === buf.length - 1) break;
        const line = buf.slice(0, match.index);
        buf = buf.slice(match.index + match[0].length);

        if (line === '') {
          if (data.length > 0 || retry !== undefined) {
            const msg: SseMessage = { event: event || 'message', data: data.join('\n') };
            if (id !== undefined) msg.id = id;
            if (retry !== undefined) msg.retry = retry;
            yield msg;
          }
          event = '';
          data = [];
          id = undefined;
          retry = undefined;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id' && !value.includes('\0')) id = value;
        else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
  }
}

export type EngineEventStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EngineEventStreamOptions {
  /** Only these event types; every type when omitted. */
  types?: readonly WebhookEventType[];
  /** Called for every event, in order. */
  onEvent: (event: WebhookPayload) => void;
  /** Connection state changes. */
  onStatus?: (status: EngineEventStreamStatus) => void;
  /**
   * A connection attempt or an open stream failed. Transient failures
   * (network, 5xx, 429) are followed by a reconnect; others (`401`, `400`)
   * close the stream for good.
   */
  onError?: (error: unknown) => void;
  /** Re-open dropped connections. Default true. */
  reconnect?: boolean;
  /** First reconnect delay in ms; doubles per consecutive failure. Default: the server's `retry:` hint, else 1000. */
  retryBaseMs?: number;
  /** Longest reconnect delay in ms. Default 30_000. */
  retryMaxMs?: number;
  /** Closes the stream when aborted. */
  signal?: AbortSignal;
}

/** A running subscription. */
export interface EngineEventStream {
  readonly status: EngineEventStreamStatus;
  /** Stop for good. Safe to call more than once. */
  close(): void;
  /** Settles once the stream is closed: by `close()`, the signal, `reconnect: false`, or a permanent error. */
  readonly done: Promise<void>;
}

export class EventsClient {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  /** Open the live stream and call `onEvent` for every event until closed. */
  stream(options: EngineEventStreamOptions): EngineEventStream {
    return new LiveStream(this.http, options);
  }
}

class LiveStream implements EngineEventStream {
  status: EngineEventStreamStatus = 'connecting';
  readonly done: Promise<void>;
  private readonly controller = new AbortController();
  private serverRetryMs: number | undefined;

  constructor(
    private readonly http: HttpClient,
    private readonly options: EngineEventStreamOptions,
  ) {
    const external = options.signal;
    if (external) {
      if (external.aborted) this.controller.abort();
      else external.addEventListener('abort', () => this.close(), { once: true });
    }
    this.done = this.run();
  }

  close(): void {
    this.controller.abort();
  }

  private setStatus(status: EngineEventStreamStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  private async run(): Promise<void> {
    const signal = this.controller.signal;
    let failures = 0;
    try {
      while (!signal.aborted) {
        try {
          const opened = await this.connectAndRead(signal);
          // A stream that delivered and then ended cleanly starts the backoff over.
          if (opened) failures = 0;
        } catch (err) {
          if (signal.aborted || err instanceof ScormAbortError) break;
          this.options.onError?.(err);
          if (err instanceof ScormHttpError && !isRetryableStatus(err.status)) break;
        }
        if (signal.aborted || this.options.reconnect === false) break;
        failures += 1;
        this.setStatus('reconnecting');
        const delay = computeBackoff({
          baseMs: this.options.retryBaseMs ?? this.serverRetryMs ?? 1000,
          maxMs: this.options.retryMaxMs ?? 30_000,
          attempt: failures,
          jitter: false,
        });
        await wait(delay, signal);
      }
    } finally {
      this.controller.abort();
      this.setStatus('closed');
    }
  }

  /** One connection. Resolves `true` if it opened, when the server ends the stream. */
  private async connectAndRead(signal: AbortSignal): Promise<boolean> {
    const types = this.options.types;
    const res = await this.http.raw({
      path: 'events/stream',
      query: types && types.length > 0 ? { types: types.join(',') } : {},
      headers: { accept: 'text/event-stream' },
      signal,
      // Reconnects are this class's job; one attempt per connection.
      retries: 0,
    });
    if (!res.body) throw new Error('The event stream response has no body');
    this.setStatus('open');

    try {
      for await (const msg of parseSse(res.body, signal)) {
        if (msg.retry !== undefined) this.serverRetryMs = msg.retry;
        if (!msg.data) continue;
        let payload: WebhookPayload;
        try {
          payload = JSON.parse(msg.data) as WebhookPayload;
        } catch {
          continue;
        }
        this.options.onEvent(payload);
      }
    } catch (err) {
      if (signal.aborted) return true;
      throw err;
    }
    return true;
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
