import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { CommitResult, RuntimeSummary } from '@scormflow/sdk';

import { useScormPlayer, type ScormPlayerStatus, type UseScormPlayerOptions } from './use-scorm-player.js';

export interface ScormPlayerProps extends UseScormPlayerOptions {
  className?: string;
  style?: CSSProperties;
  /**
   * Render the framing chrome (header, footer, progress bar). Default `true`.
   * Set `false` for a bare SCO container with just the loading/error overlays —
   * the pre-chrome behaviour.
   */
  chrome?: boolean;
  /** Title shown in the header. When omitted the header is hidden (unless `showHeader`). */
  title?: ReactNode;
  /** Force the header on/off independently of `title`. Defaults to on when a `title` is set. */
  showHeader?: boolean;
  /** Show the footer (status, score, save button). Defaults to `chrome`. */
  showFooter?: boolean;
  /** Show the progress bar below the header. Defaults to `chrome`. */
  showProgress?: boolean;
  /** Extra controls rendered in the footer, left of the Save button. */
  footerActions?: ReactNode;
  /** Label for the manual-commit button. Default `"Save"`. */
  saveLabel?: string;
  /** Rendered over the container while the attempt hydrates. */
  loadingFallback?: ReactNode;
  /** Rendered when mount/hydration fails. */
  errorFallback?: (error: unknown) => ReactNode;
}

const FILL: CSSProperties = { width: '100%', height: '100%' };

// Theming hooks: every color/size reads a `--scormflow-*` CSS variable with a
// sensible fallback, so a host can restyle the whole chrome by setting variables
// on any ancestor — no stylesheet import required.
const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
  fontFamily: 'var(--scormflow-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'var(--scormflow-bg, #ffffff)',
  border: 'var(--scormflow-border, 1px solid #e2e2e2)',
  borderRadius: 'var(--scormflow-radius, 8px)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: 'var(--scormflow-header-padding, 0.625rem 0.875rem)',
  background: 'var(--scormflow-header-bg, #fafafa)',
  borderBottom: 'var(--scormflow-border, 1px solid #e2e2e2)',
  fontSize: 'var(--scormflow-title-size, 0.95rem)',
  fontWeight: 600,
};

const bodyStyle: CSSProperties = { position: 'relative', flex: '1 1 auto', minHeight: 0 };

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: 'var(--scormflow-footer-padding, 0.5rem 0.875rem)',
  background: 'var(--scormflow-footer-bg, #fafafa)',
  borderTop: 'var(--scormflow-border, 1px solid #e2e2e2)',
  fontSize: 'var(--scormflow-status-size, 0.8125rem)',
  color: 'var(--scormflow-muted, #666)',
};

const progressTrackStyle: CSSProperties = {
  height: 'var(--scormflow-progress-height, 4px)',
  background: 'var(--scormflow-progress-track, #ececec)',
  overflow: 'hidden',
  flex: 'none',
};

const buttonStyle: CSSProperties = {
  marginLeft: 'auto',
  padding: '0.3rem 0.75rem',
  font: 'inherit',
  fontSize: '0.8125rem',
  cursor: 'pointer',
  color: 'var(--scormflow-button-fg, #fff)',
  background: 'var(--scormflow-accent, #2563eb)',
  border: 'none',
  borderRadius: 'var(--scormflow-button-radius, 6px)',
};

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '1rem',
  background: 'var(--scormflow-overlay-bg, rgba(255,255,255,0.85))',
  color: 'var(--scormflow-fg, #1a1a1a)',
};

const STATUS_LABELS: Record<ScormPlayerStatus, string> = {
  loading: 'Loading…',
  ready: 'Ready',
  error: 'Error',
  terminated: 'Finished',
};

/** Derive a 0–100 progress percentage from the latest runtime summary. */
function progressPercent(summary: RuntimeSummary | null): number {
  if (!summary) return 0;
  if (summary.progressMeasure != null) {
    return Math.max(0, Math.min(100, Math.round(summary.progressMeasure * 100)));
  }
  if (summary.completionStatus === 'completed') return 100;
  if (summary.completionStatus === 'incomplete') return 50;
  return 0;
}

