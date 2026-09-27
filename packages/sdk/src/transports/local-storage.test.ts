import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageTransport, type StorageLike } from './local-storage.js';
import { ScormError } from '../errors.js';

class MemoryStorage implements StorageLike {
  store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

describe('LocalStorageTransport', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('persists CMI state across commits and surfaces it on resume', async () => {
    const t = new LocalStorageTransport({ storage });
    await t.initialize('a1');
    await t.commit('a1', { 'cmi.core.lesson_location': 'page_3' });

    const t2 = new LocalStorageTransport({ storage });
    const state = await t2.initialize('a1');
    expect(state.entry).toBe('resume');
    expect(state.cmi['cmi.core.lesson_location']).toBe('page_3');
  });

  it('uses the configured key prefix', async () => {
    const t = new LocalStorageTransport({ storage, keyPrefix: 'test:' });
    await t.initialize('a1');
    await t.commit('a1', { x: 1 });
    expect(storage.getItem('test:a1')).not.toBeNull();
  });

  it('refuses to operate on a terminated attempt', async () => {
    const t = new LocalStorageTransport({ storage });
    await t.initialize('a1');
    await t.terminate('a1', { final: true });
    await expect(t.initialize('a1')).rejects.toBeInstanceOf(ScormError);
    await expect(t.commit('a1', {})).rejects.toBeInstanceOf(ScormError);
  });

  it('clear() removes persisted state', async () => {
    const t = new LocalStorageTransport({ storage });
    await t.initialize('a1');
    await t.commit('a1', { x: 1 });
    t.clear('a1');
    expect(storage.getItem('scormflow:attempt:a1')).toBeNull();
  });

  it('first initialize reports ab-initio entry', async () => {
    const t = new LocalStorageTransport({ storage });
    const state = await t.initialize('fresh');
    expect(state.entry).toBe('ab-initio');
  });

  it('throws when no Storage implementation is available', () => {
    const original = (globalThis as { localStorage?: StorageLike }).localStorage;
    try {
      delete (globalThis as { localStorage?: StorageLike }).localStorage;
      expect(() => new LocalStorageTransport()).toThrow(ScormError);
    } finally {
      if (original) (globalThis as { localStorage?: StorageLike }).localStorage = original;
    }
  });
});
