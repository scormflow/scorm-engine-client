/**
 * Session replay against the engine's `/attempts/:id/replay` and
 * `/courses/:id/heatmap` REST surface.
 *
 * The engine rebuilds an attempt's timeline from its commit log, so reading a
 * replay needs nothing from the player. Players can opt in to richer capture —
 * tab hidden, idle, navigation, pointer, media, or content-defined events —
 * through a {@link ReplayRecorder}, which batches events and posts them with
 * the attempt token. Reading (`attempt`, `courseHeatmap`) needs the API key.
 */
import { ScormHttpError } from './errors.js';
import { HttpClient, type HttpClientOptions } from './http/http-client.js';

/** Capture event types the engine's timeline understands; any other dotted lowercase name is content-defined. */
export const REPLAY_EVENT_TYPES = [
  'page.hidden',
  'page.visible',
  'idle.start',
  'idle.end',
  'navigation',
  'pointer',
  'media.play',
  'media.pause',
  'media.ended',
] as const;

export type ReplayEventType = (typeof REPLAY_EVENT_TYPES)[number];

/** One capture event as the engine accepts it. */
export interface ReplayEvent {
  /** Client-generated id; an event whose id is already stored is skipped, so retries are safe. */
  id?: string;
  /** A {@link ReplayEventType} or a content-defined name such as `quiz.skipped`. */
  type: ReplayEventType | (string & {});
  /** ISO 8601 time it happened. */
  at: string;
  /** Slide / page the learner was on. A `navigation` event moves the learner here. */
  location?: string | null;
  /** At most 2048 bytes as JSON. `pointer` needs `x` and `y` between 0 and 1. */
  data?: Record<string, unknown>;
}

export interface ReplayEventsResult {
  accepted: number;
  /** Skipped because their id was already stored. */
  duplicates: number;
  /** Over the engine's per-attempt cap, not stored. */
  dropped: number;
}

export type ReplaySource = 'engine' | 'content' | 'client';

export interface ReplayTimelineEntry {
  at: string;
  /** Seconds since the attempt started. */
  offsetSeconds: number;
  /**
   * Engine: `attempt.started`, `attempt.finished`. Content (from commits):
   * `location.changed`, `status.changed`, `score.changed`, `progress.changed`,
   * `interaction.recorded`, `objective.updated`, `session.suspended`,
   * `session.resumed`. Client: the capture event's type.
   */
  type: string;
  source: ReplaySource;
  /** Where the learner was. A `location.changed` entry carries the location being left. */
  location: string | null;
  data: Record<string, unknown>;
}

export interface ReplayLocationVisit {
  location: string;
  enteredAt: string;
  leftAt: string;
  /** Not counting suspended, hidden, idle or 30-minute-silent stretches. */
  activeSeconds: number;
}

export type EngagementLevel = 'high' | 'medium' | 'low';

export interface EngagementScore {
  /** 0–100. */
  score: number;
  level: EngagementLevel;
  /** Each 0–1; null when there was nothing to measure it from (and it was left out of `score`). */
  components: { progress: number; focus: number | null; interactivity: number | null };
  activeSeconds: number;
  hiddenSeconds: number;
  idleSeconds: number;
  focusLosses: number;
  interactions: number;
  locationsVisited: number;
}

export interface AttemptReplay {
  attemptId: string;
  courseId: string;
  /** The learner's id in your system. */
  learner: { id: string; name: string | null };
  status: string;
  completionStatus: string;
  successStatus: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  /** Commits the timeline was rebuilt from. */
  commits: number;
  /** Whether the player sent any capture events. */
  captured: boolean;
  /** The attempt had more commits / events than one timeline reads. */
  truncated: boolean;
  entries: ReplayTimelineEntry[];
  visits: ReplayLocationVisit[];
  engagement: EngagementScore;
}

export interface HeatmapCell {
  x: number;
  y: number;
  count: number;
}

export interface HeatmapLocation {
  location: string;
  /** Visits across all attempts; going back counts again. */
  visits: number;
  /** Attempts that reached the location. */
  attempts: number;
  totalActiveSeconds: number;
  /** Per visit. */
  avgActiveSeconds: number;
  interactions: number;
  /** Unfinished attempts whose last location was this one. */
  dropOffs: number;
  /** Non-empty cells of the `grid` × `grid` pointer grid. */
  pointer: HeatmapCell[];
}

export interface CourseHeatmap {
  courseId: string;
  attempts: number;
  /** Attempts that completed, passed or failed. */
  completed: number;
  grid: number;
  /** More attempts matched than `limit`; the most recent were used. */
  truncated: boolean;
  /** In course order. */
  locations: HeatmapLocation[];
}

export interface HeatmapQuery {
  /** Most recent attempts to include (1–200, default 50). */
  limit?: number;
  /** Only attempts started at or after this time. */
  since?: string | Date;
}

type Signal = { signal?: AbortSignal };

const sig = (o?: Signal) => (o?.signal ? { signal: o.signal } : {});
const enc = encodeURIComponent;

/** The engine refuses capture (`REPLAY_CAPTURE_ENABLED=false`); stop sending. */
export function isReplayCaptureDisabled(err: unknown): boolean {
  return err instanceof ScormHttpError && err.status === 403 && err.code === 'replay_capture_disabled';
}

