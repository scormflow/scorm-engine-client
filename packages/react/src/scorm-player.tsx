import type { CSSProperties, ReactNode } from 'react';

import { useScormPlayer, type UseScormPlayerOptions } from './use-scorm-player.js';

export interface ScormPlayerProps extends UseScormPlayerOptions {
  className?: string;
  style?: CSSProperties;
  /** Rendered over the container while the attempt hydrates. */
  loadingFallback?: ReactNode;
  /** Rendered when mount/hydration fails. */
  errorFallback?: (error: unknown) => ReactNode;
}

const FILL: CSSProperties = { width: '100%', height: '100%' };

/**
 * Drop-in SCORM player. Renders a container the SCO iframe mounts into and
 * manages the attempt lifecycle via {@link useScormPlayer}. Pass a
 * `RestTransport` (or any `ScormTransport`) plus the attempt/launch details.
 *
 * ```tsx
 * <ScormPlayer
 *   attemptId={attemptId}
 *   launchUrl={launchUrl}
 *   transport={transport}
 *   style={{ height: 600 }}
 *   loadingFallback={<Spinner />}
 * />
 * ```
 */
export function ScormPlayer(props: ScormPlayerProps): JSX.Element {
  const { className, style, loadingFallback, errorFallback, ...options } = props;
  const { containerRef, status, error } = useScormPlayer(options);

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <div ref={containerRef} data-scormflow-container style={FILL} />
      {status === 'loading' && loadingFallback != null ? (
        <div data-scormflow-overlay="loading">{loadingFallback}</div>
      ) : null}
      {status === 'error' && errorFallback ? (
        <div data-scormflow-overlay="error">{errorFallback(error)}</div>
      ) : null}
    </div>
  );
}
