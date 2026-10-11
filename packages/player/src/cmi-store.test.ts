import { describe, expect, it } from 'vitest';

import { CmiStore } from './cmi-store.js';

describe('CmiStore', () => {
  it('hydrates from an initial snapshot and coerces to strings', () => {
    const store = new CmiStore({ 'cmi.core.score.raw': 88, 'cmi.core.lesson_status': 'passed' });
    expect(store.get('cmi.core.score.raw')).toBe('88');
    expect(store.get('cmi.core.lesson_status')).toBe('passed');
    // Values from hydration are not considered dirty.
    expect(store.hasDirty()).toBe(false);
  });

  it('marks set values dirty and drains them once', () => {
    const store = new CmiStore();
    store.set('cmi.location', 'page-2');
    expect(store.hasDirty()).toBe(true);
    expect(store.drainDirty()).toEqual({ 'cmi.location': 'page-2' });
    expect(store.hasDirty()).toBe(false);
    expect(store.drainDirty()).toEqual({});
    // The value is still readable after draining.
    expect(store.get('cmi.location')).toBe('page-2');
  });

  it('counts collection members from the highest index present', () => {
    const store = new CmiStore({
      'cmi.objectives.0.id': 'a',
      'cmi.objectives.1.id': 'b',
      'cmi.objectives.4.id': 'e',
      'cmi.interactions.0.id': 'q1',
    });
    expect(store.count('cmi.objectives')).toBe(5);
    expect(store.count('cmi.interactions')).toBe(1);
    expect(store.count('cmi.comments')).toBe(0);
  });

  it('does not confuse prefixes with similar names', () => {
    const store = new CmiStore({ 'cmi.objectives_extra.0.id': 'x' });
    expect(store.count('cmi.objectives')).toBe(0);
  });
});
