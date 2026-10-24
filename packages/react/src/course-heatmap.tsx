import { useState, type CSSProperties, type ReactNode } from 'react';
import type { CourseHeatmap as CourseHeatmapData, HeatmapLocation, HeatmapQuery, ReplayClient } from '@scormflow/sdk';

import { useOptionalScormClient } from './scorm-context.js';
import { formatReplayTime } from './session-replay.js';
import { useCourseHeatmap } from './use-replay.js';

export interface CourseHeatmapProps extends HeatmapQuery {
  courseId: string;
  /** Defaults to the `<ScormProvider>` client's `replay`. */
  client?: ReplayClient;
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: (error: unknown) => ReactNode;
}

export interface CourseHeatmapViewProps {
  heatmap: CourseHeatmapData;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  title?: ReactNode;
  /** Location whose pointer grid is shown first. Default: the first one with pointer data. */
  initialLocation?: string | undefined;
}

const panelStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '1rem 1.25rem',
  fontFamily: 'var(--scormflow-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'var(--scormflow-bg, #ffffff)',
  border: '1px solid var(--scormflow-border, #e5e7eb)',
  borderRadius: 'var(--scormflow-radius, 8px)',
};
const titleStyle: CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 600 };
const mutedStyle: CSSProperties = { fontSize: '0.75rem', color: 'var(--scormflow-muted, #666)' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', marginTop: '0.75rem', fontSize: '0.8125rem' };
const cellStyle: CSSProperties = { padding: '0.35rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--scormflow-border, #e5e7eb)' };
const numStyle: CSSProperties = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/** The heat accent, mixed toward the background by `t` (0 = none, 1 = full). */
function heat(t: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, t)) * 100);
  return `color-mix(in srgb, var(--scormflow-heat, #dc2626) ${pct}%, transparent)`;
}

function Bar({ value, max, label }: { value: number; max: number; label: string }): JSX.Element {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--scormflow-track, #f1f5f9)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'var(--scormflow-accent, #2563eb)' }} />
      </div>
      <span style={{ minWidth: '2.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{label}</span>
    </div>
  );
}

/** A `grid` × `grid` pointer heatmap for one location. */
export function PointerGrid({ location, grid }: { location: HeatmapLocation; grid: number }): JSX.Element {
  const max = Math.max(1, ...location.pointer.map((c) => c.count));
  const counts = new Map(location.pointer.map((c) => [`${c.x},${c.y}`, c.count]));
  return (
    <div
      role="img"
      aria-label={`Where learners clicked on ${location.location}`}
      data-scormflow-pointer-grid={location.location}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${grid}, 1fr)`,
        aspectRatio: '16 / 10',
        maxWidth: 320,
        border: '1px solid var(--scormflow-border, #e5e7eb)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: grid * grid }, (_, i) => {
        const count = counts.get(`${i % grid},${Math.floor(i / grid)}`) ?? 0;
        return <div key={i} title={count ? `${count}` : undefined} style={{ background: count ? heat(count / max) : 'transparent' }} />;
      })}
    </div>
  );
}

/**
 * Per-location table in course order: how many attempts reached each
 * location, average active time there (shaded by how long learners stayed),
 * interactions, and drop-offs — where unfinished attempts stopped. Click a row
 * to see its pointer grid, when the player captured pointers.
 */
export function CourseHeatmapView({ heatmap, className, style, title, initialLocation }: CourseHeatmapViewProps): JSX.Element {
  const withPointer = heatmap.locations.filter((l) => l.pointer.length > 0);
  const [selected, setSelected] = useState<string | null>(initialLocation ?? withPointer[0]?.location ?? null);
  const maxDwell = Math.max(0, ...heatmap.locations.map((l) => l.avgActiveSeconds));
  const maxDrop = Math.max(0, ...heatmap.locations.map((l) => l.dropOffs));
  const shown = heatmap.locations.find((l) => l.location === selected && l.pointer.length > 0);

  return (
    <section className={className} style={{ ...panelStyle, ...style }} data-scormflow-heatmap={heatmap.courseId}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={titleStyle}>{title ?? 'Course heatmap'}</h3>
        <span style={mutedStyle}>
          {heatmap.attempts}
          {heatmap.truncated ? '+' : ''} attempt{heatmap.attempts === 1 ? '' : 's'} · {heatmap.completed} finished
        </span>
      </div>

      {heatmap.locations.length === 0 ? (
        <p style={{ ...mutedStyle, marginTop: '0.75rem' }}>No locations reported yet.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Location</th>
              <th style={{ ...cellStyle, width: '30%' }}>Reached</th>
              <th style={numStyle}>Avg time</th>
              <th style={numStyle}>Interactions</th>
              <th style={numStyle}>Drop-offs</th>
            </tr>
          </thead>
          <tbody>
            {heatmap.locations.map((l) => (
              <tr
                key={l.location}
                data-scormflow-heatmap-row={l.location}
                aria-selected={l.location === selected}
                onClick={() => setSelected(l.location)}
                style={{ cursor: l.pointer.length > 0 ? 'pointer' : 'default' }}
              >
                <td style={{ ...cellStyle, fontWeight: l.location === selected ? 600 : 400 }}>{l.location}</td>
                <td style={cellStyle}>
                  <Bar
                    value={l.attempts}
                    max={heatmap.attempts}
                    label={heatmap.attempts ? `${Math.round((l.attempts / heatmap.attempts) * 100)}%` : '0%'}
                  />
                </td>
                <td style={{ ...numStyle, background: heat(maxDwell ? (l.avgActiveSeconds / maxDwell) * 0.5 : 0) }}>
                  {formatReplayTime(l.avgActiveSeconds)}
                </td>
                <td style={numStyle}>{l.interactions}</td>
                <td style={{ ...numStyle, color: l.dropOffs && l.dropOffs === maxDrop ? 'var(--scormflow-danger, #b91c1c)' : undefined }}>
                  {l.dropOffs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {shown ? (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ ...mutedStyle, marginBottom: '0.35rem' }}>Clicks on {shown.location}</div>
          <PointerGrid location={shown} grid={heatmap.grid} />
        </div>
      ) : null}
    </section>
  );
}

/** Fetches a course heatmap and renders a {@link CourseHeatmapView}. Needs a client with the API key. */
export function CourseHeatmap({
  courseId,
  client,
  limit,
  since,
  loadingFallback = 'Loading heatmap…',
  errorFallback,
  ...view
}: CourseHeatmapProps): JSX.Element {
  const fromContext = useOptionalScormClient();
  const replay = client ?? fromContext?.replay;
  if (!replay) throw new Error('<CourseHeatmap> needs a `client` prop or a <ScormProvider>.');
  const query: HeatmapQuery = {};
  if (limit !== undefined) query.limit = limit;
  if (since !== undefined) query.since = since;
  const { data, error, loading } = useCourseHeatmap(replay, courseId, query);

  if (error) {
    return (
      <div role="alert" style={{ ...panelStyle, color: 'var(--scormflow-danger, #b91c1c)', ...view.style }}>
        {errorFallback ? errorFallback(error) : 'Could not load the heatmap.'}
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
  return <CourseHeatmapView heatmap={data} {...view} />;
}
