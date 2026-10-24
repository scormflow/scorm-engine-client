/**
 * Pre-built dashboard widgets over the analytics read models: stat tiles for
 * the tenant overview and a course, a daily trend chart and a score histogram,
 * and `<AnalyticsDashboard/>` composing them. Each widget has a presentational
 * `*View` (data in, markup out) and a fetching wrapper that reads the
 * `<ScormProvider>` client. Charts are dependency-free inline SVG with a hover
 * tooltip and a table view; colors come from `--scormflow-series-1/2` so a
 * host can restep them for dark mode.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import type {
  AnalyticsOverview,
  AnalyticsTrends,
  CourseAnalytics,
  ResourceClient,
  ScoreDistribution,
  TrendBucket,
} from '@scormflow/sdk';

import { useOptionalScormClient } from './scorm-context.js';
import { useCourseAnalytics } from './use-course.js';
import { useAnalyticsOverview, useAnalyticsTrends, useScoreDistribution } from './use-analytics.js';
import type { AsyncResource } from './use-resource.js';

// ---- formatting --------------------------------------------------------------

/** `0.6667` → `"67%"`; null → `"—"`. */
export function formatPercent(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

/** Seconds → `"45s"`, `"12m"`, `"1h 05m"`; null → `"—"`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** `"2026-10-20"` → `"Oct 20"` (UTC, so the day never shifts with the viewer's zone). */
export function formatTrendDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---- shared styles -----------------------------------------------------------

const SERIES_1 = 'var(--scormflow-series-1, #2a78d6)';
const SERIES_2 = 'var(--scormflow-series-2, #eb6834)';
const SURFACE = 'var(--scormflow-bg, #ffffff)';
const MUTED = 'var(--scormflow-muted, #666)';
const GRID = 'var(--scormflow-border, #e5e7eb)';

const panelStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '1rem 1.25rem',
  fontFamily: 'var(--scormflow-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: SURFACE,
  border: `1px solid ${GRID}`,
  borderRadius: 'var(--scormflow-radius, 8px)',
};
const titleStyle: CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 600 };
const mutedStyle: CSSProperties = { fontSize: '0.75rem', color: MUTED };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem', fontSize: '0.8125rem' };
const cellStyle: CSSProperties = { padding: '0.3rem 0.5rem', textAlign: 'left', borderBottom: `1px solid ${GRID}` };
const numStyle: CSSProperties = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const tooltipStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
  padding: '0.35rem 0.5rem',
  fontSize: '0.75rem',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  background: SURFACE,
  border: `1px solid ${GRID}`,
  borderRadius: 4,
  boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
};

interface WidgetChrome {
  className?: string | undefined;
  style?: CSSProperties | undefined;
  title?: ReactNode;
}

interface FetchingProps {
  /** Defaults to the `<ScormProvider>` client's `resources`. */
  client?: ResourceClient;
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: (error: unknown) => ReactNode;
}

function useResources(client: ResourceClient | undefined, component: string): ResourceClient {
  const fromContext = useOptionalScormClient();
  const resources = client ?? fromContext?.resources;
  if (!resources) throw new Error(`<${component}> needs a \`client\` prop or a <ScormProvider>.`);
  return resources;
}

/** Loading / error states shared by the fetching wrappers. */
function renderResource<T>(
  resource: AsyncResource<T>,
  props: FetchingProps,
  noun: string,
  render: (data: T) => JSX.Element,
): JSX.Element {
  if (resource.error) {
    return (
      <div role="alert" className={props.className} style={{ ...panelStyle, color: 'var(--scormflow-danger, #b91c1c)', ...props.style }}>
        {props.errorFallback ? props.errorFallback(resource.error) : `Could not load ${noun}.`}
      </div>
    );
  }
  if (resource.loading || !resource.data) {
    return (
      <div aria-busy="true" className={props.className} style={{ ...panelStyle, ...props.style }}>
        {props.loadingFallback ?? `Loading ${noun}…`}
      </div>
    );
  }
  return render(resource.data);
}

