/**
 * Resource client for the engine's non-runtime REST surface: courses and
 * analytics. Complements {@link import('./transports/rest.js').RestTransport}
 * (which handles the attempt runtime loop) and shares the same
 * {@link HttpClient} configuration.
 */
import { HttpClient, type HttpClientOptions } from './http/http-client.js';
import {
  createHttpError,
  ScormHttpError,
  ScormNetworkError,
  ScormAbortError,
  type ScormErrorBody,
} from './errors.js';
import type { ScormVersion } from './transport.js';

export type ResourceClientOptions = HttpClientOptions;

export interface ScoSummary {
  id: string;
  identifier: string;
  title: string;
  launchHref: string;
  parameters: string | null;
  masteryScore: number | null;
}

export interface Course {
  id: string;
  title: string;
  description: string | null;
  version: ScormVersion | string;
  status: string;
  scos: ScoSummary[];
  primaryScoId: string | null;
  masteryScore: number | null;
  /** The live release; null for a course uploaded before versioning. */
  currentVersion?: { number: number; label: string } | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface LaunchUrlQuery {
  /** Attempt on the course to launch (content is only readable with an attempt token). */
  attemptId: string;
  /** SCO override by manifest `identifier`; defaults to the attempt's SCO, then the primary entry. */
  scoId?: string;
  /** Token lifetime (60–86400 s); defaults to the engine's `JWT_ATTEMPT_TTL_SECONDS`. */
  ttlSeconds?: number;
}

/** A signed, iframe-ready URL to an attempt's SCO. */
export interface LaunchUrl {
  /** Absolute content URL carrying `?token=`; feed it to the player's `launchUrl`. */
  launchUrl: string;
  /** The attempt token in `launchUrl`; it also authenticates the attempt's runtime calls. */
  token: string;
  expiresAt: string;
  /** Manifest identifier of the launched SCO; null for the release's primary entry. */
  scoId: string | null;
}

export interface CourseListResult {
  data: Course[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}

export interface AnalyticsOverview {
  courseCount: number;
  learnerCount: number;
  attemptCount: number;
  completionRate: number;
  averageScore: number | null;
}

export interface CourseAnalytics {
  courseId: string;
  attemptCount: number;
  completionCount: number;
  completionRate: number;
  averageScore: number | null;
  averageTimeSeconds: number | null;
  passRate: number | null;
  recentAttempts: unknown[];
}

export interface LearnerAnalytics {
  learnerId: string;
  attemptCount: number;
  completedCourseCount: number;
  totalTimeSeconds: number;
  recentAttempts: unknown[];
}

/** One UTC day of `GET /analytics/trends`. */
export interface TrendBucket {
  /** `YYYY-MM-DD` (UTC). */
  date: string;
  started: number;
  completed: number;
  passed: number;
  failed: number;
  /** Mean scaled score of the attempts completed that day. */
  averageScore: number | null;
}

/** What `GET /analytics/trends` returns: one bucket per day, no gaps. */
export interface AnalyticsTrends {
  courseId: string | null;
  interval: 'day';
  from: string;
  to: string;
  buckets: TrendBucket[];
  totals: { started: number; completed: number; passed: number; failed: number };
}

export interface TrendsQuery {
  /** Window length in days, 1–365 (engine default 30). */
  days?: number;
  /** Scope the series to one course. */
  courseId?: string;
}

export interface ScoreBin {
  /** Inclusive lower bound (scaled score). */
  min: number;
  /** Exclusive upper bound; the last bin includes 1. */
  max: number;
  count: number;
}

/** What `GET /analytics/courses/:id/scores` returns. */
export interface ScoreDistribution {
  courseId: string;
  scoredCount: number;
  averageScore: number | null;
  medianScore: number | null;
  bins: ScoreBin[];
}

export interface EngineHealth {
  status: 'ok';
  version: string;
}

export type ReadinessCheckStatus = 'ok' | 'error';

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: { database: ReadinessCheckStatus; storage: ReadinessCheckStatus };
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationCategory =
  | 'structure'
  | 'manifest'
  | 'resources'
  | 'runtime'
  | 'accessibility'
  | 'assets';

export interface ValidationIssue {
  /** Stable machine-readable code, e.g. `missing_launch_file`. */
  code: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  message: string;
  /** Package-relative file the issue is about, when there is one. */
  path: string | null;
}

/** Result of `POST /courses/validate`. */
export interface PackageValidationReport {
  /** True when there are no `error`-severity issues. */
  valid: boolean;
  version: ScormVersion | string | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  stats: {
    fileCount: number;
    totalBytes: number;
    /** SCOs found in the default organization. */
    launchableCount: number;
    /** HTML / JS files whose contents the engine scanned. */
    scannedFiles: number;
  };
  /** The parsed manifest, or null when it could not be parsed. */
  manifest: Record<string, unknown> | null;
}

export interface UploadCourseOptions {
  /** Override the title parsed from the manifest. */
  title?: string;
  /** Label for release 1 (engine default `1.0`). */
  label?: string;
  /** Changelog entry for release 1. */
  releaseNotes?: string;
  /** Progress callback in [0, 1]. Only fires on the XHR path (browser). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export class ResourceClient {
  readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  /**
   * Pass options to build a dedicated {@link HttpClient}, or an existing one to
   * share auth + retry configuration with another client.
   */
  constructor(opts: ResourceClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
    this.baseUrl = this.http.baseUrl;
    this.apiKey = this.http.apiKey;
  }

