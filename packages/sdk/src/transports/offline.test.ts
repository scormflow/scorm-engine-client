import { describe, expect, it, vi } from 'vitest';

import { ScormHttpError, ScormNetworkError } from '../errors.js';
import type { RuntimeState } from '../transport.js';
import type { StorageLike } from './local-storage.js';
import { OfflineTransport, isOfflineError, type SyncCapableTransport } from './offline.js';
import type { SyncCommit, SyncResult } from './rest.js';

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A fake engine that reconciles queues with the same seq rules as scorm-engine. */
class FakeEngine implements SyncCapableTransport {
  online = true;
  cmi: Record<string, unknown> = {};
  lastCommitSeq: number | null = null;
  finished = false;
  syncCalls: SyncCommit[][] = [];
  /** Apply the batch but "lose" the response, like a dropped connection. */
  dropNextResponse = false;

  async initialize(attemptId: string): Promise<RuntimeState> {
    if (!this.online) throw new ScormNetworkError('offline');
    return {
      attemptId,
      version: 'SCORM_2004_4',
      status: this.finished ? 'COMPLETED' : 'IN_PROGRESS',
      cmi: { ...this.cmi },
      entry: Object.keys(this.cmi).length > 0 ? 'resume' : 'ab-initio',
      lastCommitSeq: this.lastCommitSeq,
    };
  }

  async commit(): Promise<never> {
    throw new Error('OfflineTransport must deliver through sync()');
  }

  async terminate(): Promise<never> {
    throw new Error('OfflineTransport must deliver through sync()');
  }

  async sync(_attemptId: string, commits: SyncCommit[]): Promise<SyncResult> {
    if (!this.online) throw new ScormNetworkError('offline');
    this.syncCalls.push(commits);
    const results = [...commits]
      .sort((a, b) => a.seq - b.seq)
      .map((c) => {
        const base = { seq: c.seq, errors: [], warnings: [], terminated: false, suspended: false };
        if (this.lastCommitSeq !== null && c.seq <= this.lastCommitSeq) return { ...base, status: 'duplicate' as const };
        if (this.finished) return { ...base, status: 'conflict' as const };
        Object.assign(this.cmi, c.values);
        this.lastCommitSeq = c.seq;
        if (c.terminate) this.finished = true;
        return { ...base, status: 'applied' as const, terminated: Boolean(c.terminate) };
      });
    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      throw new ScormNetworkError('connection reset');
    }
    return { lastCommitSeq: this.lastCommitSeq, results, summary: null };
  }
}

function setup(opts: { storage?: StorageLike; engine?: FakeEngine } = {}) {
  const engine = opts.engine ?? new FakeEngine();
  const storage = opts.storage ?? memoryStorage();
  const onConflict = vi.fn();
  const transport = new OfflineTransport({
    remote: engine,
    storage,
    onConflict,
    flushOnOnline: false,
    now: () => new Date('2026-10-11T09:00:00Z'),
  });
  return { engine, storage, transport, onConflict };
}

