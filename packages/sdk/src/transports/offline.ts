import type {
  CommitOptions,
  CommitResult,
  RuntimeState,
  ScormLearner,
  ScormTransport,
  ScormVersion,
  TerminateOptions,
} from '../transport.js';
import {
  ScormError,
  ScormHttpError,
  ScormNetworkError,
  ScormTimeoutError,
  isRetryableStatus,
} from '../errors.js';
import type { StorageLike } from './local-storage.js';
import type { SyncCommit, SyncCommitOutcome, SyncResult } from './rest.js';

/** A transport that can reconcile a queued batch, e.g. {@link import('./rest.js').RestTransport}. */
export interface SyncCapableTransport extends ScormTransport {
  sync(attemptId: string, commits: SyncCommit[], options?: { signal?: AbortSignal }): Promise<SyncResult>;
}

export interface OfflineTransportOptions {
  /** The engine-facing transport commits are delivered through. */
  remote: SyncCapableTransport;
  /**
   * Durable storage for the queue and the last-known CMI snapshot. Defaults to
   * `window.localStorage`, falling back to in-memory storage (not durable).
   */
  storage?: StorageLike;
  /** Key prefix used to namespace queues. Default `scormflow:offline:`. */
  keyPrefix?: string;
  /** Most commits sent per sync request. Default 100 (the engine caps at 500). */
  maxBatchSize?: number;
  /**
   * Called with commits the engine refused because the attempt was already
   * finished (server state wins). They are dropped from the queue afterwards.
   */
  onConflict?: (attemptId: string, commits: SyncCommit[]) => void;
  /**
   * Decide whether an error means "offline, keep the commit queued". Defaults
   * to network errors, timeouts and retryable HTTP statuses (408/429/5xx).
   */
  isOfflineError?: (err: unknown) => boolean;
  /**
   * Flush every queue when the browser fires `online`. Default true when a
   * global `addEventListener` exists. Call {@link OfflineTransport.dispose} to detach.
   */
  flushOnOnline?: boolean;
  /** Inject a clock for deterministic tests. */
  now?: () => Date;
}

/** Outcome of one {@link OfflineTransport.flush}. */
export interface FlushResult {
  /** Commits the engine applied in this flush. */
  applied: number;
  /** Commits the engine had already applied (an earlier flush whose response was lost). */
  duplicates: number;
  /** Commits refused because the attempt was already finished. */
  conflicts: SyncCommit[];
  /** Commits still queued (the engine was unreachable mid-flush). */
  pending: number;
  /** The engine's `lastCommitSeq` after the flush, when it was reached. */
  lastCommitSeq: number | null;
  /** True when the engine could not be reached. */
  offline: boolean;
}

/** A flush plus the per-commit outcomes `commit` maps back to its caller. */
interface DetailedFlush extends FlushResult {
  outcomes: SyncCommitOutcome[];
  summary: SyncResult['summary'];
}

interface StoredQueue {
  /** Next `seq` to hand out; always above the engine's `lastCommitSeq`. */
  nextSeq: number;
  commits: SyncCommit[];
  /** Last-known CMI: the engine snapshot with queued writes applied on top. */
  cmi: Record<string, unknown>;
  version?: ScormVersion;
  status?: string;
  learner?: ScormLearner;
  /** Set once a queued terminate is recorded; further commits are refused. */
  terminated?: boolean;
}

const DEFAULT_PREFIX = 'scormflow:offline:';
const INDEX_KEY = 'index';

/**
 * Offline-first wrapper around an engine transport.
 *
 * Every commit is first written to a durable queue with a strictly increasing
 * `seq`, then delivered with `POST /attempts/{id}/sync`. When the engine is
 * unreachable the commit stays queued and the call still succeeds (with
 * `queued: true`), so the SCO keeps running; the queue is flushed on the next
 * commit, on `online`, or via {@link OfflineTransport.flush}.
 *
 * Reconciliation is idempotent: the engine skips any `seq` it has already
 * applied, so a flush whose response was lost is simply resent. `initialize`
 * works offline from the cached snapshot once an attempt has been opened
 * online, and on reconnect drops queued commits the engine already has.
 */
export class OfflineTransport implements ScormTransport {
  private readonly remote: SyncCapableTransport;
  private readonly storage: StorageLike;
  private readonly prefix: string;
  private readonly maxBatchSize: number;
  private readonly onConflict: OfflineTransportOptions['onConflict'];
  private readonly isOffline: (err: unknown) => boolean;
  private readonly now: () => Date;
  private readonly inflight = new Map<string, Promise<DetailedFlush>>();
  private readonly listeners = new Set<(attemptId: string) => void>();
  private detachOnline: (() => void) | undefined;