  // ---- system --------------------------------------------------------------

  /** Liveness: the engine is up, and which version it runs. Needs no credentials. */
  getHealth(options?: { signal?: AbortSignal }): Promise<EngineHealth> {
    return this.http.get<EngineHealth>('health', options?.signal ? { signal: options.signal } : {});
  }

  /**
   * Readiness: whether the engine can reach its database and storage. Resolves
   * with the report whether the engine answers `200` or `503` — check
   * `status` — and never retries, so it reflects the state right now. Network
   * failures and other HTTP errors still throw.
   */
  async getReadiness(options?: { signal?: AbortSignal }): Promise<ReadinessReport> {
    try {
      return await this.http.get<ReadinessReport>('ready', {
        retries: 0,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      if (err instanceof ScormHttpError && err.status === 503 && isReadinessReport(err.body)) return err.body;
      throw err;
    }
  }

  // ---- courses -------------------------------------------------------------

  listCourses(options?: { signal?: AbortSignal }): Promise<CourseListResult> {
    return this.http.get<CourseListResult>('courses', options?.signal ? { signal: options.signal } : {});
  }

  getCourse(courseId: string, options?: { signal?: AbortSignal }): Promise<Course> {
    return this.http.get<Course>(
      `courses/${encodeURIComponent(courseId)}`,
      options?.signal ? { signal: options.signal } : {},
    );
  }

  /** Signed iframe URL (and token) for an attempt's SCO. Server-side: needs the API key. */
  getLaunchUrl(courseId: string, query: LaunchUrlQuery, options?: { signal?: AbortSignal }): Promise<LaunchUrl> {
    return this.http.get<LaunchUrl>(`courses/${encodeURIComponent(courseId)}/launch-url`, {
      query: { attemptId: query.attemptId, scoId: query.scoId, ttlSeconds: query.ttlSeconds },
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  deleteCourse(courseId: string): Promise<void> {
    return this.http.delete<void>(`courses/${encodeURIComponent(courseId)}`);
  }

  /**
   * Upload a SCORM package. When `onProgress` is provided and `XMLHttpRequest`
   * exists (browser), uploads via XHR to report progress; otherwise falls back
   * to a fetch-based multipart POST.
   */
  uploadCourse(file: Blob, options: UploadCourseOptions = {}): Promise<Course> {
    if (options.onProgress && typeof XMLHttpRequest !== 'undefined') {
      return this.uploadViaXhr(file, options);
    }
    return this.http.request<Course>({
      path: 'courses',
      method: 'POST',
      body: uploadForm(file, options),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  /**
   * Validate a SCORM package without registering it: structure, manifest,
   * launch and resource files, runtime API compatibility, accessibility and
   * asset checks. Resolves with the report whether or not the package is valid.
   */
  validateCourse(file: Blob, options?: { signal?: AbortSignal }): Promise<PackageValidationReport> {
    const form = new FormData();
    form.append('file', file);
    return this.http.request<PackageValidationReport>({
      path: 'courses/validate',
      method: 'POST',
      body: form,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  private uploadViaXhr(file: Blob, options: UploadCourseOptions): Promise<Course> {
    return new Promise<Course>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}/courses`);
      if (this.apiKey) xhr.setRequestHeader('X-API-Key', this.apiKey);

      if (options.signal) {
        if (options.signal.aborted) {
          xhr.abort();
          reject(new ScormAbortError());
          return;
        }
        options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) options.onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as Course);
          } catch {
            reject(new ScormNetworkError('Invalid JSON in upload response'));
          }
        } else {
          reject(
            createHttpError(
              xhr.status,
              { get: (name) => xhr.getResponseHeader(name) },
              safeParse(xhr.responseText),
              `POST courses → ${xhr.status}`,
            ),
          );
        }
      };
      xhr.onerror = () => reject(new ScormNetworkError('Upload failed'));
      xhr.onabort = () => reject(new ScormAbortError());

      xhr.send(uploadForm(file, options));
    });
  }

  // ---- analytics -----------------------------------------------------------

  getOverview(options?: { signal?: AbortSignal }): Promise<AnalyticsOverview> {
    return this.http.get<AnalyticsOverview>('analytics/overview', options?.signal ? { signal: options.signal } : {});
  }

  getCourseAnalytics(courseId: string, options?: { signal?: AbortSignal }): Promise<CourseAnalytics> {
    return this.http.get<CourseAnalytics>(
      `analytics/courses/${encodeURIComponent(courseId)}`,
      options?.signal ? { signal: options.signal } : {},
    );
  }

  getLearnerAnalytics(learnerId: string, options?: { signal?: AbortSignal }): Promise<LearnerAnalytics> {
    return this.http.get<LearnerAnalytics>(
      `analytics/learners/${encodeURIComponent(learnerId)}`,
      options?.signal ? { signal: options.signal } : {},
    );
  }

  /** Daily started / completed / passed / failed series, tenant-wide or for one course. */
  getTrends(query: TrendsQuery = {}, options?: { signal?: AbortSignal }): Promise<AnalyticsTrends> {
    return this.http.get<AnalyticsTrends>('analytics/trends', {
      query: { days: query.days, courseId: query.courseId },
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  /** Scaled-score histogram (2–20 bins, engine default 10) plus mean and median. */
  getScoreDistribution(
    courseId: string,
    query: { bins?: number } = {},
    options?: { signal?: AbortSignal },
  ): Promise<ScoreDistribution> {
    return this.http.get<ScoreDistribution>(`analytics/courses/${encodeURIComponent(courseId)}/scores`, {
      query: { bins: query.bins },
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }
}

function isReadinessReport(body: unknown): body is ReadinessReport {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { status?: unknown }).status === 'not_ready' &&
    typeof (body as { checks?: unknown }).checks === 'object'
  );
}

/**
 * Multipart body for `POST /courses`. Text fields go before the file: the
 * engine reads the package as soon as it reaches the file part, so fields
 * after it are never seen.
 */
function uploadForm(file: Blob, options: UploadCourseOptions): FormData {
  const form = new FormData();
  if (options.title) form.append('title', options.title);
  if (options.label) form.append('label', options.label);
  if (options.releaseNotes) form.append('releaseNotes', options.releaseNotes);
  form.append('file', file);
  return form;
}

function safeParse(text: string): ScormErrorBody | undefined {
  try {
    return JSON.parse(text) as ScormErrorBody;
  } catch {
    return undefined;
  }
}
