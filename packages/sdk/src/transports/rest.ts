import { HttpClient, type HttpClientOptions } from '../http/http-client.js';
import type {
  CommitIssue,
  CommitOptions,
  CommitResult,
  RuntimeState,
  RuntimeSummary,
  ScormEntry,
  ScormLearner,
  ScormTransport,
  ScormVersion,
  TerminateOptions,
} from '../transport.js';

export type RestTransportOptions = HttpClientOptions;

/** Request body for {@link RestTransport.startAttempt}. */
export interface StartAttemptRequest {
  learnerId: string;
  learnerName?: string;
  scoId?: string;
  mode?: 'normal' | 'browse' | 'review';
  /** Force a new attempt instead of resuming an open one. */
  restart?: boolean;
}

/** Response from starting or resuming an attempt. */
export interface StartAttemptResult {
  attemptId: string;
  resumed: boolean;
  version: ScormVersion;
  entry?: ScormEntry;
  launch?: {
    learnerId: string;
    learnerName?: string;
    mode?: string;
    totalTime?: string;
    masteryScore?: number | null;
  };
  /** Previously-committed CMI snapshot to rehydrate the SCO (empty for new attempts). */
  cmi: Record<string, unknown>;
}

interface RuntimeStateDto {
  attemptId: string;
  version: ScormVersion;
  status?: string;
  cmi: Record<string, unknown>;
  entry?: ScormEntry;
  learner?: { id: string; name?: string | null };
}

interface CommitResponseDto {
  ok: boolean;
  terminated?: boolean;
  errors?: CommitIssue[];
  warnings?: CommitIssue[];
  summary?: RuntimeSummary;
}

/**
 * Talks to a `scorm-engine` backend.
 *
 * Maps the transport verbs onto the engine's REST surface:
 *  - `initialize` → `GET  /attempts/{id}/runtime`   (CMI snapshot for hydration)
 *  - `commit`     → `POST /attempts/{id}/commit`     (batched SetValue replay)
 *  - `terminate`  → `POST /attempts/{id}/commit` with `terminate: true`
 *
 * Starting/resuming an attempt is a separate concern from the runtime loop and
 * lives on {@link RestTransport.startAttempt}. The `HttpClient` is exposed via
 * {@link RestTransport.http} so higher-level resource clients can reuse the same
 * auth + retry configuration.
 */
export class RestTransport implements ScormTransport {
  readonly http: HttpClient;

  constructor(opts: RestTransportOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  /** Start or resume an attempt for a learner against a course. */
  async startAttempt(
    courseId: string,
    body: StartAttemptRequest,
    options?: { signal?: AbortSignal },
  ): Promise<StartAttemptResult> {
    const dto = await this.http.post<StartAttemptResult & { cmi?: Record<string, unknown> }>(
      `courses/${encodeURIComponent(courseId)}/attempts`,
      body,
      options?.signal ? { signal: options.signal } : {},
    );
    return { ...dto, cmi: dto.cmi ?? {} };
  }

  async initialize(attemptId: string, options?: { signal?: AbortSignal }): Promise<RuntimeState> {
    const dto = await this.http.get<RuntimeStateDto>(
      `attempts/${encodeURIComponent(attemptId)}/runtime`,
      options?.signal ? { signal: options.signal } : {},
    );
    const result: RuntimeState = {
      attemptId: dto.attemptId,
      version: dto.version,
      cmi: dto.cmi ?? {},
    };
    if (dto.status !== undefined) result.status = dto.status;
    if (dto.entry !== undefined) result.entry = dto.entry;
    if (dto.learner) {
      const learner: ScormLearner = { id: dto.learner.id };
      if (dto.learner.name != null) learner.name = dto.learner.name;
      result.learner = learner;
    }
    return result;
  }

  async commit(
    attemptId: string,
    values: Record<string, unknown>,
    options?: CommitOptions,
  ): Promise<CommitResult> {
    return this.postCommit(attemptId, values, false, options?.signal);
  }

  async terminate(
    attemptId: string,
    values?: Record<string, unknown>,
    options?: TerminateOptions,
  ): Promise<void> {
    await this.postCommit(attemptId, values ?? {}, true, options?.signal);
  }

  private async postCommit(
    attemptId: string,
    values: Record<string, unknown>,
    terminate: boolean,
    signal?: AbortSignal,
  ): Promise<CommitResult> {
    const dto = await this.http.post<CommitResponseDto>(
      `attempts/${encodeURIComponent(attemptId)}/commit`,
      { values, terminate },
      signal ? { signal } : {},
    );
    const result: CommitResult = { ok: dto.ok };
    if (dto.terminated !== undefined) result.terminated = dto.terminated;
    if (dto.errors && dto.errors.length > 0) result.errors = dto.errors;
    if (dto.warnings && dto.warnings.length > 0) result.warnings = dto.warnings;
    if (dto.summary) result.summary = dto.summary;
    return result;
  }
}
