import type { CommitResult, ScormTransport, ScormVersion } from '@scormflow/sdk';

import { CmiStore } from './cmi-store.js';

export interface RuntimeCoreOptions {
  attemptId: string;
  transport: ScormTransport;
  /**
   * Debounce window for background auto-commits after a SetValue, in ms.
   * Set to 0 to disable auto-commit (flush only on explicit Commit/Terminate).
   * Default 10000.
   */
  autoCommitMs?: number;
  /** Called after each successful background/explicit commit. */
  onCommit?: (result: CommitResult) => void;
  /** Called when a background flush fails (foreground calls also reject). */
  onError?: (error: unknown) => void;
}

/**
 * Shared engine behind the version-specific SCORM API surfaces.
 *
 * Owns the {@link CmiStore}, the transport, and the flush lifecycle: writes are
 * synchronous into the store, commits are async and serialized (never
 * overlapping), and a debounced auto-commit limits data loss between explicit
 * `Commit` calls. Construct via {@link RuntimeCore.create}, which hydrates the
 * store from the engine's runtime state.
 */
export class RuntimeCore {
  readonly attemptId: string;
  readonly version: ScormVersion;
  readonly store: CmiStore;

  private readonly transport: ScormTransport;
  private readonly autoCommitMs: number;
  private readonly onCommit: ((result: CommitResult) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;

  private flushing = false;
  private reflushRequested = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private terminated = false;

  private constructor(
    opts: RuntimeCoreOptions,
    version: ScormVersion,
    initialCmi: Record<string, unknown>,
  ) {
    this.attemptId = opts.attemptId;
    this.transport = opts.transport;
    this.version = version;
    this.store = new CmiStore(initialCmi);
    this.autoCommitMs = opts.autoCommitMs ?? 10_000;
    this.onCommit = opts.onCommit;
    this.onError = opts.onError;
  }

  /** Hydrate a runtime from the engine's current attempt state. */
  static async create(opts: RuntimeCoreOptions): Promise<RuntimeCore> {
    const state = await opts.transport.initialize(opts.attemptId);
    return new RuntimeCore(opts, state.version, state.cmi ?? {});
  }

  /** SCORM-native entry snapshot value, e.g. for `cmi.core.entry`. */
  get isResume(): boolean {
    return this.store.count('cmi.objectives') > 0 || this.store.snapshot()['cmi.location'] !== undefined;
  }

  /** Schedule a debounced background commit after a write. No-op if disabled. */
  scheduleAutoCommit(): void {
    if (this.autoCommitMs <= 0 || this.terminated) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.commit().catch((err) => this.onError?.(err));
    }, this.autoCommitMs);
  }

  /**
   * Flush pending writes to the engine. Serialized: a commit requested while
   * one is in flight is coalesced into a single follow-up flush so writes made
   * mid-commit are not lost.
   */
  async commit(): Promise<CommitResult | undefined> {
    if (this.terminated) return undefined;
    if (this.flushing) {
      this.reflushRequested = true;
      return undefined;
    }
    if (!this.store.hasDirty()) return { ok: true };

    this.cancelTimer();
    this.flushing = true;
    try {
      const values = this.store.drainDirty();
      const result = await this.transport.commit(this.attemptId, values);
      this.onCommit?.(result);
      return result;
    } finally {
      this.flushing = false;
      if (this.reflushRequested) {
        this.reflushRequested = false;
        await this.commit();
      }
    }
  }

  /** Final flush + terminate. Idempotent; further commits become no-ops. */
  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.cancelTimer();
    // Wait out any in-flight flush before the terminal write.
    while (this.flushing) {
      await new Promise((r) => setTimeout(r, 0));
    }
    const values = this.store.drainDirty();
    this.terminated = true;
    await this.transport.terminate(this.attemptId, values);
  }

  get isTerminated(): boolean {
    return this.terminated;
  }

  /** Forward an error to the configured handler (used by fire-and-forget calls). */
  reportError(error: unknown): void {
    this.onError?.(error);
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