  constructor(opts: OfflineTransportOptions) {
    this.remote = opts.remote;
    this.storage = opts.storage ?? defaultStorage();
    this.prefix = opts.keyPrefix ?? DEFAULT_PREFIX;
    this.maxBatchSize = Math.max(1, Math.min(opts.maxBatchSize ?? 100, 500));
    this.onConflict = opts.onConflict;
    this.isOffline = opts.isOfflineError ?? isOfflineError;
    this.now = opts.now ?? (() => new Date());

    const target = globalThis as {
      addEventListener?: (type: string, fn: () => void) => void;
      removeEventListener?: (type: string, fn: () => void) => void;
    };
    if ((opts.flushOnOnline ?? true) && typeof target.addEventListener === 'function') {
      const onOnline = () => void this.flushAll().catch(() => undefined);
      target.addEventListener('online', onOnline);
      this.detachOnline = () => target.removeEventListener?.('online', onOnline);
    }
  }

  async initialize(attemptId: string, options?: { signal?: AbortSignal }): Promise<RuntimeState> {
    const cached = this.read(attemptId);
    let state: RuntimeState;
    try {
      state = await this.remote.initialize(attemptId, options);
    } catch (err) {
      if (!this.isOffline(err) || !cached?.version) throw err;
      // Offline: resume from the last-known snapshot plus queued writes.
      const offline: RuntimeState = {
        attemptId,
        version: cached.version,
        cmi: { ...cached.cmi },
        entry: Object.keys(cached.cmi).length > 0 ? 'resume' : 'ab-initio',
      };
      if (cached.status !== undefined) offline.status = cached.status;
      if (cached.learner) offline.learner = cached.learner;
      return offline;
    }

    const lastSeq = state.lastCommitSeq ?? null;
    const queue = cached ?? emptyQueue();
    // Drop whatever the engine already applied; never reuse a seq it has seen.
    if (lastSeq !== null) {
      queue.commits = queue.commits.filter((c) => c.seq > lastSeq);
      queue.nextSeq = Math.max(queue.nextSeq, lastSeq + 1);
    }
    queue.version = state.version;
    if (state.status !== undefined) queue.status = state.status;
    if (state.learner) queue.learner = state.learner;
    queue.cmi = { ...state.cmi };
    for (const c of queue.commits) Object.assign(queue.cmi, c.values);
    queue.terminated = queue.commits.some((c) => c.terminate);
    this.write(attemptId, queue);

    if (queue.commits.length > 0) {
      await this.flush(attemptId).catch(() => undefined);
    }
    const result: RuntimeState = { ...state, cmi: { ...queue.cmi } };
    if (queue.commits.length > 0 && Object.keys(queue.cmi).length > 0) result.entry = 'resume';
    return result;
  }

  async commit(
    attemptId: string,
    values: Record<string, unknown>,
    options?: CommitOptions,
  ): Promise<CommitResult> {
    return this.enqueueAndFlush(attemptId, values, false, options?.signal);
  }

  async terminate(
    attemptId: string,
    values?: Record<string, unknown>,
    options?: TerminateOptions,
  ): Promise<void> {
    await this.enqueueAndFlush(attemptId, values ?? {}, true, options?.signal);
  }

  /**
   * Deliver an attempt's queue. Concurrent calls for one attempt share a single
   * in-flight flush so commits are never sent out of order.
   */
  flush(attemptId: string, options?: { signal?: AbortSignal }): Promise<FlushResult> {
    return this.flushDetailed(attemptId, options?.signal);
  }

  private flushDetailed(attemptId: string, signal: AbortSignal | undefined): Promise<DetailedFlush> {
    const running = this.inflight.get(attemptId);
    if (running) return running;
    const run = this.runFlush(attemptId, signal).finally(() => this.inflight.delete(attemptId));
    this.inflight.set(attemptId, run);
    return run;
  }

  /** Flush every attempt that has queued commits. */
  async flushAll(options?: { signal?: AbortSignal }): Promise<Record<string, FlushResult>> {
    const out: Record<string, FlushResult> = {};
    for (const attemptId of this.readIndex()) {
      out[attemptId] = await this.flush(attemptId, options);
    }
    return out;
  }

  /** Number of commits waiting to be delivered for an attempt. */
  pending(attemptId: string): number {
    return this.read(attemptId)?.commits.length ?? 0;
  }

  /** Attempts with undelivered commits. */
  pendingAttempts(): string[] {
    return this.readIndex().filter((id) => this.pending(id) > 0);
  }

  /** Forget an attempt's queue and cached snapshot (undelivered commits are lost). */
  clear(attemptId: string): void {
    this.storage.removeItem(this.keyFor(attemptId));
    this.writeIndex(this.readIndex().filter((id) => id !== attemptId));
    this.notify(attemptId);
  }

