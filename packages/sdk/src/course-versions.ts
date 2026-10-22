/**
 * Git-style course versioning against the engine's `/courses/:id/versions`
 * and `/courses/:id/rollback` REST surface. Every upload of a course is an
 * immutable release; publishing makes a new one live, rollback makes an older
 * (or staged) one live again, and attempts stay on the release they launched
 * on. All calls need the API key.
 */
import { HttpClient, type HttpClientOptions } from './http/http-client.js';
import type { ScormVersion } from './transport.js';

/** One release of a course. */
export interface CourseVersion {
  id: string;
  courseId: string;
  /** 1, 2, 3… in publish order. */
  number: number;
  /** Human release name, e.g. `1.0`, `1.1`, `2.0`. */
  label: string;
  releaseNotes: string | null;
  /** Whether this is the live release. */
  current: boolean;
  title: string;
  description: string | null;
  scormVersion: ScormVersion | string;
  masteryScore: number | null;
  /** Primary launch file, relative to the package root. */
  launchHref: string;
  scoCount: number;
  /** 0 for a baseline backfilled from a course uploaded before versioning. */
  fileCount: number;
  sizeBytes: number;
  /** SHA-256 of the uploaded ZIP; null for a backfilled baseline. */
  packageSha256: string | null;
  createdAt: string;
}

export interface CourseVersionList {
  /** Newest first. */
  data: CourseVersion[];
  /** Number of the live release. */
  currentVersion: number | null;
}

export interface PublishVersionOptions {
  /** Explicit label; otherwise the previous `X.Y` label is bumped. */
  label?: string;
  /** Which part of the previous label to bump when `label` is omitted (engine default `minor`). */
  bump?: 'major' | 'minor';
  releaseNotes?: string;
  /** Override the title parsed from the manifest. */
  title?: string;
  /** `false` stores the release without making it live. Default `true`. */
  activate?: boolean;
  signal?: AbortSignal;
}

export interface VersionFieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface VersionSco {
  identifier: string;
  title: string;
  launchHref: string;
  parameters: string | null;
}

export interface VersionFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface VersionAssetDiff {
  added: VersionFile[];
  removed: VersionFile[];
  modified: Array<{ path: string; fromSizeBytes: number; toSizeBytes: number }>;
  unchangedCount: number;
  /** Total size of `to` minus `from`. */
  bytesDelta: number;
}

/** What `GET /courses/:id/versions/diff` returns. */
export interface CourseVersionDiff {
  from: { number: number; label: string };
  to: { number: number; label: string };
  /** Nothing differs. Always false when assets can't be compared. */
  identical: boolean;
  /** Changed `title` / `description` / `scormVersion` / `masteryScore` / `launchHref`. */
  metadata: VersionFieldChange[];
  /** SCOs matched by manifest identifier. */
  scos: {
    added: VersionSco[];
    removed: VersionSco[];
    changed: Array<{ identifier: string; changes: VersionFieldChange[] }>;
  };
  /** Files matched by path, compared by SHA-256; null when either side is a backfilled baseline. */
  assets: VersionAssetDiff | null;
  /** Advisory: changes that could strand a learner relaunching on the new release. */
  breakingChanges: string[];
}

export interface VersionDiffQuery {
  /** Defaults to the release before `to`. */
  from?: number;
  /** Defaults to the live release. */
  to?: number;
}

type Signal = { signal?: AbortSignal };

const sig = (o?: Signal) => (o?.signal ? { signal: o.signal } : {});
const enc = encodeURIComponent;

export class CourseVersionsClient {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  /** The course's releases, newest first — its changelog. */
  list(courseId: string, options?: Signal): Promise<CourseVersionList> {
    return this.http.get<CourseVersionList>(`courses/${enc(courseId)}/versions`, sig(options));
  }

  get(courseId: string, number: number, options?: Signal): Promise<CourseVersion> {
    return this.http.get<CourseVersion>(`courses/${enc(courseId)}/versions/${number}`, sig(options));
  }

  /**
   * Upload a new package as the course's next release. Live immediately unless
   * `activate: false`; attempts already running stay on their release.
   */
  publish(courseId: string, file: Blob, options: PublishVersionOptions = {}): Promise<CourseVersion> {
    const form = new FormData();
    if (options.label !== undefined) form.append('label', options.label);
    if (options.bump !== undefined) form.append('bump', options.bump);
    if (options.releaseNotes !== undefined) form.append('releaseNotes', options.releaseNotes);
    if (options.title !== undefined) form.append('title', options.title);
    if (options.activate !== undefined) form.append('activate', String(options.activate));
    // Fields before the file: the engine reads the ones that precede it.
    form.append('file', file);
    return this.http.request<CourseVersion>({
      path: `courses/${enc(courseId)}/versions`,
      method: 'POST',
      body: form,
      // A retried upload could publish the same package twice.
      retries: 0,
      ...sig(options),
    });
  }

  /** Replace a release's notes (`null` clears them). Releases are otherwise immutable. */
  updateNotes(courseId: string, number: number, releaseNotes: string | null, options?: Signal): Promise<CourseVersion> {
    return this.http.patch<CourseVersion>(
      `courses/${enc(courseId)}/versions/${number}`,
      { releaseNotes },
      sig(options),
    );
  }

  /** Metadata, SCO and asset diff between two releases (default: live vs the one before it). */
  diff(courseId: string, query: VersionDiffQuery = {}, options?: Signal): Promise<CourseVersionDiff> {
    return this.http.get<CourseVersionDiff>(`courses/${enc(courseId)}/versions/diff`, {
      query: { from: query.from, to: query.to },
      ...sig(options),
    });
  }

  /** Make release `number` live again. New attempts launch it; running ones keep theirs. */
  rollback(courseId: string, number: number, options?: Signal): Promise<CourseVersion> {
    return this.http.post<CourseVersion>(`courses/${enc(courseId)}/rollback`, { version: number }, sig(options));
  }
}
