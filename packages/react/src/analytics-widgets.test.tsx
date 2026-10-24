import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceClient, ScormClient, type AnalyticsTrends, type ScoreDistribution } from '@scormflow/sdk';

import {
  AnalyticsDashboard,
  AnalyticsOverviewCard,
  AnalyticsOverviewView,
  AnalyticsTrendChartView,
  CourseAnalyticsView,
  ScoreDistributionChart,
  ScoreDistributionView,
  formatDuration,
  formatPercent,
  formatTrendDate,
  niceScale,
} from './analytics-widgets.js';
import { ScormProvider } from './scorm-context.js';
import { useAnalyticsOverview, useAnalyticsTrends, useLearnerAnalytics, useScoreDistribution } from './use-analytics.js';

// SSR runs no effects: hooks are asserted through their initial state and the
// rendering through the presentational views.
const neverFetch = async () => {
  throw new Error('not called during SSR');
};
const resources = new ResourceClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });

const day = (date: string, started: number, completed: number, extra: Partial<AnalyticsTrends['buckets'][number]> = {}) => ({
  date,
  started,
  completed,
  passed: 0,
  failed: 0,
  averageScore: null,
  ...extra,
});

const TRENDS: AnalyticsTrends = {
  courseId: null,
  interval: 'day',
  from: '2026-10-18',
  to: '2026-10-20',
  buckets: [
    day('2026-10-18', 4, 1, { passed: 1, averageScore: 0.9 }),
    day('2026-10-19', 6, 3, { passed: 2, failed: 1, averageScore: 0.7 }),
    day('2026-10-20', 2, 2, { passed: 2, averageScore: 0.8 }),
  ],
  totals: { started: 12, completed: 6, passed: 5, failed: 1 },
};

const DISTRIBUTION: ScoreDistribution = {
  courseId: 'course_1',
  scoredCount: 6,
  averageScore: 0.65,
  medianScore: 0.7,
  bins: [
    { min: 0, max: 0.25, count: 1 },
    { min: 0.25, max: 0.5, count: 0 },
    { min: 0.5, max: 0.75, count: 3 },
    { min: 0.75, max: 1, count: 2 },
  ],
};

describe('formatting helpers', () => {
  it('formats percents, durations and dates', () => {
    expect(formatPercent(0.6667)).toBe('67%');
    expect(formatPercent(null)).toBe('—');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(720)).toBe('12m');
    expect(formatDuration(3900)).toBe('1h 05m');
    expect(formatDuration(null)).toBe('—');
    expect(formatTrendDate('2026-10-20')).toBe('Oct 20');
  });

  it('picks nice integer axis scales', () => {
    expect(niceScale(0)).toEqual({ max: 1, step: 1 });
    expect(niceScale(4)).toEqual({ max: 4, step: 1 });
    expect(niceScale(7)).toEqual({ max: 8, step: 2 });
    expect(niceScale(93)).toEqual({ max: 100, step: 50 });
    expect(niceScale(130)).toEqual({ max: 150, step: 50 });
  });
});

describe('analytics hooks', () => {
  it('start loading when enabled and stay idle without an id', () => {
    function Probe({ id }: { id: string | null }) {
      const overview = useAnalyticsOverview(resources);
      const trends = useAnalyticsTrends(resources, { days: 7 });
      const scores = useScoreDistribution(resources, id);
      const learner = useLearnerAnalytics(resources, id);
      return <span>{[overview.loading, trends.loading, scores.loading, learner.loading].join(':')}</span>;
    }
    expect(renderToStaticMarkup(<Probe id="x" />)).toContain('true:true:true:true');
    expect(renderToStaticMarkup(<Probe id={null} />)).toContain('true:true:false:false');
  });
});

describe('stat views', () => {
  it('renders the tenant overview', () => {
    const html = renderToStaticMarkup(
      <AnalyticsOverviewView overview={{ courseCount: 3, learnerCount: 40, attemptCount: 75, completionRate: 0.52, averageScore: null }} />,
    );
    expect(html).toContain('Overview');
    expect(html).toContain('>40<');
    expect(html).toContain('52%');
    expect(html).toContain('—');
  });

  it('renders a course card', () => {
    const html = renderToStaticMarkup(
      <CourseAnalyticsView
        title="Security basics"
        analytics={{
          courseId: 'course_1',
          attemptCount: 10,
          completionCount: 7,
          completionRate: 0.7,
          averageScore: 0.81,
          averageTimeSeconds: 1500,
          passRate: 0.5,
          recentAttempts: [],
        }}
      />,
    );
    expect(html).toContain('Security basics');
    expect(html).toContain('7 completed');
    expect(html).toContain('81%');
    expect(html).toContain('25m');
    expect(html).toContain('data-scormflow-course-analytics="course_1"');
  });
});

