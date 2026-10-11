import { useCallback, useEffect, useState } from 'react';

export interface AsyncResource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Re-run the fetch (e.g. after a mutation). */
  refetch: () => void;
}

/**
 * Generic data-fetching hook: runs `run` whenever `key`/`enabled` change, tracks
 * loading/error/data, cancels in-flight requests on change or unmount, and
 * exposes a `refetch`. The concrete resource hooks are thin wrappers over this.
 */
export function useAsyncResource<T>(
  key: string,
  run: (signal: AbortSignal) => Promise<T>,
  enabled = true,
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    run(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err);
          setLoading(false);
        }
      });

    return () => controller.abort();
    // `run` is intentionally excluded: callers pass a fresh closure each render,
    // so we key re-fetches on the stable `key` + `enabled` + `nonce` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce]);

  return { data, error, loading, refetch };
}
