import type { CSSProperties, ReactNode } from 'react';
import type { AttemptReplay, EngagementScore, ReplayClient, ReplayTimelineEntry } from '@scormflow/sdk';

import { useOptionalScormClient } from './scorm-context.js';
import { useReplayPlayback, useSessionReplay, type ReplayPlaybackOptions } from './use-replay.js';

export interface SessionReplayProps extends ReplayPlaybackOptions {
  attemptId: string;
  /** Defaults to the `<ScormProvider>` client's `replay`. */
  client?: ReplayClient;
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  /** Shown while the timeline loads. */
  loadingFallback?: ReactNode;
  /** Shown if loading fails. */
  errorFallback?: (error: unknown) => ReactNode;
  /** Render an entry's text yourself; {@link describeReplayEntry} otherwise. */
  renderEntry?: (entry: ReplayTimelineEntry) => ReactNode;
}

export interface SessionReplayViewProps extends ReplayPlaybackOptions {
  replay: AttemptReplay;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  title?: ReactNode;
  renderEntry?: ((entry: ReplayTimelineEntry) => ReactNode) | undefined;
}

// Themed through the same `--scormflow-*` variables as the other components.
const panelStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '1rem 1.25rem',
  fontFamily: 'var(--scormflow-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'var(--scormflow-bg, #ffffff)',
  border: '1px solid var(--scormflow-border, #e5e7eb)',
  borderRadius: 'var(--scormflow-radius, 8px)',
};
const headerStyle: CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' };
const titleStyle: CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 600 };
const mutedStyle: CSSProperties = { fontSize: '0.75rem', color: 'var(--scormflow-muted, #666)' };
const controlsStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.75rem 0 0.5rem' };
const stripStyle: CSSProperties = { display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--scormflow-track, #f1f5f9)' };
const listStyle: CSSProperties = { listStyle: 'none', margin: '0.75rem 0 0', padding: 0, maxHeight: 320, overflowY: 'auto', fontSize: '0.8125rem' };
const buttonStyle: CSSProperties = {
  padding: '0.3rem 0.8rem',
  font: 'inherit',
  fontSize: '0.8125rem',
  cursor: 'pointer',
  color: 'var(--scormflow-button-fg, #fff)',
  background: 'var(--scormflow-accent, #2563eb)',
  border: 'none',
  borderRadius: 'var(--scormflow-button-radius, 6px)',
};

const LEVEL_COLORS: Record<EngagementScore['level'], string> = {
  high: 'var(--scormflow-success, #15803d)',
  medium: 'var(--scormflow-warning, #b45309)',
  low: 'var(--scormflow-danger, #b91c1c)',
};

/** Alternating fills for the visits strip; `--scormflow-replay-1..4` override them. */
const VISIT_COLORS = [
  'var(--scormflow-replay-1, #2563eb)',
  'var(--scormflow-replay-2, #0d9488)',
  'var(--scormflow-replay-3, #7c3aed)',
  'var(--scormflow-replay-4, #ea580c)',
];

/** `75` → `"1:15"`, `3725` → `"1:02:05"`. */
export function formatReplayTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** One line of plain English for a timeline entry. */
export function describeReplayEntry(entry: ReplayTimelineEntry): string {
  const d = entry.data;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  switch (entry.type) {
    case 'attempt.started':
      return 'Launched the course';
    case 'attempt.finished':
      return `Finished (${[str('completionStatus'), str('successStatus')].filter((s) => s && s !== 'UNKNOWN').join(', ').toLowerCase() || 'ended'})`;
    case 'location.changed':
      return `Moved to ${str('to') ?? 'another location'}`;
    case 'navigation':
      return `Opened ${entry.location ?? 'a page'}`;
    case 'status.changed':
      return `${(str('element') ?? 'status').replace(/^cmi\.(core\.)?/, '').replace(/_/g, ' ')} → ${str('to')}`;
    case 'score.changed': {
      const scaled = typeof d['scaled'] === 'number' ? `${Math.round((d['scaled'] as number) * 100)}%` : null;
      return `Score ${scaled ?? d['raw'] ?? 'updated'}`;
    }
    case 'progress.changed':
      return `Progress ${typeof d['to'] === 'number' ? `${Math.round((d['to'] as number) * 100)}%` : 'updated'}`;
    case 'interaction.recorded': {
      const result = str('result');
      return `Answered ${str('id') ?? 'a question'}${result ? ` — ${result}` : ''}`;
    }
    case 'objective.updated':
      return `Objective ${str('id') ?? ''} ${(str('successStatus') ?? str('completionStatus') ?? 'updated').toLowerCase()}`.trim();
    case 'session.suspended':
      return 'Left and saved progress';
    case 'session.resumed':
      return 'Came back';
    case 'page.hidden':
      return 'Switched away from the tab';
    case 'page.visible':
      return 'Returned to the tab';
    case 'idle.start':
      return 'Went idle';
    case 'idle.end':
      return 'Active again';
    case 'pointer':
      return 'Clicked';
    case 'media.play':
      return 'Played media';
    case 'media.pause':
      return 'Paused media';
    case 'media.ended':
      return 'Finished media';
    default:
      return entry.type.replace(/[._-]/g, ' ');
  }
}

/** "Engagement 72 · high". */
function EngagementSummary({ engagement }: { engagement: EngagementScore }): JSX.Element {
  const parts: Array<[string, number | null]> = [
    ['progress', engagement.components.progress],
    ['focus', engagement.components.focus],
    ['interactivity', engagement.components.interactivity],
  ];
  return (
    <div data-scormflow-engagement={engagement.level} style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
      <strong style={{ fontSize: '1.25rem', color: LEVEL_COLORS[engagement.level] }}>{engagement.score}</strong>
      <span style={mutedStyle}>engagement · {engagement.level}</span>
      {parts.map(([name, value]) => (
        <span key={name} style={mutedStyle}>
          {name} {value === null ? '—' : `${Math.round(value * 100)}%`}
        </span>
      ))}
      <span style={mutedStyle}>active {formatReplayTime(engagement.activeSeconds)}</span>
    </div>
  );
}

/**
 * The presentational replay: engagement summary, a strip of the locations the
 * learner visited, a play / scrub control, and the timeline with the entries
 * up to the playhead highlighted.
 */
export function SessionReplayView({ replay, className, style, title, renderEntry, ...playback }: SessionReplayViewProps): JSX.Element {
  const clock = useReplayPlayback(replay, playback);
  const total = Math.max(1, replay.durationSeconds);

  return (
    <section className={className} style={{ ...panelStyle, ...style }} data-scormflow-replay={replay.attemptId}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>{title ?? `Session replay — ${replay.learner.name ?? replay.learner.id}`}</h3>
        <span style={mutedStyle}>
          {formatReplayTime(replay.durationSeconds)} · {replay.commits} commit{replay.commits === 1 ? '' : 's'}
          {replay.captured ? ' · with capture' : ''}
          {replay.truncated ? ' · truncated' : ''}
        </span>
      </div>
      <EngagementSummary engagement={replay.engagement} />

      {replay.visits.length > 0 ? (
        <div style={{ ...stripStyle, marginTop: '0.75rem' }} aria-label="Locations visited">
          {replay.visits.map((visit, i) => {
            const width = ((Date.parse(visit.leftAt) - Date.parse(visit.enteredAt)) / 1000 / total) * 100;
            const here = clock.location === visit.location;
            return (
              <div
                key={`${visit.location}-${visit.enteredAt}`}
                title={`${visit.location} · ${formatReplayTime(visit.activeSeconds)} active`}
                data-scormflow-visit={visit.location}
                style={{
                  width: `${Math.max(0.5, width)}%`,
                  background: VISIT_COLORS[i % VISIT_COLORS.length],
                  opacity: here ? 1 : 0.45,
                }}
              />
            );
          })}
        </div>
      ) : null}

      <div style={controlsStyle}>
        <button type="button" style={buttonStyle} onClick={clock.playing ? clock.pause : clock.play}>
          {clock.playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={replay.durationSeconds}
          step={0.1}
          value={clock.position}
          onChange={(e) => clock.seek(Number(e.target.value))}
          aria-label="Playback position"
          style={{ flex: 1 }}
        />
        <span style={{ ...mutedStyle, fontVariantNumeric: 'tabular-nums' }}>
          {formatReplayTime(clock.position)} / {formatReplayTime(replay.durationSeconds)}
        </span>
      </div>
      <div style={mutedStyle} data-scormflow-replay-location>
        {clock.location ? `On ${clock.location}` : 'No location reported'}
      </div>

      <ol style={listStyle}>
        {replay.entries.map((entry, i) => {
          const reached = i <= clock.currentIndex;
          return (
            <li
              key={`${entry.at}-${i}`}
              data-scormflow-entry={entry.type}
              data-scormflow-source={entry.source}
              aria-current={i === clock.currentIndex ? 'step' : undefined}
              style={{
                display: 'flex',
                gap: '0.75rem',
                padding: '0.3rem 0.25rem',
                borderLeft: `3px solid ${i === clock.currentIndex ? 'var(--scormflow-accent, #2563eb)' : 'transparent'}`,
                opacity: reached ? 1 : 0.5,
                cursor: 'pointer',
              }}
              onClick={() => clock.seek(entry.offsetSeconds)}
            >
              <span style={{ ...mutedStyle, minWidth: '3.5rem', fontVariantNumeric: 'tabular-nums' }}>
                {formatReplayTime(entry.offsetSeconds)}
              </span>
              <span style={{ flex: 1 }}>{renderEntry ? renderEntry(entry) : describeReplayEntry(entry)}</span>
              {entry.location ? <span style={mutedStyle}>{entry.location}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Fetches an attempt's replay and renders a {@link SessionReplayView}. Needs a
 * client with the API key.
 */
export function SessionReplay({
  attemptId,
  client,
  loadingFallback = 'Loading replay…',
  errorFallback,
  ...view
}: SessionReplayProps): JSX.Element {
  const fromContext = useOptionalScormClient();
  const replay = client ?? fromContext?.replay;
  if (!replay) throw new Error('<SessionReplay> needs a `client` prop or a <ScormProvider>.');
  const { data, error, loading } = useSessionReplay(replay, attemptId);

  if (error) {
    return (
      <div role="alert" style={{ ...panelStyle, color: 'var(--scormflow-danger, #b91c1c)', ...view.style }}>
        {errorFallback ? errorFallback(error) : 'Could not load the replay.'}
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div aria-busy="true" className={view.className} style={{ ...panelStyle, ...view.style }}>
        {loadingFallback}
      </div>
    );
  }
  return <SessionReplayView replay={data} {...view} />;
}