describe('OfflineTransport', () => {
  it('delivers commits straight through when online', async () => {
    const { engine, transport } = setup();
    await transport.initialize('a1');
    const res = await transport.commit('a1', { 'cmi.location': 'p1' });
    expect(res).toMatchObject({ ok: true });
    expect(res.queued).toBeUndefined();
    expect(engine.cmi['cmi.location']).toBe('p1');
    expect(engine.syncCalls[0]).toEqual([
      { seq: 1, values: { 'cmi.location': 'p1' }, recordedAt: '2026-10-11T09:00:00.000Z' },
    ]);
    expect(transport.pending('a1')).toBe(0);
  });

  it('queues while offline and flushes in order on reconnect', async () => {
    const { engine, transport } = setup();
    await transport.initialize('a1');
    engine.online = false;

    const r1 = await transport.commit('a1', { 'cmi.location': 'p2' });
    const r2 = await transport.commit('a1', { 'cmi.location': 'p3', 'cmi.progress_measure': '0.6' });
    expect(r1.queued).toBe(true);
    expect(r2.queued).toBe(true);
    expect(transport.pending('a1')).toBe(2);
    expect(transport.pendingAttempts()).toEqual(['a1']);

    engine.online = true;
    const flushed = await transport.flush('a1');
    expect(flushed).toMatchObject({ applied: 2, duplicates: 0, pending: 0, lastCommitSeq: 2, offline: false });
    expect(engine.syncCalls.at(-1)!.map((c) => c.seq)).toEqual([1, 2]);
    expect(engine.cmi['cmi.location']).toBe('p3');
    expect(transport.pendingAttempts()).toEqual([]);
  });

  it('survives a reload: the queue lives in storage', async () => {
    const storage = memoryStorage();
    const engine = new FakeEngine();
    const first = setup({ storage, engine }).transport;
    await first.initialize('a1');
    engine.online = false;
    await first.commit('a1', { 'cmi.suspend_data': 'chapter-2' });

    // New page load, still offline: the SCO resumes from the cached snapshot.
    const second = setup({ storage, engine }).transport;
    const state = await second.initialize('a1');
    expect(state.entry).toBe('resume');
    expect(state.cmi['cmi.suspend_data']).toBe('chapter-2');
    expect(state.version).toBe('SCORM_2004_4');

    engine.online = true;
    await second.flush('a1');
    expect(engine.cmi['cmi.suspend_data']).toBe('chapter-2');
  });

  it('resends safely when a sync response is lost', async () => {
    const { engine, transport } = setup();
    await transport.initialize('a1');
    engine.dropNextResponse = true;

    const res = await transport.commit('a1', { 'cmi.location': 'p9' });
    expect(res.queued).toBe(true);
    expect(transport.pending('a1')).toBe(1);

    const flushed = await transport.flush('a1');
    expect(flushed).toMatchObject({ applied: 0, duplicates: 1, pending: 0 });
    expect(engine.lastCommitSeq).toBe(1);
  });

  it('drops already-applied commits and keeps seq monotonic on initialize', async () => {
    const storage = memoryStorage();
    const engine = new FakeEngine();
    const { transport } = setup({ storage, engine });
    await transport.initialize('a1');
    engine.dropNextResponse = true;
    await transport.commit('a1', { 'cmi.location': 'p1' });
    expect(transport.pending('a1')).toBe(1);

    // Another page load: the engine already has seq 1, so it is not resent.
    const reloaded = setup({ storage, engine }).transport;
    const state = await reloaded.initialize('a1');
    expect(state.cmi['cmi.location']).toBe('p1');
    expect(reloaded.pending('a1')).toBe(0);
    const callsBefore = engine.syncCalls.length;
    await reloaded.commit('a1', { 'cmi.location': 'p2' });
    expect(engine.syncCalls.length).toBe(callsBefore + 1);
    expect(engine.syncCalls.at(-1)![0]!.seq).toBe(2);
  });

  it('starts numbering above the engine lastCommitSeq on a fresh device', async () => {
    const engine = new FakeEngine();
    engine.lastCommitSeq = 41;
    const { transport } = setup({ engine });
    await transport.initialize('a1');
    await transport.commit('a1', { 'cmi.location': 'x' });
    expect(engine.syncCalls[0]![0]!.seq).toBe(42);
    expect(engine.cmi['cmi.location']).toBe('x');
  });

  it('queues a terminate offline and refuses commits after it', async () => {
    const { engine, transport } = setup();
    await transport.initialize('a1');
    engine.online = false;
    await transport.terminate('a1', { 'cmi.completion_status': 'completed' });
    await expect(transport.commit('a1', { 'cmi.location': 'late' })).rejects.toThrow(/already been terminated/);

    engine.online = true;
    await transport.flush('a1');
    expect(engine.finished).toBe(true);
    expect(engine.cmi['cmi.completion_status']).toBe('completed');
  });

  it('reports conflicts when the attempt was finished elsewhere', async () => {
    const storage = memoryStorage();
    const engine = new FakeEngine();
    const { transport, onConflict } = setup({ storage, engine });
    await transport.initialize('a1');
    engine.online = false;
    await transport.commit('a1', { 'cmi.location': 'offline-work' });

    // Meanwhile another device finished the attempt.
    engine.online = true;
    engine.finished = true;
    engine.lastCommitSeq = 0;
    const flushed = await transport.flush('a1');
    expect(flushed.conflicts.map((c) => c.seq)).toEqual([1]);
    expect(onConflict).toHaveBeenCalledWith('a1', [expect.objectContaining({ seq: 1 })]);
    expect(transport.pending('a1')).toBe(0);
    await expect(transport.commit('a1', {})).rejects.toThrow(/already been terminated/);
  });

  it('rethrows non-offline errors instead of queueing forever', async () => {
    const { engine, transport } = setup();
    await transport.initialize('a1');
    engine.sync = async () => {
      throw new ScormHttpError(403, { code: 'forbidden', message: 'token expired' }, 'forbidden');
    };
    await expect(transport.commit('a1', { 'cmi.location': 'p' })).rejects.toThrow('token expired');
    // The commit is still queued for a later flush with a fresh token.
    expect(transport.pending('a1')).toBe(1);
  });

  it('cannot initialize offline without a cached snapshot', async () => {
    const { engine, transport } = setup();
    engine.online = false;
    await expect(transport.initialize('a1')).rejects.toBeInstanceOf(ScormNetworkError);
  });

  it('splits large queues into batches', async () => {
    const engine = new FakeEngine();
    const transport = new OfflineTransport({
      remote: engine,
      storage: memoryStorage(),
      maxBatchSize: 2,
      flushOnOnline: false,
    });
    await transport.initialize('a1');
    engine.online = false;
    for (let i = 0; i < 5; i++) await transport.commit('a1', { 'cmi.location': `p${i}` });
    engine.online = true;
    const flushed = await transport.flush('a1');
    expect(flushed.applied).toBe(5);
    expect(engine.syncCalls.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it('flushes on the browser online event', async () => {
    const listeners: Record<string, () => void> = {};
    const g = globalThis as Record<string, unknown>;
    const prevAdd = g.addEventListener;
    const prevRemove = g.removeEventListener;
    g.addEventListener = (type: string, fn: () => void) => void (listeners[type] = fn);
    g.removeEventListener = (type: string) => void delete listeners[type];
    try {
      const engine = new FakeEngine();
      const transport = new OfflineTransport({ remote: engine, storage: memoryStorage() });
      await transport.initialize('a1');
      engine.online = false;
      await transport.commit('a1', { 'cmi.location': 'p' });
      engine.online = true;
      listeners.online!();
      await vi.waitFor(() => expect(transport.pending('a1')).toBe(0));
      transport.dispose();
      expect(listeners.online).toBeUndefined();
    } finally {
      g.addEventListener = prevAdd;
      g.removeEventListener = prevRemove;
    }
  });

  it('notifies subscribers when a queue changes', async () => {
    const { engine, transport } = setup();
    await transport.initialize('a1');
    const seen: number[] = [];
    const off = transport.subscribe((id) => seen.push(transport.pending(id)));
    engine.online = false;
    await transport.commit('a1', { 'cmi.location': 'p' });
    engine.online = true;
    await transport.flush('a1');
    off();
    transport.clear('a1');
    expect(seen).toContain(1);
    expect(seen.at(-1)).toBe(0);
  });

  it('classifies offline errors', () => {
    expect(isOfflineError(new ScormNetworkError('x'))).toBe(true);
    expect(isOfflineError(new ScormHttpError(503, undefined, 'x'))).toBe(true);
    expect(isOfflineError(new ScormHttpError(400, undefined, 'x'))).toBe(false);
    expect(isOfflineError(new Error('x'))).toBe(false);
  });
});