/** Human-readable score from the latest summary, or null when there is none yet. */
function formatScore(summary: RuntimeSummary | null): string | null {
  if (!summary) return null;
  if (summary.scoreScaled != null) return `${Math.round(summary.scoreScaled * 100)}%`;
  if (summary.scoreRaw != null) {
    const max = summary.scoreMax;
    return max != null ? `${summary.scoreRaw}/${max}` : String(summary.scoreRaw);
  }
  return null;
}

/**
 * Drop-in SCORM player. Renders a container the SCO iframe mounts into and
 * manages the attempt lifecycle via {@link useScormPlayer}, wrapped in optional
 * chrome — a title header, a live progress bar, and a footer with status, score
 * and a manual Save button. All colours and spacing read `--scormflow-*` CSS
 * variables, so the look is themeable from any ancestor.
 *
 * ```tsx
 * <ScormPlayer
 *   title="Fire Safety 101"
 *   attemptId={attemptId}
 *   launchUrl={launchUrl}
 *   transport={transport}
 *   style={{ height: 600 }}
 * />
 * ```
 *
 * Pass `chrome={false}` for the bare container (just the SCO + overlays).
 */
export function ScormPlayer(props: ScormPlayerProps): JSX.Element {
  const {
    className,
    style,
    chrome = true,
    title,
    showHeader,
    showFooter,
    showProgress,
    footerActions,
    saveLabel = 'Save',
    loadingFallback,
    errorFallback,
    onCommit,
    ...rest
  } = props;

  const [summary, setSummary] = useState<RuntimeSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const handleCommit = useCallback(
    (result: CommitResult) => {
      if (result.summary) setSummary(result.summary);
      onCommit?.(result);
    },
    [onCommit],
  );

  const { containerRef, status, error, commit } = useScormPlayer({ ...rest, onCommit: handleCommit });

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await commit();
    } finally {
      setSaving(false);
    }
  }, [commit]);

  const headerVisible = showHeader ?? (chrome && title != null);
  const footerVisible = showFooter ?? chrome;
  const progressVisible = showProgress ?? chrome;
  const percent = useMemo(() => progressPercent(summary), [summary]);
  const score = useMemo(() => formatScore(summary), [summary]);

  const container = (
    <div style={bodyStyle}>
      <div ref={containerRef} data-scormflow-container style={FILL} />
      {status === 'loading' && loadingFallback != null ? (
        <div data-scormflow-overlay="loading" style={overlayStyle}>
          {loadingFallback}
        </div>
      ) : null}
      {status === 'error' ? (
        <div data-scormflow-overlay="error" style={overlayStyle}>
          {errorFallback ? errorFallback(error) : 'Failed to load content.'}
        </div>
      ) : null}
    </div>
  );

  // Bare mode: preserve the original minimal structure for existing callers.
  if (!chrome && !headerVisible && !footerVisible && !progressVisible) {
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

  return (
    <div className={className} style={{ ...rootStyle, ...style }} data-scormflow-player>
      {headerVisible ? (
        <div data-scormflow-header style={headerStyle}>
          <span>{title}</span>
        </div>
      ) : null}
      {progressVisible ? (
        <div
          data-scormflow-progress
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          style={progressTrackStyle}
        >
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              background: 'var(--scormflow-progress-fill, var(--scormflow-accent, #2563eb))',
              transition: 'width 0.25s ease',
            }}
          />
        </div>
      ) : null}
      {container}
      {footerVisible ? (
        <div data-scormflow-footer style={footerStyle}>
          <span data-scormflow-status>{STATUS_LABELS[status]}</span>
          {score != null ? <span data-scormflow-score>Score: {score}</span> : null}
          {progressVisible ? <span data-scormflow-percent>{percent}%</span> : null}
          {footerActions}
          <button
            type="button"
            data-scormflow-save
            onClick={save}
            disabled={saving || status !== 'ready'}
            style={buttonStyle}
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