  /**
   * Be told whenever an attempt's queue changes (commit queued, flush settled,
   * cleared). Returns an unsubscribe function.
   */
  subscribe(listener: (attemptId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(attemptId: string): void {
    for (const listener of this.listeners) listener(attemptId);
  }

  /** Detach the `online` listener. */
  dispose(): void {
    this.detachOnline?.();
    this.detachOnline = undefined;
  }

  private async enqueueAndFlush(
    attemptId: string,
    values: Record<string, unknown>,
    terminate: boolean,
    signal: AbortSignal | undefined,
  ): Promise<CommitResult> {
    const queue = this.read(attemptId) ?? emptyQueue();
    if (queue.terminated) {
      throw new ScormError(`Attempt ${attemptId} has already been terminated`);
    }
    const commit: SyncCommit = { seq: queue.nextSeq, values, recordedAt: this.now().toISOString() };
    if (terminate) commit.terminate = true;
    queue.nextSeq += 1;
    queue.commits.push(commit);
    Object.assign(queue.cmi, values);
    if (terminate) queue.terminated = true;
    this.write(attemptId, queue);

    // Wait out a flush that started before this commit was queued, then send ours.
    await this.inflight.get(attemptId)?.catch(() => undefined);
    const flushed = await this.flushDetailed(attemptId, signal);
    const outcome = flushed.outcomes.find((o) => o.seq === commit.seq);
    if (!outcome) return { ok: true, queued: true, committedAt: commit.recordedAt! };
    if (outcome.status === 'conflict') {
      throw new ScormError(`Attempt ${attemptId} was already finished; commit ${commit.seq} was not applied`);
    }
    const result: CommitResult = { ok: outcome.errors.length === 0 };
    if (outcome.terminated) result.terminated = true;
    if (outcome.suspended) result.suspended = true;
    if (outcome.status === 'duplicate') result.duplicate = true;
    if (outcome.errors.length > 0) result.errors = outcome.errors;
    if (outcome.warnings.length > 0) result.warnings = outcome.warnings;
    if (flushed.summary) result.summary = flushed.summary;
    return result;
  }

  private async runFlush(attemptId: string, signal: AbortSignal | undefined): Promise<DetailedFlush> {
    const outcomes: SyncCommitOutcome[] = [];
    const result: DetailedFlush = {
      applied: 0,
      duplicates: 0,
      conflicts: [],
      pending: 0,
      lastCommitSeq: null,
      offline: false,
      outcomes,
      summary: null,
    };

    for (;;) {
      const queue = this.read(attemptId);
      if (!queue || queue.commits.length === 0) break;
      const batch = queue.commits.slice(0, this.maxBatchSize);
      let response: SyncResult;
      try {
        response = await this.remote.sync(attemptId, batch, signal ? { signal } : undefined);
      } catch (err) {
        if (this.isOffline(err)) {
          result.offline = true;
          break;
        }
        throw err;
      }

      // Re-read: commits may have been queued while the request was in flight.
      const latest = this.read(attemptId) ?? queue;
      const settled = new Set<number>();
      const conflicts: SyncCommit[] = [];
      for (const outcome of response.results) {
        settled.add(outcome.seq);
        outcomes.push(outcome);
        if (outcome.status === 'applied') result.applied += 1;
        else if (outcome.status === 'duplicate') result.duplicates += 1;
        else {
          const commit = batch.find((c) => c.seq === outcome.seq);
          if (commit) conflicts.push(commit);
        }
      }
      latest.commits = latest.commits.filter((c) => !settled.has(c.seq));
      if (response.lastCommitSeq !== null) {
        latest.nextSeq = Math.max(latest.nextSeq, response.lastCommitSeq + 1);
      }
      if (conflicts.length > 0) latest.terminated = true;
      this.write(attemptId, latest);

      result.lastCommitSeq = response.lastCommitSeq;
      if (response.summary) result.summary = response.summary;
      if (conflicts.length > 0) {
        result.conflicts.push(...conflicts);
        this.onConflict?.(attemptId, conflicts);
      }
      // The engine must settle every commit it was sent; bail rather than loop forever.
      if (settled.size === 0) break;
    }

    result.pending = this.pending(attemptId);
    return result;
  }

  private keyFor(attemptId: string): string {
    return `${this.prefix}${attemptId}`;
  }

  private read(attemptId: string): StoredQueue | undefined {
    return parse<StoredQueue>(this.storage.getItem(this.keyFor(attemptId)));
  }

  private write(attemptId: string, queue: StoredQueue): void {
    this.storage.setItem(this.keyFor(attemptId), JSON.stringify(queue));
    const index = this.readIndex();
    if (!index.includes(attemptId)) this.writeIndex([...index, attemptId]);
    this.notify(attemptId);
  }

  private readIndex(): string[] {
    return parse<string[]>(this.storage.getItem(`${this.prefix}${INDEX_KEY}`)) ?? [];
  }

  private writeIndex(ids: string[]): void {
    this.storage.setItem(`${this.prefix}${INDEX_KEY}`, JSON.stringify(ids));
  }
}

/** Default offline classifier: the request never got a definitive answer. */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof ScormNetworkError || err instanceof ScormTimeoutError) return true;
  if (err instanceof ScormHttpError) return isRetryableStatus(err.status);
  return false;
}

function emptyQueue(): StoredQueue {
  return { nextSeq: 1, commits: [], cmi: {} };
}

function parse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function defaultStorage(): StorageLike {
  const local = (globalThis as { localStorage?: StorageLike }).localStorage;
  if (local) return local;
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
