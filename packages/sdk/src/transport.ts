export type ScormVersion =
  | 'SCORM_1_2'
  | 'SCORM_2004_2'
  | 'SCORM_2004_3'
  | 'SCORM_2004_4';

/** SCORM-native `cmi.core.entry` / `cmi.entry` values. */
export type ScormEntry = 'ab-initio' | 'resume' | '';

export interface ScormLearner {
  id: string;
  name?: string | null;
}

export interface RuntimeState {
  attemptId: string;
  version: ScormVersion;
  /** Attempt lifecycle status, when the source reports it (`IN_PROGRESS`, …). */
  status?: string;
  /**
   * Full CMI snapshot keyed by SCORM-native paths (e.g. `cmi.core.lesson_status`).
   * Empty for a new attempt; populated for a resume.
   */
  cmi: Record<string, unknown>;
  learner?: ScormLearner;
  entry?: ScormEntry;
}

export interface CommitOptions {
  /**
   * Session-time delta in seconds since the last commit. Used by the offline
   * transports (memory / local-storage) to track elapsed time; the REST
   * transport lets the server derive session time from `cmi.session_time`.
   */
  sessionTimeDeltaSeconds?: number;
  signal?: AbortSignal;
}

/**
 * A single element-level issue from a commit. Reported by the engine as either
 * an `error` (write rejected — strict mode) or a `warning` (write accepted
 * despite failing validation — lenient mode).
 */
export interface CommitIssue {
  /** The CMI element the write targeted. */
  element: string;
  /** SCORM API error code (edition-specific). */
  code: number;
  message: string;
}

/** Edition-neutral rollup of the outcome-bearing CMI elements. */
export interface RuntimeSummary {
  completionStatus: 'completed' | 'incomplete' | 'not attempted' | 'unknown';
  successStatus: 'passed' | 'failed' | 'unknown';
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
  scoreScaled: number | null;
  progressMeasure: number | null;
  lessonLocation: string | null;
  suspendData: string | null;
  sessionTime: string | null;
  exit: string | null;
}

export interface CommitResult {
  /** False only when writes were rejected (strict-mode engine). */
  ok: boolean;
  /** True when the commit finalized the attempt. */
  terminated?: boolean;
  /** Rejected writes (strict mode). */
  errors?: CommitIssue[];
  /** Accepted-but-nonconformant writes (lenient mode). */
  warnings?: CommitIssue[];
  /** Outcome rollup after the commit, when the engine returns it. */
  summary?: RuntimeSummary;
  /** Local transports stamp a commit time; the REST engine does not. */
  committedAt?: string;
}

export interface TerminateOptions {
  signal?: AbortSignal;
}

/**
 * The runtime data channel a SCORM player drives. Implementations back it with
 * an HTTP engine ({@link import('./transports/rest.js').RestTransport}), browser
 * storage, or memory. `initialize` fetches the CMI snapshot to hydrate the SCO;
 * `commit` flushes batched writes; `terminate` closes the session out.
 */
export interface ScormTransport {
  initialize(attemptId: string, options?: { signal?: AbortSignal }): Promise<RuntimeState>;
  commit(
    attemptId: string,
    values: Record<string, unknown>,
    options?: CommitOptions,
  ): Promise<CommitResult>;
  terminate(
    attemptId: string,
    values?: Record<string, unknown>,
    options?: TerminateOptions,
  ): Promise<void>;
}
