import { describe, expect, it, vi } from 'vitest';
import type { CommitResult, RuntimeState, ScormTransport } from '@scormflow/sdk';

import { RuntimeCore } from './runtime.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeTransport(state: Partial<RuntimeState> = {}) {
  const calls = {
    commits: [] as Record<string, unknown>[],
    terminates: [] as (Record<string, unknown> | undefined)[],
  };
  const transport: ScormTransport = {
    async initialize() {
      return {
        attemptId: 'a1',
        version: state.version ?? 'SCORM_1_2',
        cmi: state.cmi ?? {},
      };
    },
    async commit(_id, values) {
      calls.commits.push(values);
      return { ok: true } satisfies CommitResult;
    },
    async terminate(_id, values) {
      calls.terminates.push(values);
    },
  };
  return { transport, calls };
}

describe('RuntimeCore', () => {
  it('hydrates the store from the transport runtime state', async () => {
    const { transport } = fakeTransport({
      version: 'SCORM_2004_4',
      cmi: { 'cmi.location': 'page-3' },
    });
    const core = await RuntimeCore.create({ attemptId: 'a1', transport, autoCommitMs: 0 });
    expect(core.version).toBe('SCORM_2004_4');
    expect(core.store.get('cmi.location')).toBe('page-3');
  });

  it('commits only dirty values and clears them', async () => {
    const { transport, calls } = fakeTransport();
    const core = await RuntimeCore.create({ attemptId: 'a1', transport, autoCommitMs: 0 });

    core.store.set('cmi.core.lesson_status', 'incomplete');
    await core.commit();
    expect(calls.commits).toEqual([{ 'cmi.core.lesson_status': 'incomplete' }]);

    // Nothing dirty → no network call.
    await core.commit();
    expect(calls.commits).toHaveLength(1);
  });

  it('coalesces a commit requested while one is in flight', async () => {
    const gate = deferred<void>();
    const commits: Record<string, unknown>[] = [];
    const transport: ScormTransport = {
      async initialize() {
        return { attemptId: 'a1', version: 'SCORM_1_2', cmi: {} };
      },
      async commit(_id, values) {
        commits.push(values);
        if (commits.length === 1) await gate.promise; // hold the first flush open
        return { ok: true };
      },
      async terminate() {},
    };
    const core = await RuntimeCore.create({ attemptId: 'a1', transport, autoCommitMs: 0 });

    core.store.set('a', '1');
    const first = core.commit(); // starts flushing, awaits gate
    core.store.set('b', '2');
    const second = await core.commit(); // in-flight → coalesced, returns undefined
    expect(second).toBeUndefined();

    gate.resolve();
    await first;
    // The coalesced follow-up flush ran with the second write.
    expect(commits).toEqual([{ a: '1' }, { b: '2' }]);
  });

  it('flushes remaining writes on terminate and blocks later commits', async () => {
    const { transport, calls } = fakeTransport();
    const core = await RuntimeCore.create({ attemptId: 'a1', transport, autoCommitMs: 0 });

    core.store.set('cmi.core.lesson_status', 'completed');
    await core.terminate();
    expect(calls.terminates).toEqual([{ 'cmi.core.lesson_status': 'completed' }]);
    expect(core.isTerminated).toBe(true);

    core.store.set('cmi.location', 'x');
    expect(await core.commit()).toBeUndefined();
    expect(calls.commits).toHaveLength(0);
  });

  it('debounced auto-commit flushes after the configured delay', async () => {
    vi.useFakeTimers();
    try {
      const { transport, calls } = fakeTransport();
      const core = await RuntimeCore.create({ attemptId: 'a1', transport, autoCommitMs: 5000 });
      core.store.set('cmi.location', 'p1');
      core.scheduleAutoCommit();
      expect(calls.commits).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(calls.commits).toEqual([{ 'cmi.location': 'p1' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
