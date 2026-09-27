import type {
  CommitOptions,
  CommitResult,
  RuntimeState,
  ScormLearner,
  ScormTransport,
  ScormVersion,
  TerminateOptions,
} from '../transport.js';
import { ScormError } from '../errors.js';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalStorageTransportOptions {
  /** Defaults to `window.localStorage` when available. */
  storage?: StorageLike;
  /** Key prefix used to namespace attempts. Default `scormflow:attempt:`. */
  keyPrefix?: string;
  /** SCORM version reported by `initialize`. Default `SCORM_1_2`. */
  version?: ScormVersion;
  /** Default learner metadata. */
  learner?: ScormLearner;
  /** Inject a clock for deterministic tests. */
  now?: () => Date;
}

interface StoredAttempt {
  cmi: Record<string, unknown>;
  terminated: boolean;
  sessionTimeSeconds: number;
  initialized: boolean;
  updatedAt: string;
}

const DEFAULT_PREFIX = 'scormflow:attempt:';

export class LocalStorageTransport implements ScormTransport {
  private readonly storage: StorageLike;
  private readonly prefix: string;
  private readonly version: ScormVersion;
  private readonly learner: ScormLearner | undefined;
  private readonly now: () => Date;

  constructor(opts: LocalStorageTransportOptions = {}) {
    const storage =
      opts.storage ??
      (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: StorageLike }).localStorage
        ? (globalThis as { localStorage: StorageLike }).localStorage
        : undefined);
    if (!storage) {
      throw new ScormError(
        'LocalStorageTransport requires a Storage implementation. Pass `storage` explicitly outside browsers.',
      );
    }
    this.storage = storage;
    this.prefix = opts.keyPrefix ?? DEFAULT_PREFIX;
    this.version = opts.version ?? 'SCORM_1_2';
    this.learner = opts.learner;
    this.now = opts.now ?? (() => new Date());
  }

  async initialize(attemptId: string, _options?: { signal?: AbortSignal }): Promise<RuntimeState> {
    const existing = this.read(attemptId);
    if (existing?.terminated) {
      throw new ScormError(`Attempt ${attemptId} has already been terminated`);
    }
    const stored: StoredAttempt = existing ?? {
      cmi: {},
      terminated: false,
      sessionTimeSeconds: 0,
      initialized: false,
      updatedAt: this.now().toISOString(),
    };
    const isResume = stored.initialized || Object.keys(stored.cmi).length > 0;
    stored.initialized = true;
    stored.updatedAt = this.now().toISOString();
    this.write(attemptId, stored);

    const result: RuntimeState = {
      attemptId,
      version: this.version,
      cmi: { ...stored.cmi },
      entry: isResume ? 'resume' : 'ab-initio',
    };
    if (this.learner) result.learner = this.learner;
    return result;
  }

  async commit(
    attemptId: string,
    values: Record<string, unknown>,
    options?: CommitOptions,
  ): Promise<CommitResult> {
    const stored =
      this.read(attemptId) ??
      ({
        cmi: {},
        terminated: false,
        sessionTimeSeconds: 0,
        initialized: false,
        updatedAt: this.now().toISOString(),
      } as StoredAttempt);
    if (stored.terminated) {
      throw new ScormError(`Attempt ${attemptId} has already been terminated`);
    }
    Object.assign(stored.cmi, values);
    if (options?.sessionTimeDeltaSeconds) {
      stored.sessionTimeSeconds += options.sessionTimeDeltaSeconds;
    }
    stored.updatedAt = this.now().toISOString();
    this.write(attemptId, stored);
    return { ok: true, committedAt: stored.updatedAt };
  }

  async terminate(
    attemptId: string,
    values?: Record<string, unknown>,
    _options?: TerminateOptions,
  ): Promise<void> {
    const stored = this.read(attemptId);
    if (!stored || stored.terminated) return;
    if (values) Object.assign(stored.cmi, values);
    stored.terminated = true;
    stored.updatedAt = this.now().toISOString();
    this.write(attemptId, stored);
  }

  /** Erase persisted state for an attempt. */
  clear(attemptId: string): void {
    this.storage.removeItem(this.keyFor(attemptId));
  }

  private keyFor(attemptId: string): string {
    return `${this.prefix}${attemptId}`;
  }

  private read(attemptId: string): StoredAttempt | undefined {
    const raw = this.storage.getItem(this.keyFor(attemptId));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as StoredAttempt;
    } catch {
      return undefined;
    }
  }

  private write(attemptId: string, value: StoredAttempt): void {
    this.storage.setItem(this.keyFor(attemptId), JSON.stringify(value));
  }
}
