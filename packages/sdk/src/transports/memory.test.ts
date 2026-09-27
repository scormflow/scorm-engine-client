import { describe, expect, it } from 'vitest';
import { MemoryTransport } from './memory.js';
import { ScormError } from '../errors.js';

describe('MemoryTransport', () => {
  it('initializes a fresh attempt with ab-initio entry', async () => {
    const t = new MemoryTransport();
    const state = await t.initialize('a1');
    expect(state.attemptId).toBe('a1');
    expect(state.version).toBe('SCORM_1_2');
    expect(state.cmi).toEqual({});
    expect(state.entry).toBe('ab-initio');
  });

  it('reports `resume` entry when re-initializing after a commit', async () => {
    const t = new MemoryTransport();
    await t.initialize('a1');
    await t.commit('a1', { 'cmi.core.lesson_status': 'incomplete' });
    const state = await t.initialize('a1');
    expect(state.entry).toBe('resume');
    expect(state.cmi).toEqual({ 'cmi.core.lesson_status': 'incomplete' });
  });

  it('seeds initial state and reports resume entry', async () => {
    const t = new MemoryTransport({
      initialState: { a1: { 'cmi.suspend_data': 'x' } },
    });
    const state = await t.initialize('a1');
    expect(state.entry).toBe('resume');
    expect(state.cmi['cmi.suspend_data']).toBe('x');
  });

  it('merges committed values across calls', async () => {
    const t = new MemoryTransport();
    await t.initialize('a1');
    await t.commit('a1', { a: 1 });
    await t.commit('a1', { b: 2 });
    expect(t.snapshot('a1')).toEqual({ a: 1, b: 2 });
  });

  it('accumulates session time', async () => {
    const t = new MemoryTransport();
    await t.initialize('a1');
    await t.commit('a1', {}, { sessionTimeDeltaSeconds: 5 });
    await t.commit('a1', {}, { sessionTimeDeltaSeconds: 7 });
    expect(t.sessionTime('a1')).toBe(12);
  });

  it('reports a stable committedAt from the injected clock', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const t = new MemoryTransport({ now: () => now });
    const result = await t.commit('a1', { x: 1 });
    expect(result.ok).toBe(true);
    expect(result.committedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects further commits after terminate', async () => {
    const t = new MemoryTransport();
    await t.initialize('a1');
    await t.terminate('a1', { 'cmi.core.lesson_status': 'completed' });
    expect(t.snapshot('a1')).toEqual({ 'cmi.core.lesson_status': 'completed' });
    await expect(t.commit('a1', {})).rejects.toBeInstanceOf(ScormError);
    await expect(t.initialize('a1')).rejects.toBeInstanceOf(ScormError);
  });

  it('treats terminate as idempotent', async () => {
    const t = new MemoryTransport();
    await t.initialize('a1');
    await t.terminate('a1');
    await expect(t.terminate('a1')).resolves.toBeUndefined();
  });

  it('forwards configured learner metadata', async () => {
    const t = new MemoryTransport({ learner: { id: 'l-1', name: 'Ada' } });
    const state = await t.initialize('a1');
    expect(state.learner).toEqual({ id: 'l-1', name: 'Ada' });
  });
});
