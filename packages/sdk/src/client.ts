/**
 * `ScormClient` — the top-level facade.
 *
 * One construction site for base URL, auth, retry and timeout configuration;
 * four namespaces over it:
 *
 *  - `courses`   — list / get / upload / delete  (REST, via {@link ResourceClient})
 *  - `attempts`  — start or resume an attempt    (REST, via {@link RestTransport})
 *  - `runtime`   — the SCORM data loop            (a {@link ScormTransport})
 *  - `analytics` — overview / course / learner read models
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
  type UploadCourseOptions,
} from './resources.js';
import {
  RestTransport,
  type StartAttemptRequest,
  type StartAttemptResult,
} from './transports/rest.js';
import type { ScormTransport } from './transport.js';

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

  readonly courses: CoursesApi;
  readonly attempts: AttemptsApi;
  readonly analytics: AnalyticsApi;

  constructor(opts: ScormClientOptions) {
    const { transport, ...httpOpts } = opts;
    this.http = new HttpClient(httpOpts);
    this.rest = new RestTransport(this.http);
    this.resources = new ResourceClient(this.http);
    this.runtime = transport ?? this.rest;

    const resources = this.resources;
    const rest = this.rest;

    this.courses = {
      list: (options) => resources.listCourses(options),
      get: (courseId, options) => resources.getCourse(courseId, options),
      upload: (file, options) => resources.uploadCourse(file, options),
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
