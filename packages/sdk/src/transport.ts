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
  /**
   * Highest client commit `seq` the engine has applied (offline sync), or null
   * when no commit carried one. Absent for transports that do not track it.
   */
  lastCommitSeq?: number | null;
}

export interface CommitOptions {
  /**
   * Session-time delta in seconds since the last commit. Used by the offline
   * transports (memory / local-storage) to track elapsed time; the REST
   * transport lets the server derive session time from `cmi.session_time`.
   */
  sessionTimeDeltaSeconds?: number;
  /**
   * Client commit sequence number (strictly increasing per attempt). The engine
   * acknowledges a commit at or below its last applied `seq` as a duplicate
   * instead of re-applying it, so retries are safe.
   */
  seq?: number;
  /** When the commit was originally recorded, if it was queued offline. */
  recordedAt?: string;
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
  /**
   * True when a terminate with exit=suspend ended the session but left the
   * attempt open; the next start resumes it.
   */
  suspended?: boolean;
  /** Rejected writes (strict mode). */
  errors?: CommitIssue[];
  /** Accepted-but-nonconformant writes (lenient mode). */
  warnings?: CommitIssue[];
  /** Outcome rollup after the commit, when the engine returns it. */
  summary?: RuntimeSummary;
  /** Local transports stamp a commit time; the REST engine does not. */
  committedAt?: string;
  /** True when the engine had already applied this commit's `seq`; nothing was written. */
  duplicate?: boolean;
  /**
   * True when the commit could not reach the engine and was stored in the
   * offline queue ({@link import('./transports/offline.js').OfflineTransport});
   * it is delivered on the next successful flush.
   */
  queued?: boolean;
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
