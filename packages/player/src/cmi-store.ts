/**
 * In-memory CMI model backing the synchronous SCORM API surface.
 *
 * The SCORM JS API is synchronous — `LMSGetValue` must return a string
 * immediately — but the engine is reached over async HTTP. The bridge resolves
 * this by hydrating this store once at initialize, serving all reads/writes
 * from it synchronously, and flushing dirty values to the engine in the
 * background. This class owns that state plus dirty tracking and the
 * `_count` collection keyword.
 */
export class CmiStore {
  private readonly data = new Map<string, string>();
  private readonly dirty = new Map<string, string>();

  constructor(initial?: Record<string, unknown>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        if (v != null) this.data.set(k, String(v));
      }
    }
  }

  get(key: string): string | undefined {
    return this.data.get(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  /** Store a value and mark it dirty for the next flush. */
  set(key: string, value: string): void {
    this.data.set(key, value);
    this.dirty.set(key, value);
  }

  /**
   * Count of members in a collection prefix, e.g. `cmi.objectives` →
   * highest present index + 1. Backs reads of `<collection>._count`.
   */
  count(prefix: string): number {
    let max = -1;
    const needle = `${prefix}.`;
    for (const key of this.data.keys()) {
      if (!key.startsWith(needle)) continue;
      const rest = key.slice(needle.length);
      const dot = rest.indexOf('.');
      const idx = Number(dot === -1 ? rest : rest.slice(0, dot));
      if (Number.isInteger(idx) && idx > max) max = idx;
    }
    return max + 1;
  }

  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  /** Return the pending writes and clear the dirty set. */
  drainDirty(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.dirty) out[k] = v;
    this.dirty.clear();
    return out;
  }

  /** Full snapshot of the current model (not just dirty values). */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.data);
  }
}
