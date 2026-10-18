/**
 * `ScormClient` — the top-level facade.
 *
 * One construction site for base URL, auth, retry and timeout configuration;
 * five namespaces over it:
 *
 *  - `courses`   — list / get / upload / delete  (REST, via {@link ResourceClient})
 *  - `attempts`  — start or resume an attempt    (REST, via {@link RestTransport})
 *  - `runtime`   — the SCORM data loop            (a {@link ScormTransport})
 *  - `analytics` — overview / course / learner read models
 *  - `xapi`      — the built-in LRS               (via {@link XapiClient})
 *  - `cmi5`      — cmi5 courses + registrations   (via {@link Cmi5Client})
 *  - `webhooks`  — endpoints + delivery log       (via {@link WebhooksClient})
 *  - `certificates` — completion certificates     (via {@link CertificatesClient})
 *  - `events`    — the live event stream (SSE)     (via {@link EventsClient})
 *  - `plugins`   — installed plugins, live activity (via {@link PluginsClient})
 *  - `ai`        — BYO-AI insights, provider keys, usage (via {@link AiClient})
 *  - `replay`    — session timelines, heatmaps, capture (via {@link ReplayClient})
 *
 * The facade owns a single {@link HttpClient} that every namespace shares, so
 * interceptors, headers and retry policy are configured once. `runtime` can be
 * swapped for any transport (memory, local storage, a custom one) without
 * disturbing the REST-backed namespaces.
 */
import { HttpClient, type HttpClientOptions } from './http/http-client.js';
import {
  ResourceClient,
  type AnalyticsOverview,
  type Course,
  type CourseAnalytics,
  type CourseListResult,
  type LearnerAnalytics,
  type PackageValidationReport,
  type UploadCourseOptions,
} from './resources.js';
import {
  RestTransport,
  type StartAttemptRequest,
  type StartAttemptResult,
} from './transports/rest.js';
import type { ScormTransport } from './transport.js';
import { XapiClient } from './xapi.js';
import { Cmi5Client } from './cmi5.js';
import { WebhooksClient } from './webhooks.js';
import { CertificatesClient } from './certificates.js';
import { EventsClient } from './events.js';
import { PluginsClient } from './plugins.js';
import { AiClient } from './ai.js';
import { ReplayClient } from './replay.js';

export interface ScormClientOptions extends HttpClientOptions {
  /**
   * Runtime transport backing `client.runtime`. Defaults to a
   * {@link RestTransport} over the facade's own `HttpClient`. Supply a
   * {@link import('./transports/memory.js').MemoryTransport} or
   * {@link import('./transports/local-storage.js').LocalStorageTransport} to run
   * the SCORM loop offline while courses/analytics still talk to the engine.
   */
  transport?: ScormTransport;
}

/** Signal-only options accepted by the read methods. */
export interface RequestOptions {
  signal?: AbortSignal;
}

export interface CoursesApi {
  list(options?: RequestOptions): Promise<CourseListResult>;
  get(courseId: string, options?: RequestOptions): Promise<Course>;
  upload(file: Blob, options?: UploadCourseOptions): Promise<Course>;
  /** Validate a package without registering it; resolves with the report, valid or not. */
  validate(file: Blob, options?: RequestOptions): Promise<PackageValidationReport>;
  delete(courseId: string): Promise<void>;
}

export interface AttemptsApi {
  /** Start a new attempt, or resume the learner's open one. */
  start(
    courseId: string,
    body: StartAttemptRequest,
    options?: RequestOptions,
  ): Promise<StartAttemptResult>;
}

export interface AnalyticsApi {
  overview(options?: RequestOptions): Promise<AnalyticsOverview>;
  course(courseId: string, options?: RequestOptions): Promise<CourseAnalytics>;
  learner(learnerId: string, options?: RequestOptions): Promise<LearnerAnalytics>;
}

export class ScormClient {
  /** The shared HTTP client. Exposed for one-off calls to endpoints the facade does not wrap. */
  readonly http: HttpClient;
  /** REST transport for the engine. Present even when `runtime` is a different transport. */
  readonly rest: RestTransport;
  /** Course + analytics REST surface. */
  readonly resources: ResourceClient;
  /** The transport a player drives: `initialize` / `commit` / `terminate`. */
  readonly runtime: ScormTransport;
  /** The built-in LRS: statements, state, profiles, activity and person lookups. */
  readonly xapi: XapiClient;
  /** cmi5 hosting: courses, registrations, AU launch, waive. */
  readonly cmi5: Cmi5Client;
  /** Webhook endpoints, test events, and the delivery log. */
  readonly webhooks: WebhooksClient;
  /** Completion certificates: list, read, PDF, revoke, verify. */
  readonly certificates: CertificatesClient;
  /** The live event stream: every engine event as it happens (API key; server-side). */
  readonly events: EventsClient;
  /** Engine plugins: what is installed, the analytics plugin's live activity, any plugin's routes. */
  readonly plugins: PluginsClient;
  /** AI analytics with the tenant's own provider: configs, insights, usage, call log. */
  readonly ai: AiClient;
  /** Session replay: attempt timelines, course heatmaps, and the player's capture events. */
  readonly replay: ReplayClient;

  readonly courses: CoursesApi;
  readonly attempts: AttemptsApi;
  readonly analytics: AnalyticsApi;

  constructor(opts: ScormClientOptions) {
    const { transport, ...httpOpts } = opts;
    this.http = new HttpClient(httpOpts);
    this.rest = new RestTransport(this.http);
    this.resources = new ResourceClient(this.http);
    this.runtime = transport ?? this.rest;
    this.xapi = new XapiClient(this.http);
    this.cmi5 = new Cmi5Client(this.http);
    this.webhooks = new WebhooksClient(this.http);
    this.certificates = new CertificatesClient(this.http);
    this.events = new EventsClient(this.http);
    this.plugins = new PluginsClient(this.http);
    this.ai = new AiClient(this.http);
    this.replay = new ReplayClient(this.http);

    const resources = this.resources;
    const rest = this.rest;

    this.courses = {
      list: (options) => resources.listCourses(options),
      get: (courseId, options) => resources.getCourse(courseId, options),
      upload: (file, options) => resources.uploadCourse(file, options),
      validate: (file, options) => resources.validateCourse(file, options),
      delete: (courseId) => resources.deleteCourse(courseId),
    };

    this.attempts = {
      start: (courseId, body, options) => rest.startAttempt(courseId, body, options),
    };

    this.analytics = {
      overview: (options) => resources.getOverview(options),
      course: (courseId, options) => resources.getCourseAnalytics(courseId, options),
      learner: (learnerId, options) => resources.getLearnerAnalytics(learnerId, options),
    };
  }
}

/** Convenience factory: `createScormClient({ baseUrl })`. */
export function createScormClient(opts: ScormClientOptions): ScormClient {
  return new ScormClient(opts);
}
