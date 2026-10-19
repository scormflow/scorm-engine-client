/**
 * The engine's SDK-less embed flow: mint an attempt-scoped token, then hand a
 * learner's browser either the self-contained player page
 * (`/play/:attemptId`) for an `<iframe>`, or the drop-in runtime bridge
 * (`/runtime.js`) for a page that hosts the SCO itself.
 *
 * Minting needs the API key, so call {@link EmbedClient.token} /
 * {@link EmbedClient.launch} on a server and pass only the resulting URL (or
 * token) to the browser. The URL builders make no request.
 */
import { HttpClient, type HttpClientOptions } from './http/http-client.js';

export interface AttemptToken {
  /** Attempt-scoped JWT; accepted by commit, replay capture and content routes for this attempt only. */
  token: string;
  expiresAt: string;
}

export interface AttemptTokenOptions {
  /** Lifetime in seconds; the engine clamps it to 60–86 400. Default: the engine's `JWT_ATTEMPT_TTL_SECONDS`. */
  ttlSeconds?: number;
  signal?: AbortSignal;
}

export interface ReplayCaptureUrlOptions {
  /**
   * Have the served bridge capture session-replay events (tab visibility, idle
   * stretches, navigation, media). Ignored by engines with capture turned off.
   */
  replay?: boolean;
  /** With `replay`, also record click positions inside the content. */
  pointer?: boolean;
}

export interface PlayUrlOptions extends ReplayCaptureUrlOptions {
  theme?: 'light' | 'dark' | 'auto';
  /** `engine` (default) serves the uploaded package; `external` embeds `src` instead. */
  source?: 'engine' | 'external';
  /** Absolute SCO entry URL, required when `source` is `external`. */
  src?: string;
  /** Launch a SCO other than the attempt's default (engine source only). */
  scoId?: string;
}

export interface EmbedLaunch extends AttemptToken {
  /** The `/play/:attemptId` URL to put in an `<iframe>`. */
  url: string;
}

type Query = Record<string, string | undefined>;

export class EmbedClient {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  /** Mint a short-lived token scoped to one attempt (API key; server-side). */
  token(attemptId: string, options: AttemptTokenOptions = {}): Promise<AttemptToken> {
    return this.http.post<AttemptToken>(
      'auth/attempt-token',
      { attemptId, ...(options.ttlSeconds !== undefined ? { ttlSeconds: options.ttlSeconds } : {}) },
      options.signal ? { signal: options.signal } : {},
    );
  }

  /** URL of the self-contained player page for an attempt. */
  playUrl(attemptId: string, token: string, options: PlayUrlOptions = {}): string {
    return this.url(`play/${encodeURIComponent(attemptId)}`, {
      token,
      theme: options.theme,
      source: options.source,
      src: options.src,
      scoId: options.scoId,
      ...captureQuery(options),
    });
  }

  /**
   * URL of the runtime bridge script. With an attempt and token the engine
   * serves it hydrated with that attempt's state (one `<script>` tag is
   * enough); without, it is the bare cacheable script, configured by a
   * `window.__SCORMFLOW__` object the page sets first.
   */
  runtimeScriptUrl(attempt?: { attemptId: string; token: string } & ReplayCaptureUrlOptions): string {
    if (!attempt) return this.url('runtime.js', {});
    return this.url('runtime.js', { attemptId: attempt.attemptId, token: attempt.token, ...captureQuery(attempt) });
  }

  /** Mint a token and build the player URL in one go. */
  async launch(attemptId: string, options: PlayUrlOptions & AttemptTokenOptions = {}): Promise<EmbedLaunch> {
    const { ttlSeconds, signal, ...play } = options;
    const minted = await this.token(attemptId, {
      ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
      ...(signal ? { signal } : {}),
    });
    return { ...minted, url: this.playUrl(attemptId, minted.token, play) };
  }

  private url(path: string, query: Query): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
    const qs = params.toString();
    return `${this.http.baseUrl}/${path}${qs ? `?${qs}` : ''}`;
  }
}

function captureQuery(options: ReplayCaptureUrlOptions): Query {
  if (!options.replay) return {};
  return { replay: '1', ...(options.pointer ? { pointer: '1' } : {}) };
}