// ---- stat tiles --------------------------------------------------------------

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Secondary line under the value. */
  hint?: ReactNode;
}

/** One headline number. */
export function StatTile({ label, value, hint }: StatTileProps): JSX.Element {
  return (
    <div data-scormflow-stat style={{ minWidth: 0 }}>
      <div style={mutedStyle}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>{value}</div>
      {hint != null ? <div style={mutedStyle}>{hint}</div> : null}
    </div>
  );
}

function StatRow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
      {children}
    </div>
  );
}

export interface AnalyticsOverviewViewProps extends WidgetChrome {
  overview: AnalyticsOverview;
}

/** Courses, learners, attempts, completion rate and average score. */
export function AnalyticsOverviewView({ overview, className, style, title }: AnalyticsOverviewViewProps): JSX.Element {
  return (
    <section className={className} style={{ ...panelStyle, ...style }} data-scormflow-analytics-overview>
      <h3 style={titleStyle}>{title ?? 'Overview'}</h3>
      <StatRow>
        <StatTile label="Courses" value={overview.courseCount} />
        <StatTile label="Learners" value={overview.learnerCount} />
        <StatTile label="Attempts" value={overview.attemptCount} />
        <StatTile label="Completion rate" value={formatPercent(overview.completionRate)} />
        <StatTile label="Average score" value={formatPercent(overview.averageScore)} />
      </StatRow>
    </section>
  );
}

export type AnalyticsOverviewCardProps = FetchingProps;

/** Fetches the tenant overview and renders an {@link AnalyticsOverviewView}. */
export function AnalyticsOverviewCard(props: AnalyticsOverviewCardProps): JSX.Element {
  const resource = useAnalyticsOverview(useResources(props.client, 'AnalyticsOverviewCard'));
  return renderResource(resource, props, 'the overview', (overview) => (
    <AnalyticsOverviewView overview={overview} className={props.className} style={props.style} title={props.title} />
  ));
}

export interface CourseAnalyticsViewProps extends WidgetChrome {
  analytics: CourseAnalytics;
}

/** Attempts, completion, pass rate, average score and average time for one course. */
export function CourseAnalyticsView({ analytics, className, style, title }: CourseAnalyticsViewProps): JSX.Element {
  return (
    <section className={className} style={{ ...panelStyle, ...style }} data-scormflow-course-analytics={analytics.courseId}>
      <h3 style={titleStyle}>{title ?? 'Course performance'}</h3>
      <StatRow>
        <StatTile label="Attempts" value={analytics.attemptCount} />
        <StatTile
          label="Completion rate"
          value={formatPercent(analytics.completionRate)}
          hint={`${analytics.completionCount} completed`}
        />
        <StatTile label="Pass rate" value={formatPercent(analytics.passRate)} />
        <StatTile label="Average score" value={formatPercent(analytics.averageScore)} />
        <StatTile label="Average time" value={formatDuration(analytics.averageTimeSeconds)} />
      </StatRow>
    </section>
  );
}

export interface CourseAnalyticsCardProps extends FetchingProps {
  courseId: string;
}

/** Fetches one course's analytics and renders a {@link CourseAnalyticsView}. */
export function CourseAnalyticsCard({ courseId, ...props }: CourseAnalyticsCardProps): JSX.Element {
  const resource = useCourseAnalytics(useResources(props.client, 'CourseAnalyticsCard'), courseId);
  return renderResource(resource, props, 'course analytics', (analytics) => (
    <CourseAnalyticsView analytics={analytics} className={props.className} style={props.style} title={props.title} />
  ));
}

// ---- trend chart -------------------------------------------------------------

const CHART_W = 640;
const CHART_H = 200;
const PAD = { top: 12, right: 76, bottom: 24, left: 36 };

/** A "nice" axis ceiling and tick step for `max` (at least 1). */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  const raw = Math.max(1, max) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const integerStep = Math.max(1, Math.ceil(step));
  return { max: integerStep * Math.ceil(Math.max(1, max) / integerStep), step: integerStep };
}