describe('<AnalyticsTrendChartView>', () => {
  it('draws both series with a legend, end labels, hit targets and a table', () => {
    const html = renderToStaticMarkup(<AnalyticsTrendChartView trends={TRENDS} />);
    expect(html).toContain('Started (12)');
    expect(html).toContain('Completed (6)');
    expect(html.match(/<path /g)).toHaveLength(2);
    expect(html).toContain('Started 2');
    expect(html).toContain('Completed 2');
    expect(html.match(/data-scormflow-trend-day=/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Attempts started and completed per day, Oct 18 to Oct 20: 12 started, 6 completed."');
    expect(html).toContain('Show table');
    expect(html).toContain('<td style="padding:0.3rem 0.5rem;text-align:left;border-bottom:1px solid var(--scormflow-border, #e5e7eb)">2026-10-19</td>');
    // One count axis stepping 0, 2, 4, 6 for a peak of 6.
    const ticks = [...html.matchAll(/text-anchor="end" fill="var\(--scormflow-muted, #666\)">(\d+)<\/text>/g)].map((m) => m[1]);
    expect(ticks).toEqual(['0', '2', '4', '6']);
  });

  it('copes with a one-day window and an empty series', () => {
    const one: AnalyticsTrends = { ...TRENDS, from: '2026-10-20', buckets: [day('2026-10-20', 0, 0)], totals: { started: 0, completed: 0, passed: 0, failed: 0 } };
    expect(() => renderToStaticMarkup(<AnalyticsTrendChartView trends={one} />)).not.toThrow();
    const none: AnalyticsTrends = { ...TRENDS, buckets: [] };
    expect(() => renderToStaticMarkup(<AnalyticsTrendChartView trends={none} />)).not.toThrow();
  });
});

describe('<ScoreDistributionView>', () => {
  it('draws one bar per non-empty bin and labels only the peak', () => {
    const html = renderToStaticMarkup(<ScoreDistributionView distribution={DISTRIBUTION} />);
    expect(html).toContain('6 scored · mean 65% · median 70%');
    expect(html.match(/data-scormflow-score-bin=/g)).toHaveLength(4);
    expect(html.match(/<path /g)).toHaveLength(3); // the empty 25–50% bin has no bar
    expect(html).toContain('50–75%');
    expect(html).toMatch(/fill="currentColor">3<\/text>/);
  });

  it('shows an empty state without scored attempts', () => {
    const html = renderToStaticMarkup(
      <ScoreDistributionView distribution={{ ...DISTRIBUTION, scoredCount: 0, averageScore: null, medianScore: null, bins: DISTRIBUTION.bins.map((b) => ({ ...b, count: 0 })) }} />,
    );
    expect(html).toContain('No scored attempts yet.');
    expect(html).not.toContain('<svg');
  });
});

describe('fetching widgets', () => {
  it('render their loading state from the provider client', () => {
    const html = renderToStaticMarkup(
      <ScormProvider client={client}>
        <AnalyticsOverviewCard />
        <ScoreDistributionChart courseId="course_1" loadingFallback="Hold on" />
      </ScormProvider>,
    );
    expect(html).toContain('Loading the overview…');
    expect(html).toContain('Hold on');
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2);
  });

  it('composes a course dashboard', () => {
    const html = renderToStaticMarkup(<AnalyticsDashboard client={resources} courseId="course_1" days={14} />);
    expect(html).toContain('data-scormflow-analytics-dashboard="course_1"');
    expect(html).toContain('Loading course analytics…');
    expect(html).toContain('Loading trends…');
    expect(html).toContain('Loading the score distribution…');
  });

  it('throws a helpful error without a client', () => {
    expect(() => renderToStaticMarkup(<AnalyticsOverviewCard />)).toThrow(/needs a `client` prop or a <ScormProvider>/);
  });
});
