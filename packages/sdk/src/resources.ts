/**
 * Resource client for the engine's non-runtime REST surface: courses and
 * analytics. Complements {@link import('./transports/rest.js').RestTransport}
 * (which handles the attempt runtime loop) and shares the same
 * {@link HttpClient} configuration.
 */
import { HttpClient, type HttpClientOptions } from './http/http-client.js';
import { ScormHttpError, ScormNetworkError, ScormAbortError, type ScormErrorBody } from './errors.js';
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
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
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

export interface UploadCourseOptions {
  /** Override the title parsed from the manifest. */
  title?: string;
  /** Progress callback in [0, 1]. Only fires on the XHR path (browser). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export class ResourceClient {
  readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(opts: ResourceClientOptions) {
    this.http = new HttpClient(opts);
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
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
    const form = new FormData();
    form.append('file', file);
    if (options.title) form.append('title', options.title);
    return this.http.request<Course>({
      path: 'courses',
      method: 'POST',
      body: form,
      ...(options.signal ? { signal: options.signal } : {}),
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
          reject(new ScormHttpError(xhr.status, safeParse(xhr.responseText), `POST courses → ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new ScormNetworkError('Upload failed'));
      xhr.onabort = () => reject(new ScormAbortError());

      const form = new FormData();
      form.append('file', file);
      if (options.title) form.append('title', options.title);
      xhr.send(form);
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
}

function safeParse(text: string): ScormErrorBody | undefined {
  try {
    return JSON.parse(text) as ScormErrorBody;
  } catch {
    return undefined;
  }
}
