/**
 * Engine plugins against the `/plugins` REST surface.
 *
 * `list` reports what the engine has installed; `activity` reads the built-in
 * analytics plugin's live event counts; `get` / `post` reach any plugin's own
 * routes (`/plugins/<name>/<path>`), which is how you call a custom plugin
 * without writing a client for it. Every call needs the API key.
 */
import { ScormHttpError } from './errors.js';
import { HttpClient, type HttpClientOptions, type HttpRequest } from './http/http-client.js';
import type { WebhookEventType } from './webhooks.js';

export interface InstalledPlugin {
  name: string;
  version: string | null;
}

/** Event count by type; types with no events are omitted. */
export type EventCounts = Partial<Record<WebhookEventType, number>>;

export interface ActivityBucket {
  /** Start of the minute, ISO 8601. */
  minute: string;
  total: number;
  counts: EventCounts;
}

/** What `GET /plugins/analytics/activity` returns. */
export interface ActivityReport {
  windowMinutes: number;
  /** Start of the oldest minute in `timeline`. */
  since: string;
  total: number;
  totals: EventCounts;
  /** One entry per minute, oldest first, empty minutes included. */
  timeline: ActivityBucket[];
}

export interface ActivityQuery {
  /** Window in minutes; defaults to (and may not exceed) the plugin's retention, 60 unless configured. */
  minutes?: number;
}

type Signal = { signal?: AbortSignal };
type Query = HttpRequest['query'];

const sig = (o?: Signal) => (o?.signal ? { signal: o.signal } : {});
const enc = encodeURIComponent;

function pluginPath(name: string, path: string): string {
  const rest = path.replace(/^\/+/, '');
  return `plugins/${enc(name)}${rest ? `/${rest}` : ''}`;
}

export class PluginsClient {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  /** Installed plugins, in install order. */
  async list(options?: Signal): Promise<InstalledPlugin[]> {
    const res = await this.http.get<{ data: InstalledPlugin[] }>('plugins', sig(options));
    return res.data;
  }

  /** Whether the engine has the named plugin installed. */
  async has(name: string, options?: Signal): Promise<boolean> {
    return (await this.list(options)).some((p) => p.name === name);
  }

  /**
   * Live per-minute event counts from the `analytics` plugin. Rejects with a
   * 404 {@link ScormHttpError} when the engine runs without it
   * (`PLUGINS=analytics` or `analyticsPlugin()` turns it on).
   */
  activity(query: ActivityQuery = {}, options?: Signal): Promise<ActivityReport> {
    return this.http.get<ActivityReport>('plugins/analytics/activity', {
      query: { minutes: query.minutes },
      ...sig(options),
    });
  }

  /** `GET /plugins/<name>/<path>` on any plugin. */
  get<T>(name: string, path: string, options: Signal & { query?: Query } = {}): Promise<T> {
    return this.http.get<T>(pluginPath(name, path), {
      ...(options.query ? { query: options.query } : {}),
      ...sig(options),
    });
  }

  /** `POST /plugins/<name>/<path>` on any plugin, with a JSON body. */
  post<T>(name: string, path: string, json?: unknown, options?: Signal): Promise<T> {
    return this.http.post<T>(pluginPath(name, path), json, sig(options));
  }
}

/** True when `err` is the 404 a missing plugin's route answers with. */
export function isPluginMissing(err: unknown): boolean {
  return err instanceof ScormHttpError && err.status === 404;
}
