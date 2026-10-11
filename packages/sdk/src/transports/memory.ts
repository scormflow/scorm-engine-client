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

export interface MemoryTransportOptions {
  /** Default SCORM version reported by `initialize`. Defaults to `SCORM_1_2`. */
  version?: ScormVersion;
  /** Default learner metadata. */
  learner?: ScormLearner;
  /** Pre-seeded CMI state per attempt id. */
  initialState?: Record<string, Record<string, unknown>>;
  /** Inject a clock for deterministic tests. */
  now?: () => Date;
}

interface AttemptState {
  cmi: Record<string, unknown>;
  terminated: boolean;
  initialized: boolean;
  sessionTimeSeconds: number;
}

export class MemoryTransport implements ScormTransport {
  private readonly version: ScormVersion;
  private readonly learner: ScormLearner | undefined;
  private readonly store = new Map<string, AttemptState>();
  private readonly now: () => Date;

  constructor(opts: MemoryTransportOptions = {}) {
    this.version = opts.version ?? 'SCORM_1_2';
    this.learner = opts.learner;
    this.now = opts.now ?? (() => new Date());
    if (opts.initialState) {
      for (const [id, cmi] of Object.entries(opts.initialState)) {
        this.store.set(id, {
          cmi: { ...cmi },
          terminated: false,
          initialized: false,
          sessionTimeSeconds: 0,
        });
      }
    }
  }

  async initialize(attemptId: string, _options?: { signal?: AbortSignal }): Promise<RuntimeState> {
    const state = this.ensure(attemptId);
    if (state.terminated) {
      throw new ScormError(`Attempt ${attemptId} has already been terminated`);
    }
    const wasInitialized = state.initialized;
    state.initialized = true;
    const result: RuntimeState = {
      attemptId,
      version: this.version,
      cmi: { ...state.cmi },
      entry: wasInitialized || Object.keys(state.cmi).length > 0 ? 'resume' : 'ab-initio',
    };
    if (this.learner) result.learner = this.learner;
    return result;
  }

  async commit(
    attemptId: string,
    values: Record<string, unknown>,
    options?: CommitOptions,
  ): Promise<CommitResult> {
    const state = this.ensure(attemptId);
    if (state.terminated) {
      throw new ScormError(`Attempt ${attemptId} has already been terminated`);
    }
    Object.assign(state.cmi, values);
    if (options?.sessionTimeDeltaSeconds) {
      state.sessionTimeSeconds += options.sessionTimeDeltaSeconds;
    }
    return { ok: true, committedAt: this.now().toISOString() };
  }

  async terminate(
    attemptId: string,
    values?: Record<string, unknown>,
    _options?: TerminateOptions,
  ): Promise<void> {
    const state = this.ensure(attemptId);
    if (state.terminated) return;
    if (values) Object.assign(state.cmi, values);
    state.terminated = true;
  }

  /** Test / debug helper: read the current CMI snapshot. */
  snapshot(attemptId: string): Record<string, unknown> | undefined {
    const s = this.store.get(attemptId);
    return s ? { ...s.cmi } : undefined;
  }

  /** Test / debug helper: total committed session time in seconds. */
  sessionTime(attemptId: string): number {
    return this.store.get(attemptId)?.sessionTimeSeconds ?? 0;
  }

  /** Test helper: clear all attempts. */
  reset(): void {
    this.store.clear();
  }

  private ensure(attemptId: string): AttemptState {
    let state = this.store.get(attemptId);
    if (!state) {
      state = { cmi: {}, terminated: false, initialized: false, sessionTimeSeconds: 0 };
      this.store.set(attemptId, state);
    }
    return state;
  }
}