function TableToggle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <details style={{ marginTop: '0.5rem' }}>
      <summary style={{ ...mutedStyle, cursor: 'pointer' }}>Show table</summary>
      {children}
    </details>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <span aria-hidden="true" style={{ width: 12, height: 2, borderRadius: 1, background: color }} />
      {label}
    </span>
  );
}

export interface AnalyticsTrendChartViewProps extends WidgetChrome {
  trends: AnalyticsTrends;
}

/**
 * Started vs completed attempts per day as two lines on one count axis, with
 * a crosshair tooltip (completed splits into passed / failed / score) and a
 * table view.
 */
export function AnalyticsTrendChartView({ trends, className, style, title }: AnalyticsTrendChartViewProps): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const { buckets } = trends;
  const n = buckets.length;
  const { max, step } = niceScale(Math.max(0, ...buckets.map((b) => Math.max(b.started, b.completed))));
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const x = (i: number): number => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number): number => PAD.top + plotH - (v / max) * plotH;
  const path = (key: 'started' | 'completed'): string =>
    buckets.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`).join('');
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const last = buckets[n - 1];
  const hovered: TrendBucket | undefined = hover == null ? undefined : buckets[hover];
  const slot = n > 1 ? plotW / (n - 1) : plotW;

  // Keep the two end labels from overlapping when the series end close together.
  let startedLabelY = last ? y(last.started) : 0;
  let completedLabelY = last ? y(last.completed) : 0;
  if (Math.abs(startedLabelY - completedLabelY) < 12) {
    const mid = (startedLabelY + completedLabelY) / 2;
    const startedOnTop = (last?.started ?? 0) >= (last?.completed ?? 0);
    startedLabelY = mid + (startedOnTop ? -6 : 6);
    completedLabelY = mid + (startedOnTop ? 6 : -6);
  }

  return (
    <section className={className} style={{ ...panelStyle, ...style }} data-scormflow-trend-chart>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={titleStyle}>{title ?? 'Attempts per day'}</h3>
        <span style={{ ...mutedStyle, display: 'inline-flex', gap: '0.75rem' }}>
          <LegendSwatch color={SERIES_1} label={`Started (${trends.totals.started})`} />
          <LegendSwatch color={SERIES_2} label={`Completed (${trends.totals.completed})`} />
        </span>
      </div>

      <div style={{ position: 'relative', marginTop: '0.5rem' }} onMouseLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          width="100%"
          role="img"
          aria-label={`Attempts started and completed per day, ${formatTrendDate(trends.from)} to ${formatTrendDate(trends.to)}: ${trends.totals.started} started, ${trends.totals.completed} completed.`}
          style={{ display: 'block', overflow: 'visible', fontSize: 11 }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fill={MUTED}>
                {t}
              </text>
            </g>
          ))}
          {buckets.map((b, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={b.date} x={x(i)} y={CHART_H - 6} textAnchor="middle" fill={MUTED}>
                {formatTrendDate(b.date)}
              </text>
            ) : null,
          )}
          {hovered ? <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={PAD.top + plotH} stroke={MUTED} strokeWidth={1} /> : null}
          <path d={path('started')} fill="none" stroke={SERIES_1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path('completed')} fill="none" stroke={SERIES_2} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hovered
            ? (['started', 'completed'] as const).map((key) => (
                <circle
                  key={key}
                  cx={x(hover!)}
                  cy={y(hovered[key])}
                  r={4}
                  fill={key === 'started' ? SERIES_1 : SERIES_2}
                  stroke={SURFACE}
                  strokeWidth={2}
                />
              ))
            : null}
          {last ? (
            <>
              <text x={PAD.left + plotW + 6} y={startedLabelY} dy="0.32em" fill="currentColor">
                Started {last.started}
              </text>
              <text x={PAD.left + plotW + 6} y={completedLabelY} dy="0.32em" fill="currentColor">
                Completed {last.completed}
              </text>
            </>
          ) : null}
          {buckets.map((b, i) => (
            <rect
              key={b.date}
              data-scormflow-trend-day={b.date}
              x={x(i) - slot / 2}
              y={PAD.top}
              width={slot}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
        {hovered ? (
          <div role="tooltip" style={{ ...tooltipStyle, left: `${(x(hover!) / CHART_W) * 100}%` }}>
            <div style={{ fontWeight: 600 }}>{formatTrendDate(hovered.date)}</div>
            <div>
              <LegendSwatch color={SERIES_1} label={`Started ${hovered.started}`} />
            </div>
            <div>
              <LegendSwatch color={SERIES_2} label={`Completed ${hovered.completed}`} />
            </div>
            <div style={mutedStyle}>
              {hovered.passed} passed · {hovered.failed} failed · avg {formatPercent(hovered.averageScore)}
            </div>
          </div>
        ) : null}
      </div>

      <TableToggle>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Date</th>
              <th style={numStyle}>Started</th>
              <th style={numStyle}>Completed</th>
              <th style={numStyle}>Passed</th>
              <th style={numStyle}>Failed</th>
              <th style={numStyle}>Avg score</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.date}>
                <td style={cellStyle}>{b.date}</td>
                <td style={numStyle}>{b.started}</td>
                <td style={numStyle}>{b.completed}</td>
                <td style={numStyle}>{b.passed}</td>
                <td style={numStyle}>{b.failed}</td>
                <td style={numStyle}>{formatPercent(b.averageScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </section>
  );
}

export interface AnalyticsTrendChartProps extends FetchingProps {
  /** Window length in days, 1–365. Default: the engine's (30). */
  days?: number;
  /** Scope to one course; tenant-wide when omitted. */
  courseId?: string;
}

/** Fetches `/analytics/trends` and renders an {@link AnalyticsTrendChartView}. */
export function AnalyticsTrendChart({ days, courseId, ...props }: AnalyticsTrendChartProps): JSX.Element {
  const query: { days?: number; courseId?: string } = {};
  if (days !== undefined) query.days = days;
  if (courseId !== undefined) query.courseId = courseId;
  const resource = useAnalyticsTrends(useResources(props.client, 'AnalyticsTrendChart'), query);
  return renderResource(resource, props, 'trends', (trends) => (
    <AnalyticsTrendChartView trends={trends} className={props.className} style={props.style} title={props.title} />
  ));
}

// ---- score histogram ---------------------------------------------------------

export interface ScoreDistributionViewProps extends WidgetChrome {
  distribution: ScoreDistribution;
}

/** Histogram of scaled scores with mean / median, a per-bar tooltip and a table view. */
export function ScoreDistributionView({ distribution, className, style, title }: ScoreDistributionViewProps): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const { bins } = distribution;
  const { max, step } = niceScale(Math.max(0, ...bins.map((b) => b.count)));
  const plotW = CHART_W - PAD.left - 12;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const slot = bins.length ? plotW / bins.length : plotW;
  const gap = 2;
  const y = (v: number): number => PAD.top + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const binLabel = (i: number): string => {
    const b = bins[i]!;
    return `${Math.round(b.min * 100)}–${Math.round(b.max * 100)}%`;
  };
  const hovered = hover == null ? undefined : bins[hover];
  const peak = Math.max(0, ...bins.map((b) => b.count));

  return (
    <section className={className} style={{ ...panelStyle, ...style }} data-scormflow-score-distribution={distribution.courseId}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={titleStyle}>{title ?? 'Score distribution'}</h3>
        <span style={mutedStyle}>
          {distribution.scoredCount} scored · mean {formatPercent(distribution.averageScore)} · median{' '}
          {formatPercent(distribution.medianScore)}
        </span>
      </div>

      {distribution.scoredCount === 0 ? (
        <p style={{ ...mutedStyle, marginTop: '0.75rem' }}>No scored attempts yet.</p>
      ) : (
        <div style={{ position: 'relative', marginTop: '0.5rem' }} onMouseLeave={() => setHover(null)}>
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            width="100%"
            role="img"
            aria-label={`Score distribution across ${distribution.scoredCount} scored attempts, median ${formatPercent(distribution.medianScore)}.`}
            style={{ display: 'block', overflow: 'visible', fontSize: 11 }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fill={MUTED}>
                  {t}
                </text>
              </g>
            ))}
            {bins.map((b, i) => {
              const h = (b.count / max) * plotH;
              const bx = PAD.left + i * slot + gap / 2;
              const bw = Math.max(1, slot - gap);
              const r = Math.min(4, bw / 2, h);
              const base = PAD.top + plotH;
              // Rounded top corners only; the bar stays square on the baseline.
              const d =
                h <= 0
                  ? ''
                  : `M${bx},${base}V${base - h + r}Q${bx},${base - h} ${bx + r},${base - h}H${bx + bw - r}Q${bx + bw},${base - h} ${bx + bw},${base - h + r}V${base}Z`;
              return (
                <g key={i} data-scormflow-score-bin={i} onMouseEnter={() => setHover(i)}>
                  <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                  {d ? <path d={d} fill={SERIES_1} opacity={hover == null || hover === i ? 1 : 0.55} /> : null}
                  {b.count > 0 && b.count === peak ? (
                    <text x={bx + bw / 2} y={base - h - 4} textAnchor="middle" fill="currentColor">
                      {b.count}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {[0, 0.5, 1].map((v) => (
              <text
                key={v}
                x={PAD.left + v * plotW}
                y={CHART_H - 6}
                textAnchor={v === 0 ? 'start' : v === 1 ? 'end' : 'middle'}
                fill={MUTED}
              >
                {Math.round(v * 100)}%
              </text>
            ))}
          </svg>
          {hovered ? (
            <div
              role="tooltip"
              style={{ ...tooltipStyle, left: `${((PAD.left + (hover! + 0.5) * slot) / CHART_W) * 100}%` }}
            >
              <div style={{ fontWeight: 600 }}>{binLabel(hover!)}</div>
              <div>
                {hovered.count} attempt{hovered.count === 1 ? '' : 's'}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <TableToggle>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Score</th>
              <th style={numStyle}>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b, i) => (
              <tr key={i}>
                <td style={cellStyle}>{binLabel(i)}</td>
                <td style={numStyle}>{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </section>
  );
}

export interface ScoreDistributionChartProps extends FetchingProps {
  courseId: string;
  /** 2–20 bins. Default: the engine's (10). */
  bins?: number;
}

/** Fetches a course's score histogram and renders a {@link ScoreDistributionView}. */
export function ScoreDistributionChart({ courseId, bins, ...props }: ScoreDistributionChartProps): JSX.Element {
  const resource = useScoreDistribution(useResources(props.client, 'ScoreDistributionChart'), courseId, bins);
  return renderResource(resource, props, 'the score distribution', (distribution) => (
    <ScoreDistributionView distribution={distribution} className={props.className} style={props.style} title={props.title} />
  ));
}

// ---- dashboard ---------------------------------------------------------------

export interface AnalyticsDashboardProps {
  /** Show one course: its stat tiles, trend and score histogram. Tenant-wide when omitted. */
  courseId?: string;
  /** Trend window in days. Default: the engine's (30). */
  days?: number;
  client?: ResourceClient;
  className?: string;
  style?: CSSProperties;
}

/**
 * Drop-in analytics dashboard: tenant overview (or a course's stat tiles),
 * the daily trend chart, and — for a course — its score distribution.
 */
export function AnalyticsDashboard({ courseId, days, client, className, style }: AnalyticsDashboardProps): JSX.Element {
  const shared = client ? { client } : {};
  const trendProps = { ...shared, ...(days !== undefined ? { days } : {}), ...(courseId ? { courseId } : {}) };
  return (
    <div className={className} style={{ display: 'grid', gap: '1rem', ...style }} data-scormflow-analytics-dashboard={courseId ?? ''}>
      {courseId ? <CourseAnalyticsCard courseId={courseId} {...shared} /> : <AnalyticsOverviewCard {...shared} />}
      <AnalyticsTrendChart {...trendProps} />
      {courseId ? <ScoreDistributionChart courseId={courseId} {...shared} /> : null}
    </div>
  );
}
