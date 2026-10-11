/**
 * React binding for {@link OfflineTransport}: how many commits an attempt has
 * waiting to reach the engine, and a way to push them now.
 */
import { useCallback, useEffect, useState } from 'react';
import type { FlushResult, OfflineTransport } from '@scormflow/sdk';

export interface UseOfflineSyncResult {
  /** Commits queued for this attempt and not yet acknowledged by the engine. */
  pending: number;
  /** True while a flush started from this hook is in flight. */
  syncing: boolean;
  /** The last flush started from this hook, once it settles. */
  lastFlush: FlushResult | null;
  /** The error from the last flush, if it failed for a non-offline reason. */
  error: unknown;
  /** Deliver the queue now (e.g. from a "Sync now" button). */
  flush: () => Promise<FlushResult | null>;
}

export function useOfflineSync(
  transport: OfflineTransport,
  attemptId: string | null | undefined,
): UseOfflineSyncResult {
  const [pending, setPending] = useState(() => (attemptId ? transport.pending(attemptId) : 0));
  const [syncing, setSyncing] = useState(false);
  const [lastFlush, setLastFlush] = useState<FlushResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!attemptId) {
      setPending(0);
      return;
    }
    setPending(transport.pending(attemptId));
    return transport.subscribe((id) => {
      if (id === attemptId) setPending(transport.pending(attemptId));
    });
  }, [transport, attemptId]);

  const flush = useCallback(async () => {
    if (!attemptId) return null;
    setSyncing(true);
    setError(null);
    try {
      const result = await transport.flush(attemptId);
      setLastFlush(result);
      return result;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setSyncing(false);
    }
  }, [transport, attemptId]);

  return { pending, syncing, lastFlush, error, flush };
}