export class ReplayClient {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  /**
   * Store capture events (at most 500 per call). Works with the attempt token.
   * Safe to retry when events carry ids. `keepalive` lets the request outlive
   * the page (a flush on `pagehide`) and is not retried.
   */
  recordEvents(
    attemptId: string,
    events: readonly ReplayEvent[],
    options: Signal & { keepalive?: boolean } = {},
  ): Promise<ReplayEventsResult> {
    return this.http.post<ReplayEventsResult>(
      `attempts/${enc(attemptId)}/replay/events`,
      { events },
      { ...sig(options), ...(options.keepalive ? { keepalive: true, retries: 0 } : {}) },
    );
  }

  /** The attempt's rebuilt timeline, visits and engagement score. */
  attempt(attemptId: string, options?: Signal): Promise<AttemptReplay> {
    return this.http.get<AttemptReplay>(`attempts/${enc(attemptId)}/replay`, sig(options));
  }

  /** Per-location reach, dwell, interactions, drop-offs and pointer cells across recent attempts. */
  courseHeatmap(courseId: string, query: HeatmapQuery = {}, options?: Signal): Promise<CourseHeatmap> {
    const since = query.since instanceof Date ? query.since.toISOString() : query.since;
    return this.http.get<CourseHeatmap>(`courses/${enc(courseId)}/heatmap`, {
      query: { limit: query.limit, since },
      ...sig(options),
    });
  }
}

export interface ReplayRecorderOptions {
  /** Where batches go — usually `client.replay`. */
  replay: Pick<ReplayClient, 'recordEvents'>;
  attemptId: string;
  /** Flush buffered events this often; `0` flushes only on `flush()` / a full batch. Default 5000. */
  flushIntervalMs?: number;
  /** Events per request (1–500). Default 100. */
  maxBatch?: number;
  /** Events kept while the engine is unreachable; the oldest are dropped beyond it. Default 1000. */
  maxBuffered?: number;
  /** Clock, for tests. */
  now?: () => Date;
  onError?: (err: unknown) => void;
  /** Called once if the engine has capture turned off; the recorder then stops recording. */
  onDisabled?: () => void;
}

export interface RecordOptions {
  location?: string | null;
  data?: Record<string, unknown>;
  at?: Date;
}

/** Keepalive request bodies are capped at 64 KiB in browsers; keep unload batches small. */
const KEEPALIVE_BATCH = 25;

/**
 * Buffers capture events and posts them in batches. Every event gets an id, so
 * a batch that failed mid-flight is simply sent again. Network and server
 * errors keep events for the next flush; a batch the engine rejects as
 * malformed is dropped; a `replay_capture_disabled` answer turns the recorder off.
 */
export class ReplayRecorder {
  private readonly opts: ReplayRecorderOptions;
  private readonly maxBatch: number;
  private readonly maxBuffered: number;
  private readonly now: () => Date;
  private buffer: ReplayEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;
  private location: string | null = null;
  private stopped = false;
  private off = false;

  constructor(opts: ReplayRecorderOptions) {
    this.opts = opts;
    this.maxBatch = Math.min(500, Math.max(1, opts.maxBatch ?? 100));
    this.maxBuffered = Math.max(this.maxBatch, opts.maxBuffered ?? 1000);
    this.now = opts.now ?? (() => new Date());
    const interval = opts.flushIntervalMs ?? 5000;
    if (interval > 0) {
      this.timer = setInterval(() => void this.flush(), interval);
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  /** True once the engine said capture is off. */
  get disabled(): boolean {
    return this.off;
  }

  /** Events waiting to be sent. */
  get pending(): number {
    return this.buffer.length;
  }

  /** The location the last `navigate` moved to. */
  get currentLocation(): string | null {
    return this.location;
  }

  /** Buffer one event. A no-op once stopped or disabled. */
  record(type: string, options: RecordOptions = {}): void {
    if (this.stopped || this.off) return;
    const event: ReplayEvent = { id: newId(), type, at: (options.at ?? this.now()).toISOString() };
    if (options.location != null) event.location = options.location;
    if (options.data) event.data = options.data;
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffered) this.buffer.splice(0, this.buffer.length - this.maxBuffered);
    if (this.buffer.length >= this.maxBatch) void this.flush();
  }

  /** Record a `navigation` to `location`, unless the learner is already there. */
  navigate(location: string, data?: Record<string, unknown>): void {
    if (!location || location === this.location) return;
    this.location = location;
    this.record('navigation', { location, ...(data ? { data } : {}) });
  }

  /** Send everything buffered. Concurrent calls share one in-flight send. */
  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    while (this.inflight) await this.inflight;
    if (this.buffer.length === 0) return;
    this.inflight = this.send(options.keepalive === true).finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }

  /** Flush what is left and stop recording. */
  async stop(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush(options);
    this.stopped = true;
  }

  private async send(keepalive: boolean): Promise<void> {
    const size = keepalive ? Math.min(KEEPALIVE_BATCH, this.maxBatch) : this.maxBatch;
    while (this.buffer.length > 0 && !this.off) {
      const batch = this.buffer.slice(0, size);
      try {
        await this.opts.replay.recordEvents(this.opts.attemptId, batch, keepalive ? { keepalive } : {});
        this.remove(batch);
      } catch (err) {
        if (isReplayCaptureDisabled(err)) {
          this.off = true;
          this.buffer = [];
          if (this.timer) clearInterval(this.timer);
          this.timer = null;
          this.opts.onDisabled?.();
          return;
        }
        // A malformed batch will never be accepted; anything else may be transient.
        if (err instanceof ScormHttpError && err.status === 400) this.remove(batch);
        this.opts.onError?.(err);
        return;
      }
    }
  }

  private remove(batch: readonly ReplayEvent[]): void {
    const sent = new Set(batch);
    this.buffer = this.buffer.filter((e) => !sent.has(e));
  }
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
