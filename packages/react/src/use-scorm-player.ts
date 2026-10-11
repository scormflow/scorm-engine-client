import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommitResult, ScormTransport } from '@scormflow/sdk';
import { mountScormPlayer, type ScormPlayerHandle } from '@scormflow/player';

export type ScormPlayerStatus = 'loading' | 'ready' | 'error' | 'terminated';

export interface UseScormPlayerOptions {
  /** Attempt to drive (from the engine's start-attempt response). */
  attemptId: string;
  /** SCO entry URL to load in the iframe. */
  launchUrl: string;
  /** Engine transport (e.g. `RestTransport`). */
  transport: ScormTransport;
  /** Debounced background auto-commit window in ms; 0 disables. Default 10000. */
  autoCommitMs?: number;
  /** Called after each successful commit (foreground or background). */
  onCommit?: (result: CommitResult) => void;
  /** Called when a background sync fails. */
  onError?: (error: unknown) => void;
  /** Extra attributes for the created iframe (e.g. `sandbox`, `allow`). */
  iframeAttributes?: Record<string, string>;
}

export interface UseScormPlayerResult {
  /** Attach to the element the SCO iframe should mount into. */
  containerRef: React.RefObject<HTMLDivElement>;
  status: ScormPlayerStatus;
  /** Populated when `status === 'error'` (mount/hydration failure). */
  error: unknown;
  /** The live player handle once ready, else null. */
  player: ScormPlayerHandle | null;
  /** Force a background commit of pending writes. */
  commit: () => Promise<void>;
  /** Terminate the attempt early (also runs automatically on unmount). */
  terminate: () => Promise<void>;
}

/**
 * Mount a SCORM player into a React-managed container for the lifetime of the
 * component. Re-mounts when `attemptId`, `launchUrl`, or `transport` change, and
 * terminates cleanly on unmount. Callbacks are read through refs so changing
 * their identity does not force a re-mount.
 */
export function useScormPlayer(options: UseScormPlayerOptions): UseScormPlayerResult {
  const { attemptId, launchUrl, transport, autoCommitMs, iframeAttributes } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ScormPlayerHandle | null>(null);
  const [status, setStatus] = useState<ScormPlayerStatus>('loading');
  const [error, setError] = useState<unknown>(null);
  const [player, setPlayer] = useState<ScormPlayerHandle | null>(null);

  // Keep the latest callbacks without retriggering the mount effect.
  const onCommitRef = useRef(options.onCommit);
  const onErrorRef = useRef(options.onError);
  onCommitRef.current = options.onCommit;
  onErrorRef.current = options.onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setStatus('loading');
    setError(null);

    void mountScormPlayer({
      container,
      attemptId,
      launchUrl,
      transport,
      ...(autoCommitMs !== undefined ? { autoCommitMs } : {}),
      ...(iframeAttributes ? { iframeAttributes } : {}),
      onCommit: (result) => onCommitRef.current?.(result),
      onError: (err) => onErrorRef.current?.(err),
    })
      .then((handle) => {
        if (cancelled) {
          // Component unmounted (or deps changed) before mount resolved.
          void handle.destroy();
          return;
        }
        playerRef.current = handle;
        setPlayer(handle);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      const handle = playerRef.current;
      playerRef.current = null;
      setPlayer(null);
      if (handle) void handle.destroy();
    };
  }, [attemptId, launchUrl, transport, autoCommitMs, iframeAttributes]);

  const commit = useCallback(async () => {
    await playerRef.current?.commit();
  }, []);

  const terminate = useCallback(async () => {
    const handle = playerRef.current;
    if (!handle) return;
    await handle.destroy();
    playerRef.current = null;
    setPlayer(null);
    setStatus('terminated');
  }, []);

  return { containerRef, status, error, player, commit, terminate };
}
